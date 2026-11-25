import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { Workbook } from 'exceljs';
import { isISO8601 } from 'class-validator';
import { RawMaterialsService } from '../raw-materials/raw-materials.service';
import { UnitOfMeasuresService } from '../unit-of-measures/unit-of-measures.service';
import { Site, SiteDocument } from '../sites/schemas/site.schema';
import {
  InventoryEntry,
  InventoryEntryDocument,
  InventoryIssue,
  InventoryIssueDocument,
  InventoryLine,
  InventoryOpeningPreview,
  InventoryOpeningPreviewDocument,
  InventoryState,
  InventoryStateDocument,
} from './inventory.schema';
import type {
  ConfirmPurchaseOrderDto,
  CreateInventoryReceiptDto,
  InventoryLineDto,
  InventoryDashboardQueryDto,
  InventoryQueryDto,
} from './inventory.dto';
import {
  inventoryCode,
  inventoryDelta,
  inventoryQuantity,
  roundInventory,
} from './inventory-quantity';
import { isPoQuantity, readPurchaseOrders } from './po-import';

type Actor = { id: string; name: string };
type IssueInput = {
  productCode?: string;
  name?: string;
  unitOfMeasures?: string;
  actualQty?: number;
};
type Balance = InventoryLine;

// Older issues stored completion time. Their batch reference contains the original MPR date.
function productionDatedMovements(
  site: string,
): import('mongoose').PipelineStage[] {
  return [
    { $match: { site } },
    {
      $set: {
        occurredAt: {
          $cond: [
            { $eq: ['$kind', 'issue'] },
            {
              $dateFromString: {
                dateString: {
                  $arrayElemAt: [
                    { $split: [{ $ifNull: ['$reference', ''] }, '__'] },
                    1,
                  ],
                },
                format: '%Y-%m-%d',
                timezone: 'Asia/Jakarta',
                onError: '$occurredAt',
                onNull: '$occurredAt',
              },
            },
            '$occurredAt',
          ],
        },
      },
    },
  ];
}

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(InventoryState.name)
    private readonly states: Model<InventoryStateDocument>,
    @InjectModel(InventoryEntry.name)
    private readonly entries: Model<InventoryEntryDocument>,
    @InjectModel(InventoryIssue.name)
    private readonly issues: Model<InventoryIssueDocument>,
    @InjectModel(InventoryOpeningPreview.name)
    private readonly previews: Model<InventoryOpeningPreviewDocument>,
    @InjectModel(Site.name) private readonly sites: Model<SiteDocument>,
    private readonly materials: RawMaterialsService,
    private readonly units: UnitOfMeasuresService,
  ) {}

  async resolveSite(site?: string) {
    if (!site?.trim()) throw new BadRequestException('Select a site first.');
    const found = await this.sites
      .findOne({ code: inventoryCode(site) })
      .lean();
    if (!found) throw new NotFoundException('Site not found.');
    return found.code;
  }

  async status(site: string) {
    const state = await this.states.findOne({ site }).lean();
    return { active: Boolean(state), activatedAt: state?.activatedAt ?? null };
  }

  async reset(site: string, actor: Actor) {
    const { deletedEntries } = await this.transaction(async (session) => {
      // Removing the state first serializes the reset with active inventory writes.
      await this.states.deleteOne({ site }, { session });
      const entries = await this.entries.deleteMany({ site }, { session });
      await this.issues.deleteMany({ site }, { session });
      await this.previews.deleteMany({ site }, { session });
      return { deletedEntries: entries.deletedCount };
    });
    this.logger.log(
      `Inventory reset for site ${site} by user ${actor.id}. Removed ${deletedEntries} stock entries.`,
    );
    return { active: false, activatedAt: null };
  }

  async itemOptions(site: string, search?: string) {
    const result = await this.materials.findAll({
      site,
      catalog: true,
      search,
      page: 1,
      limit: 20,
    });
    const items = result.items.filter(
      (item) => inventoryCode(item.productCode) !== 'NMP',
    );
    const pinned = await this.entries.aggregate<{ _id: string; unit: string }>([
      { $match: { site } },
      { $unwind: '$lines' },
      {
        $match: {
          'lines.productCode': {
            $in: items.map((item) => inventoryCode(item.productCode)),
          },
        },
      },
      {
        $group: {
          _id: '$lines.productCode',
          unit: { $first: '$lines.unitOfMeasures' },
        },
      },
    ]);
    const units = new Map(pinned.map((item) => [item._id, item.unit]));
    return {
      items: items.map((item) => ({
        productCode: inventoryCode(item.productCode),
        name: item.name,
        unitOfMeasures:
          units.get(inventoryCode(item.productCode)) ??
          inventoryCode(item.unitOfMeasures),
      })),
    };
  }

  private async transaction<T>(work: (session: ClientSession) => Promise<T>) {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(() => work(session));
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code === 20 || code === 303) {
        throw new ConflictException(
          'Inventory is not ready. Ask the administrator to enable database transaction support before activating inventory.',
        );
      }
      if (code === 11000)
        throw new ConflictException(
          'This inventory transaction was already saved. Refresh the page.',
        );
      throw error;
    } finally {
      await session.endSession();
    }
  }

  // Every inventory write locks the site state inside the same transaction.
  // This serializes corrections and keeps the activation boundary consistent.
  private async lock(site: string, session: ClientSession) {
    const state = await this.states
      .findOneAndUpdate(
        { site },
        { $inc: { revision: 1 } },
        { returnDocument: 'after', session },
      )
      .lean();
    if (!state)
      throw new BadRequestException(
        'Import opening inventory to activate this site first.',
      );
    return state;
  }

  async normalizeLines(
    site: string,
    input: InventoryLineDto[],
    receipt: boolean,
    session?: ClientSession,
    convert = false,
  ) {
    if (!input.length || input.length > 5000)
      throw new BadRequestException('Provide between 1 and 5000 item rows.');
    const materials = await this.materials.findLookupsByNormalizedCodes(
      input.map((line) => line.productCode),
    );
    const byCode = new Map(
      materials.map((item) => [inventoryCode(item.productCode), item]),
    );
    const pinned = await this.entries
      .aggregate<{
        _id: string;
        unit: string;
      }>([
        { $match: { site } },
        { $unwind: '$lines' },
        { $match: { 'lines.productCode': { $in: [...byCode.keys()] } } },
        {
          $group: {
            _id: '$lines.productCode',
            unit: { $first: '$lines.unitOfMeasures' },
          },
        },
      ])
      .session(session ?? null);
    const pinnedUnits = new Map(pinned.map((line) => [line._id, line.unit]));
    const normalized = new Map<string, InventoryLine>();
    for (const line of input) {
      const code = inventoryCode(line.productCode);
      if (code === 'NMP')
        throw new BadRequestException(
          'NMP items are not included in inventory.',
        );
      const material = byCode.get(code);
      if (!material)
        throw new BadRequestException(
          `Unknown master item: ${line.productCode}.`,
        );
      const targetUnit =
        pinnedUnits.get(code) ?? inventoryCode(material.unitOfMeasures);
      const fromUnit = inventoryCode(line.unitOfMeasures);
      if (!convert && fromUnit !== targetUnit) {
        throw new BadRequestException(
          `${code}: use inventory unit ${targetUnit}.`,
        );
      }
      let globalMultiplier: number | undefined;
      if (convert && fromUnit !== targetUnit) {
        const direct = await this.units.findActiveConversion(
          fromUnit,
          targetUnit,
        );
        if (direct) globalMultiplier = direct.multiplier;
        else {
          const inverse = await this.units.findActiveConversion(
            targetUnit,
            fromUnit,
          );
          if (inverse && inverse.multiplier > 0)
            globalMultiplier = 1 / inverse.multiplier;
        }
      }
      const quantity = inventoryQuantity(
        line.quantity,
        fromUnit,
        targetUnit,
        material,
        globalMultiplier,
      );
      if (receipt && quantity <= 0)
        throw new BadRequestException(
          `${code}: received quantity must be greater than zero.`,
        );
      const existing = normalized.get(code);
      if (existing && !convert)
        throw new BadRequestException(`Duplicate item: ${code}.`);
      const combined = roundInventory(quantity + (existing?.quantity ?? 0));
      if (combined > 1e12)
        throw new BadRequestException(`${code}: quantity is too large.`);
      normalized.set(code, {
        productCode: code,
        name: material.name,
        unitOfMeasures: targetUnit,
        quantity: combined,
      });
    }
    return [...normalized.values()];
  }

  async previewOpening(
    site: string,
    buffer: Buffer,
    actor: Actor,
    allowAdditional = false,
  ) {
    const active = (await this.status(site)).active;
    if (active && !allowAdditional)
      throw new ConflictException(
        'Opening inventory has already been imported for this site.',
      );
    const workbook = new Workbook();
    try {
      await workbook.xlsx.load(new Uint8Array(buffer).buffer);
    } catch {
      throw new BadRequestException('The file must be a valid .xlsx workbook.');
    }
    const sheet = workbook.worksheets[0];
    if (!sheet || sheet.rowCount < 2 || sheet.rowCount > 5001) {
      throw new BadRequestException(
        'The workbook must contain a header and between 1 and 5000 item rows.',
      );
    }
    const headers = [1, 2, 3].map((column) =>
      sheet.getRow(1).getCell(column).text.trim(),
    );
    if (headers.join('|') !== 'Kode Item|Satuan|Jumlah Stok Awal') {
      throw new BadRequestException(
        'Use the opening inventory template: Kode Item, Satuan, Jumlah Stok Awal.',
      );
    }
    const rows: Array<{
      row: number;
      productCode: string;
      unitOfMeasures: string;
      quantity: number | null;
      error?: string;
      name?: string;
    }> = [];
    const seen = new Set<string>();
    const raw: InventoryLineDto[] = [];
    for (let index = 2; index <= sheet.rowCount; index++) {
      const row = sheet.getRow(index);
      const productCode = inventoryCode(row.getCell(1).text);
      const unitOfMeasures = inventoryCode(row.getCell(2).text);
      const quantityCell = row.getCell(3);
      if (!productCode && !unitOfMeasures && !quantityCell.text.trim())
        continue;
      const quantity =
        typeof quantityCell.value === 'number'
          ? quantityCell.value
          : Number.NaN;
      let error: string | undefined;
      if (!productCode || !unitOfMeasures)
        error = 'Kode item dan satuan wajib diisi.';
      else if (seen.has(productCode)) error = 'Kode item duplikat.';
      else if (
        !Number.isFinite(quantity) ||
        quantity < 0 ||
        quantity > 1e12 ||
        roundInventory(quantity) !== quantity
      )
        error =
          'Jumlah harus angka 0–1.000.000.000.000 dengan maksimal 6 desimal.';
      seen.add(productCode);
      raw.push({ productCode, unitOfMeasures, quantity });
      rows.push({
        row: index,
        productCode,
        unitOfMeasures,
        quantity: Number.isFinite(quantity) ? quantity : null,
        error,
      });
    }
    // Resolve master data in one query; each row keeps its own validation error.
    const materials = await this.materials.findLookupsByNormalizedCodes(
      raw.map((line) => line.productCode),
    );
    const byCode = new Map(
      materials.map((item) => [inventoryCode(item.productCode), item]),
    );
    const recorded = active
      ? new Set(await this.entries.distinct('lines.productCode', { site }))
      : new Set<string>();
    for (const row of rows) {
      const material = byCode.get(row.productCode);
      row.name = material?.name;
      if (row.error) continue;
      if (active && !row.productCode.startsWith('IT')) {
        row.error = 'Additional opening balances require an IT product code.';
        continue;
      }
      if (recorded.has(row.productCode)) {
        row.error = 'This item already has inventory history for this site.';
        continue;
      }
      if (row.productCode === 'NMP')
        row.error = 'NMP tidak termasuk inventory.';
      else if (!material) row.error = 'Kode item tidak ada di master.';
      else if (row.unitOfMeasures !== inventoryCode(material.unitOfMeasures))
        row.error = `Gunakan satuan ${material.unitOfMeasures}.`;
    }
    const valid = rows.length > 0 && rows.every((row) => !row.error);
    const preview = valid
      ? await this.previews.create({
          site,
          actorId: actor.id,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
          lines: rows.map((row) => ({
            productCode: row.productCode,
            name: row.name!,
            unitOfMeasures: row.unitOfMeasures,
            quantity: row.quantity!,
          })),
        })
      : null;
    return {
      rows,
      valid,
      previewId: preview ? String(preview._id) : undefined,
    };
  }

  async confirmOpening(
    site: string,
    previewId: string,
    actor: Actor,
    allowAdditional = false,
  ) {
    return this.transaction(async (session) => {
      const preview = await this.previews
        .findOne({
          _id: previewId,
          site,
          actorId: actor.id,
          expiresAt: { $gt: new Date() },
        })
        .session(session)
        .lean();
      if (!preview)
        throw new BadRequestException(
          'The opening preview expired or belongs to another site or user. Upload the file again.',
        );
      const active =
        allowAdditional &&
        (await this.states.exists({ site }).session(session));
      const result = active
        ? await this.addOpening(site, previewId, preview.lines, actor, session)
        : await this.activateInSession(site, preview.lines, actor, session);
      // A concurrent reset that removed this preview must invalidate the confirmation.
      const updated = await this.previews.updateOne(
        { _id: preview._id },
        { $currentDate: { updatedAt: true } },
        { session, timestamps: false },
      );
      if (!updated.matchedCount)
        throw new ConflictException(
          'The opening preview is no longer available. Upload the file again.',
        );
      return result;
    });
  }

  private async addOpening(
    site: string,
    previewId: string,
    input: InventoryLineDto[],
    actor: Actor,
    session: ClientSession,
  ) {
    const state = await this.lock(site, session);
    const sourceKey = `opening-addition:${previewId}`;
    if (await this.entries.exists({ site, sourceKey }).session(session))
      return { active: true, activatedAt: state.activatedAt };
    if (input.some((line) => !inventoryCode(line.productCode).startsWith('IT')))
      throw new BadRequestException(
        'Additional opening balances require IT product codes.',
      );
    const lines = await this.normalizeLines(site, input, false, session);
    const recorded = await this.entries
      .exists({
        site,
        'lines.productCode': { $in: lines.map((line) => line.productCode) },
      })
      .session(session);
    if (recorded)
      throw new ConflictException(
        'An item already has inventory history for this site. Upload only new IT items.',
      );
    await this.entries.create(
      [
        {
          site,
          sourceKey,
          kind: 'opening',
          occurredAt: new Date(),
          actor: `${actor.name} (${actor.id})`,
          note: 'Additional opening balance for new IT items.',
          lines,
        },
      ],
      { session },
    );
    return { active: true, activatedAt: state.activatedAt };
  }

  async activate(site: string, input: InventoryLineDto[], actor: Actor) {
    return this.transaction((session) =>
      this.activateInSession(site, input, actor, session),
    );
  }

  private async activateInSession(
    site: string,
    input: InventoryLineDto[],
    actor: Actor,
    session: ClientSession,
  ) {
    if (await this.states.exists({ site }).session(session))
      throw new ConflictException(
        'Opening inventory has already been imported for this site.',
      );
    const lines = await this.normalizeLines(site, input, false, session);
    const activatedAt = new Date();
    await this.states.create([{ site, activatedAt, revision: 0 }], {
      session,
    });
    await this.entries.create(
      [
        {
          site,
          sourceKey: 'opening',
          kind: 'opening',
          occurredAt: activatedAt,
          actor: `${actor.name} (${actor.id})`,
          lines,
        },
      ],
      { session },
    );
    return { active: true, activatedAt };
  }

  private purchaseOrderKey(reference: string) {
    return `receipt-po:${inventoryCode(reference)}`;
  }

  async previewPurchaseOrders(site: string, buffer: Buffer) {
    const { groups, skipped } = await readPurchaseOrders(buffer);
    if (!(await this.status(site)).active)
      throw new BadRequestException('Record opening inventory first.');
    const existing = await this.entries
      .find({
        site,
        sourceKey: {
          $in: groups.map((group) => this.purchaseOrderKey(group.reference)),
        },
      })
      .select('sourceKey')
      .lean();
    const imported = new Set(existing.map((entry) => entry.sourceKey));
    const materials = await this.materials.findLookupsByNormalizedCodes(
      groups.flatMap((group) => group.rows.map((row) => row.productCode)),
    );
    const byCode = new Map(
      materials.map((item) => [inventoryCode(item.productCode), item]),
    );
    return {
      skipped,
      groups: groups.map((group) => ({
        ...group,
        rows: group.rows.map((row) => ({
          ...row,
          name:
            byCode.get(row.productCode)?.name ??
            'Item not found in SPICES master',
          unitOfMeasures:
            inventoryCode(byCode.get(row.productCode)?.unitOfMeasures ?? '') ||
            '-',
        })),
        alreadyImported: imported.has(this.purchaseOrderKey(group.reference)),
      })),
    };
  }

  async confirmPurchaseOrders(
    site: string,
    buffer: Buffer,
    input: ConfirmPurchaseOrderDto,
    actor: Actor,
  ) {
    const { groups } = await readPurchaseOrders(buffer);
    let quantities: unknown;
    try {
      quantities = JSON.parse(input.quantities) as unknown;
    } catch {
      throw new BadRequestException('Invalid received quantities.');
    }
    if (
      !quantities ||
      typeof quantities !== 'object' ||
      Array.isArray(quantities)
    )
      throw new BadRequestException('Invalid received quantities.');

    const byRow = new Map(Object.entries(quantities));
    let dates: Record<string, unknown> = {};
    if (input.receivedDates !== undefined) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(input.receivedDates) as unknown;
      } catch {
        throw new BadRequestException('Invalid received dates.');
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new BadRequestException('Invalid received dates.');
      dates = Object.fromEntries(Object.entries(parsed));
    }
    const receipts = groups.flatMap(({ reference, rows }) => {
      if (!rows.some(({ row }) => byRow.has(String(row)))) return [];
      const lines = rows.flatMap(({ row, productCode, unitOfMeasures }) => {
        const quantity: unknown = byRow.get(String(row));
        byRow.delete(String(row));
        if (!isPoQuantity(quantity))
          throw new BadRequestException(
            `Row ${row}: enter a valid received quantity.`,
          );
        return quantity > 0 ? [{ productCode, unitOfMeasures, quantity }] : [];
      });
      if (!lines.length) return [];
      const receivedDate =
        input.receivedDates === undefined
          ? input.receivedDate
          : dates[reference];
      if (
        typeof receivedDate !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(receivedDate) ||
        !isISO8601(receivedDate, { strict: true })
      )
        throw new BadRequestException(
          `PO ${reference}: enter a valid received date.`,
        );
      return [{ reference, lines, receivedDate }];
    });
    if (byRow.size || !receipts.length)
      throw new BadRequestException(
        'Confirm at least one eligible item with a positive quantity.',
      );

    return this.transaction(async (session) => {
      await this.lock(site, session);
      const materials = await this.materials.findLookupsByNormalizedCodes(
        receipts.flatMap((receipt) =>
          receipt.lines.map((line) => line.productCode),
        ),
      );
      const masterUnits = new Map(
        materials.map((item) => [
          inventoryCode(item.productCode),
          inventoryCode(item.unitOfMeasures),
        ]),
      );
      const entries: InventoryEntry[] = [];
      for (const receipt of receipts) {
        const sourceKey = this.purchaseOrderKey(receipt.reference);
        if (await this.entries.exists({ site, sourceKey }).session(session))
          throw new ConflictException(
            `PO ${receipt.reference} has already been imported.`,
          );
        let lines: InventoryLine[];
        try {
          lines = await this.normalizeLines(
            site,
            receipt.lines.map((line) => {
              const unitOfMeasures = masterUnits.get(line.productCode);
              if (!unitOfMeasures)
                throw new BadRequestException(
                  `Unknown master item or missing UOM: ${line.productCode}.`,
                );
              return { ...line, unitOfMeasures };
            }),
            true,
            session,
            true,
          );
        } catch (error) {
          if (error instanceof BadRequestException)
            throw new BadRequestException(
              `PO ${receipt.reference}: ${error.message}`,
            );
          throw error;
        }
        entries.push({
          site,
          sourceKey,
          kind: 'receipt',
          occurredAt: new Date(`${receipt.receivedDate}T00:00:00+07:00`),
          actor: `${actor.name} (${actor.id})`,
          reference: receipt.reference,
          lines,
        });
      }
      await this.entries.create(entries, { session, ordered: true });
      return { count: entries.length };
    });
  }

  async createReceipt(
    site: string,
    input: CreateInventoryReceiptDto,
    actor: Actor,
    replacingReceiptId?: string,
  ) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.receivedDate))
      throw new BadRequestException('Received date must use YYYY-MM-DD.');
    if (replacingReceiptId && !Types.ObjectId.isValid(replacingReceiptId))
      throw new BadRequestException('Invalid receipt identifier.');
    const supplier = input.supplier?.trim() || undefined;
    const hash = createHash('sha256')
      .update(JSON.stringify({ ...input, requestId: undefined }))
      .digest('hex');
    return this.transaction(async (session) => {
      await this.lock(site, session);
      const sourceKey = replacingReceiptId
        ? `receipt-edit:${replacingReceiptId}:${input.requestId}`
        : `receipt:${input.requestId}`;
      const existing = await this.entries
        .findOne({ site, sourceKey })
        .session(session)
        .lean();
      if (existing) {
        if (existing.payloadHash !== hash)
          throw new ConflictException(
            'This request identifier was already used for another receipt.',
          );
        return existing;
      }
      const original = replacingReceiptId
        ? await this.entries
            .findOne({ _id: replacingReceiptId, site, kind: 'receipt' })
            .session(session)
            .lean()
        : null;
      if (replacingReceiptId && !original)
        throw new NotFoundException('Receipt not found.');
      if (original?.reversedAt)
        throw new ConflictException(
          'This receipt has already been cancelled or edited. Refresh the movement list.',
        );
      const lines = await this.normalizeLines(site, input.lines, true, session);
      if (original) {
        await this.assertStockAvailable(
          site,
          inventoryDelta(lines, original.lines),
          session,
        );
        const cancelledAt = new Date();
        await this.entries.create(
          [
            {
              site,
              sourceKey: `reverse:${replacingReceiptId}`,
              kind: 'receipt-reversal',
              occurredAt: cancelledAt,
              actor: `${actor.name} (${actor.id})`,
              reference: replacingReceiptId,
              note: 'Cancelled automatically when editing this receipt.',
              lines: original.lines.map((line) => ({
                ...line,
                quantity: -line.quantity,
              })),
            },
          ],
          { session },
        );
        await this.entries.updateOne(
          { _id: original._id, site },
          { $set: { reversedAt: cancelledAt } },
          { session },
        );
      }
      const [entry] = await this.entries.create(
        [
          {
            site,
            sourceKey,
            kind: 'receipt',
            occurredAt: new Date(`${input.receivedDate}T00:00:00+07:00`),
            actor: `${actor.name} (${actor.id})`,
            supplier,
            reference: input.reference?.trim(),
            note: input.note?.trim(),
            payloadHash: hash,
            lines,
          },
        ],
        { session },
      );
      return entry.toObject();
    });
  }

  async reverseReceipt(site: string, id: string, reason: string, actor: Actor) {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException('Invalid receipt identifier.');
    if (!reason.trim())
      throw new BadRequestException('A reversal reason is required.');
    return this.transaction(async (session) => {
      await this.lock(site, session);
      const receipt = await this.entries
        .findOne({ _id: id, site, kind: 'receipt' })
        .session(session)
        .lean();
      if (!receipt) throw new NotFoundException('Receipt not found.');
      if (receipt.reversedAt) return { reversed: true };
      const lines = receipt.lines.map((line) => ({
        ...line,
        quantity: -line.quantity,
      }));
      await this.assertStockAvailable(site, lines, session);
      const reversedAt = new Date();
      await this.entries.create(
        [
          {
            site,
            sourceKey: `reverse:${id}`,
            kind: 'receipt-reversal',
            occurredAt: reversedAt,
            actor: `${actor.name} (${actor.id})`,
            reference: id,
            note: reason.trim(),
            lines,
          },
        ],
        { session },
      );
      await this.entries.updateOne(
        { _id: id, site },
        { $set: { reversedAt } },
        { session },
      );
      return { reversed: true };
    });
  }

  async receipt(site: string, id: string) {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException('Invalid receipt identifier.');
    const entry = await this.entries
      .findOne({ _id: id, site, kind: 'receipt' })
      .lean();
    if (!entry) throw new NotFoundException('Receipt not found.');
    return entry;
  }

  async balances(site: string, query: InventoryQueryDto) {
    const dates: string[] = [];
    if (query.from || query.to) {
      if (!query.from || !query.to || query.asOf)
        throw new BadRequestException(
          'Provide both start and end dates for daily stock.',
        );
      const start = query.from.slice(0, 10);
      const end = query.to.slice(0, 10);
      if (start > end)
        throw new BadRequestException('Start date must not be after end date.');
      const days = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
      if (!Number.isFinite(days) || days > 366)
        throw new BadRequestException(
          'Select a stock date range of at most 366 days.',
        );
      for (let day = Date.parse(end); day >= Date.parse(start); day -= 86400000)
        dates.push(new Date(day).toISOString().slice(0, 10));
    }
    const cutoff = dates[0] ?? query.asOf;
    const search = query.search?.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pipeline: import('mongoose').PipelineStage[] = [
      ...(cutoff ? productionDatedMovements(site) : []),
      {
        $match: {
          site,
          ...(cutoff
            ? {
                occurredAt: {
                  $lte: new Date(`${cutoff}T23:59:59.999+07:00`),
                },
              }
            : {}),
        },
      },
      { $unwind: '$lines' },
      ...(dates.length
        ? [
            {
              $group: {
                _id: {
                  code: '$lines.productCode',
                  unit: '$lines.unitOfMeasures',
                  day: {
                    $dateToString: {
                      date: '$occurredAt',
                      format: '%Y-%m-%d',
                      timezone: 'Asia/Jakarta',
                    },
                  },
                },
                name: { $last: '$lines.name' },
                quantity: { $sum: '$lines.quantity' },
              },
            },
            {
              $project: {
                lines: {
                  productCode: '$_id.code',
                  unitOfMeasures: '$_id.unit',
                  name: '$name',
                  quantity: '$quantity',
                },
                day: '$_id.day',
              },
            },
          ]
        : []),
      {
        $group: {
          _id: { code: '$lines.productCode', unit: '$lines.unitOfMeasures' },
          name: { $last: '$lines.name' },
          quantity: { $sum: '$lines.quantity' },
          ...(dates.length
            ? {
                dailyDeltas: {
                  $push: { day: '$day', quantity: '$lines.quantity' },
                },
              }
            : {}),
        },
      },
      {
        $project: {
          _id: 0,
          productCode: '$_id.code',
          unitOfMeasures: '$_id.unit',
          name: 1,
          quantity: { $round: ['$quantity', 6] },
          ...(dates.length ? { dailyDeltas: 1 } : {}),
        },
      },
    ];
    if (search)
      pipeline.push({
        $match: {
          $or: [
            { productCode: { $regex: search, $options: 'i' } },
            { name: { $regex: search, $options: 'i' } },
          ],
        },
      });
    pipeline.push(
      { $sort: { productCode: 1 } },
      {
        $facet: {
          items: [
            { $skip: (query.page - 1) * query.limit },
            { $limit: query.limit },
          ],
          total: [{ $count: 'count' }],
        },
      },
    );
    const [result] = await this.entries.aggregate<{
      items: (Balance & {
        dailyDeltas?: { day: string; quantity: number }[];
      })[];
      total: Array<{ count: number }>;
    }>(pipeline);
    return {
      items: (result?.items ?? []).map(({ dailyDeltas, ...item }) => {
        if (!dates.length) return item;
        const deltas = (dailyDeltas ?? []).sort((a, b) =>
          a.day.localeCompare(b.day),
        );
        const quantities: Record<string, number> = {};
        let balance = 0;
        let index = 0;
        for (const day of [...dates].reverse()) {
          while (index < deltas.length && deltas[index].day <= day) {
            balance += deltas[index].quantity;
            index += 1;
          }
          quantities[day] = roundInventory(balance);
        }
        return { ...item, quantities };
      }),
      ...(dates.length ? { dates } : {}),
      total: result?.total[0]?.count ?? 0,
      page: query.page,
      limit: query.limit,
    };
  }

  async dashboardStock(site: string) {
    const status = await this.status(site);
    if (!status.active) return { ...status, items: [] };

    const items = await this.entries.aggregate<Balance>([
      { $match: { site } },
      { $sort: { occurredAt: 1, _id: 1 } },
      { $unwind: '$lines' },
      {
        $group: {
          _id: { code: '$lines.productCode', unit: '$lines.unitOfMeasures' },
          name: { $last: '$lines.name' },
          quantity: { $sum: '$lines.quantity' },
        },
      },
      {
        $project: {
          _id: 0,
          productCode: '$_id.code',
          unitOfMeasures: '$_id.unit',
          name: 1,
          quantity: { $round: ['$quantity', 6] },
        },
      },
    ]);
    return { ...status, items };
  }

  private dashboardItem(query: InventoryDashboardQueryDto) {
    const code = query.productCode?.trim();
    if (!code) throw new BadRequestException('Select an inventory item.');
    return { 'lines.productCode': inventoryCode(code) };
  }

  async dashboardHistory(site: string, query: InventoryDashboardQueryDto) {
    return this.history(
      site,
      { ...query, search: undefined, view: 'lines' },
      false,
      this.dashboardItem(query),
    );
  }

  async dashboardTrend(site: string, query: InventoryDashboardQueryDto) {
    const from = query.from?.slice(0, 10);
    const to = query.to?.slice(0, 10);
    const days = (Date.parse(to ?? '') - Date.parse(from ?? '')) / 86400000 + 1;
    if (!from || !to || !Number.isFinite(days) || days < 1 || days > 366) {
      throw new BadRequestException('Select a date range of 1 to 366 days.');
    }

    const lineFilter =
      query.productCode !== undefined ? this.dashboardItem(query) : undefined;
    const groupBy =
      query.productCode !== undefined
        ? {
            $dateToString: {
              date: '$occurredAt',
              format: '%Y-%m-%d',
              timezone: 'Asia/Jakarta',
            },
          }
        : '$lines.productCode';
    type MovementTotals = { stockIn: number; stockOut: number };
    type MovementRow = MovementTotals & { _id: string };
    const [result] = await this.entries.aggregate<{
      rows: MovementRow[];
      totals: MovementTotals[];
    }>([
      ...productionDatedMovements(site),
      {
        $match: {
          site,
          kind: { $ne: 'opening' },
          occurredAt: {
            $gte: new Date(`${from}T00:00:00+07:00`),
            $lte: new Date(`${to}T23:59:59.999+07:00`),
          },
        },
      },
      { $unwind: '$lines' },
      ...(lineFilter ? [{ $match: lineFilter }] : []),
      {
        $group: {
          _id: groupBy,
          stockIn: { $sum: { $max: ['$lines.quantity', 0] } },
          stockOut: {
            $sum: { $max: [{ $multiply: ['$lines.quantity', -1] }, 0] },
          },
        },
      },
      {
        $facet: {
          rows:
            query.productCode === undefined
              ? [
                  {
                    $addFields: {
                      movement: { $add: ['$stockIn', '$stockOut'] },
                    },
                  },
                  { $match: { movement: { $gt: 0 } } },
                  { $sort: { movement: -1, _id: 1 } },
                  { $limit: 10 },
                ]
              : [],
          totals: [
            {
              $group: {
                _id: null,
                stockIn: { $sum: '$stockIn' },
                stockOut: { $sum: '$stockOut' },
              },
            },
          ],
        },
      },
    ]);
    const rows = result?.rows ?? [];
    const totals = {
      stockIn: roundInventory(result?.totals[0]?.stockIn ?? 0),
      stockOut: roundInventory(result?.totals[0]?.stockOut ?? 0),
    };
    if (query.productCode === undefined) {
      return {
        points: [],
        totals,
        items: rows.map((row) => ({
          productCode: row._id,
          stockIn: roundInventory(row.stockIn),
          stockOut: roundInventory(row.stockOut),
        })),
        hasData: rows.length > 0,
      };
    }
    const byDate = new Map(rows.map((row) => [row._id, row]));
    const points = Array.from({ length: days }, (_, index) => {
      const date = new Date(Date.parse(from) + index * 86400000)
        .toISOString()
        .slice(0, 10);
      const row = byDate.get(date);
      return {
        date,
        stockIn: roundInventory(row?.stockIn ?? 0),
        stockOut: roundInventory(row?.stockOut ?? 0),
      };
    });
    return { points, items: [], totals, hasData: rows.length > 0 };
  }

  async previewIssue(site: string, input: InventoryLineDto[]) {
    if (!(await this.status(site)).active)
      return { active: false, shortages: [] };
    const tracked = input.filter(
      (line) => inventoryCode(line.productCode) !== 'NMP',
    );
    const lines = tracked.length
      ? await this.normalizeLines(site, tracked, false, undefined, true)
      : [];
    return { active: true, shortages: await this.stockShortages(site, lines) };
  }

  private async stockShortages(
    site: string,
    deductions: InventoryLine[],
    session?: ClientSession,
  ) {
    if (!deductions.length) return [];
    const query = this.entries.aggregate<InventoryLine>([
      { $match: { site } },
      { $unwind: '$lines' },
      {
        $match: {
          'lines.productCode': {
            $in: deductions.map((line) => line.productCode),
          },
        },
      },
      {
        $group: {
          _id: { code: '$lines.productCode', unit: '$lines.unitOfMeasures' },
          quantity: { $sum: '$lines.quantity' },
        },
      },
      {
        $project: {
          _id: 0,
          productCode: '$_id.code',
          unitOfMeasures: '$_id.unit',
          quantity: 1,
        },
      },
    ]);
    const balances = await (session ? query.session(session) : query);
    const onHand = new Map(
      balances.map((line) => [
        `${line.productCode}::${line.unitOfMeasures}`,
        line.quantity,
      ]),
    );
    return deductions.flatMap((line) => {
      const available = roundInventory(
        onHand.get(`${line.productCode}::${line.unitOfMeasures}`) ?? 0,
      );
      const remaining = roundInventory(available - line.quantity);
      return remaining < 0 ? [{ ...line, available, remaining }] : [];
    });
  }

  private async assertStockAvailable(
    site: string,
    delta: InventoryLine[],
    session: ClientSession,
  ) {
    const deductions = delta
      .filter((line) => line.quantity < 0)
      .map((line) => ({ ...line, quantity: -line.quantity }));
    const shortages = await this.stockShortages(site, deductions, session);
    const first = shortages[0];
    if (first) {
      throw new ConflictException(
        `Insufficient stock for ${first.productCode}: ${first.available} ${first.unitOfMeasures} on hand, ${first.quantity} required. Refresh stock and adjust the quantity.`,
      );
    }
  }

  async history(
    site: string,
    query: InventoryQueryDto,
    receiptsOnly = false,
    exactItem?: Record<string, string>,
  ) {
    const filter: Record<string, unknown> = { site };
    if (receiptsOnly) filter.kind = 'receipt';
    if (query.from && query.to && query.from > query.to)
      throw new BadRequestException('Start date must not be after end date.');
    if (query.from || query.to)
      filter.occurredAt = {
        ...(query.from
          ? { $gte: new Date(`${query.from.slice(0, 10)}T00:00:00+07:00`) }
          : {}),
        ...(query.to
          ? { $lte: new Date(`${query.to.slice(0, 10)}T23:59:59.999+07:00`) }
          : {}),
      };
    if (query.search?.trim()) {
      const regex = new RegExp(
        query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i',
      );
      filter.$or = [{ 'lines.productCode': regex }, { 'lines.name': regex }];
    }
    if (!receiptsOnly && query.view === 'lines') {
      type MovementEntry = Omit<InventoryEntry, 'lines'> & {
        _id: Types.ObjectId;
        createdAt: Date;
        lines: InventoryLine;
        lineIndex: number;
      };
      const [result] = await this.entries.aggregate<{
        items: MovementEntry[];
        count: Array<{ total: number }>;
      }>([
        ...productionDatedMovements(site),
        { $match: filter },
        { $unwind: { path: '$lines', includeArrayIndex: 'lineIndex' } },
        ...(exactItem ? [{ $match: exactItem }] : []),
        // Apply the product filter again after unwind so sibling items do not leak in.
        ...(filter.$or ? [{ $match: { $or: filter.$or } }] : []),
        { $sort: { occurredAt: -1, _id: -1, lineIndex: 1 } },
        {
          $facet: {
            items: [
              { $skip: (query.page - 1) * query.limit },
              { $limit: query.limit },
            ],
            count: [{ $count: 'total' }],
          },
        },
      ]);
      const rows = result?.items ?? [];
      const receiptIds = rows
        .filter(
          (entry) =>
            entry.kind === 'receipt-reversal' &&
            entry.reference &&
            Types.ObjectId.isValid(entry.reference),
        )
        .map((entry) => new Types.ObjectId(entry.reference));
      const receipts = receiptIds.length
        ? await this.entries
            .find({ site, kind: 'receipt', _id: { $in: receiptIds } })
            .select({ reference: 1 })
            .lean()
        : [];
      const poById = new Map(
        receipts.map((entry) => [String(entry._id), entry.reference]),
      );
      const items = rows.map((entry) => {
        const parts =
          entry.kind === 'issue' ? entry.reference?.split('__') : undefined;
        const code = parts?.length === 3 ? parts[2] : undefined;
        return {
          _id: String(entry._id),
          lineIndex: entry.lineIndex,
          kind: entry.kind,
          occurredAt: entry.occurredAt,
          createdAt: entry.createdAt,
          actor: entry.actor.replace(/\s*\([^)]*\)\s*$/, ''),
          supplier: entry.supplier,
          reference: entry.reference,
          note: entry.note,
          reversedAt: entry.reversedAt,
          poNumber:
            entry.kind === 'receipt'
              ? entry.reference
              : entry.kind === 'receipt-reversal'
                ? poById.get(entry.reference ?? '')
                : undefined,
          productionCode:
            code && !Types.ObjectId.isValid(code) ? code : undefined,
          ...entry.lines,
        };
      });
      return {
        items,
        total: result?.count[0]?.total ?? 0,
        page: query.page,
        limit: query.limit,
      };
    }
    if (!receiptsOnly) {
      const [page] = await this.entries.aggregate<{
        items: (InventoryEntry & { _id: Types.ObjectId })[];
        count: { total: number }[];
      }>([
        ...productionDatedMovements(site),
        { $match: filter },
        { $sort: { occurredAt: -1, _id: -1 } },
        {
          $facet: {
            items: [
              { $skip: (query.page - 1) * query.limit },
              { $limit: query.limit },
            ],
            count: [{ $count: 'total' }],
          },
        },
      ]);
      return {
        items: page?.items ?? [],
        total: page?.count[0]?.total ?? 0,
        page: query.page,
        limit: query.limit,
      };
    }
    const [items, total] = await Promise.all([
      this.entries
        .find(filter)
        .sort({ occurredAt: -1, _id: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      this.entries.countDocuments(filter),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  async assertLegacyStatusAllowed(site?: string) {
    if (site && (await this.status(inventoryCode(site))).active) {
      throw new BadRequestException(
        'Use batch reconciliation with actual quantities for sites with active inventory.',
      );
    }
  }

  async assertDeletable(ids: string[], session?: ClientSession) {
    const issued = await this.issues
      .find({ menuProductionIds: { $in: ids } })
      .session(session ?? null)
      .lean();
    if (
      issued.some((issue) => issue.lines.some((line) => line.quantity !== 0))
    ) {
      throw new ConflictException(
        'This batch affects inventory. Cancel its issuance to reverse inventory before deleting it.',
      );
    }
  }

  async withSite<T>(
    site: string | undefined,
    work: (session?: ClientSession) => Promise<T>,
  ) {
    const code = site ? inventoryCode(site) : undefined;
    if (!code || !(await this.status(code)).active) return work();
    return this.transaction(async (session) => {
      await this.lock(code, session);
      return work(session);
    });
  }

  async recordIssue(
    site: string,
    batchKey: string,
    productionDate: string,
    ids: string[],
    items: IssueInput[],
    actor: string,
    previousCompletedAt: Date | undefined,
    session: ClientSession,
  ) {
    site = inventoryCode(site);
    const state = await this.states.findOne({ site }).session(session).lean();
    if (!state) return;
    const previous = await this.issues
      .findOne({ site, batchKey })
      .session(session)
      .lean();
    if (previous?.excluded) return;
    // Historic completed batches are already represented in the imported balance.
    if (
      !previous &&
      previousCompletedAt &&
      previousCompletedAt <= state.activatedAt
    ) {
      await this.issues.create(
        [
          {
            site,
            batchKey,
            menuProductionIds: ids,
            revision: 0,
            lines: [],
            excluded: true,
          },
        ],
        { session },
      );
      return;
    }
    const tracked = items.filter(
      (item) => inventoryCode(item.productCode ?? '') !== 'NMP',
    );
    const lines = tracked.length
      ? await this.normalizeLines(
          site,
          tracked.map((item) => ({
            productCode: item.productCode ?? '',
            unitOfMeasures: item.unitOfMeasures ?? '',
            quantity: item.actualQty ?? 0,
          })),
          false,
          session,
          true,
        )
      : [];
    const delta = inventoryDelta(previous?.lines ?? [], lines);
    if (!delta.length && previous) return;
    await this.assertStockAvailable(site, delta, session);
    const revision = (previous?.revision ?? 0) + 1;
    await this.issues.updateOne(
      { site, batchKey },
      { $set: { lines, menuProductionIds: ids, revision } },
      { upsert: true, session },
    );
    if (delta.length)
      await this.entries.create(
        [
          {
            site,
            sourceKey: `issue:${batchKey}:${revision}`,
            kind: 'issue',
            occurredAt: new Date(`${productionDate}T00:00:00+07:00`),
            actor,
            reference: batchKey,
            note:
              revision > 1 ? 'Store Request correction / reversal' : undefined,
            lines: delta,
          },
        ],
        { session },
      );
  }
}
