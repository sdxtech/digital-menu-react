import { createConnection, type Connection, type Model } from 'mongoose';
import { randomUUID } from 'crypto';
import { Workbook } from 'exceljs';
import {
  InventoryEntry,
  InventoryEntrySchema,
  type InventoryEntryDocument,
  InventoryIssue,
  InventoryIssueSchema,
  type InventoryIssueDocument,
  InventoryState,
  InventoryStateSchema,
  type InventoryStateDocument,
  InventoryOpeningPreview,
  InventoryOpeningPreviewSchema,
  type InventoryOpeningPreviewDocument,
} from './inventory.schema';
import {
  Site,
  SiteSchema,
  type SiteDocument,
} from '../sites/schemas/site.schema';
import {
  MenuProduction,
  MenuProductionSchema,
  type MenuProductionDocument,
} from '../menu-productions/schemas/menu-production.schema';
import { MenuProductionsService } from '../menu-productions/menu-productions.service';
import type { RawMaterialsService } from '../raw-materials/raw-materials.service';
import type { UnitOfMeasuresService } from '../unit-of-measures/unit-of-measures.service';
import { InventoryQueryDto } from './inventory.dto';
import { InventoryService } from './inventory.service';

// Opt-in, isolated replica-set tests. Never connect to the application's database.
const uri = process.env.INVENTORY_TEST_MONGO_URI;
const integration = uri ? describe : describe.skip;
const line = { productCode: 'IT001', unitOfMeasures: 'KG', quantity: 10 };
const actor = { id: 'test-storekeeper', name: 'Storekeeper' };

integration('Inventory MongoDB transactions', () => {
  let connection: Connection;
  let entries: Model<InventoryEntryDocument>;
  let issues: Model<InventoryIssueDocument>;
  let states: Model<InventoryStateDocument>;
  let previews: Model<InventoryOpeningPreviewDocument>;
  let sites: Model<SiteDocument>;
  let menus: Model<MenuProductionDocument>;
  let inventory: InventoryService;
  let productions: MenuProductionsService;
  const material = {
    productCode: 'IT001',
    productCodeNormalized: 'it001',
    name: 'Rice',
    unitOfMeasures: 'KG',
    specificConversions: [],
  };
  const materials = {
    findLookupsByNormalizedCodes: jest.fn((codes: string[]) =>
      Promise.resolve(
        codes.some((code) => code.trim().toUpperCase() === 'IT001')
          ? [material]
          : [],
      ),
    ),
  };
  const units = { findActiveConversion: jest.fn().mockResolvedValue(null) };

  it('posts one receipt per PO and rejects a repeated import', async () => {
    const site = 'PO-IMPORT';
    await inventory.activate(site, [line], actor);
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRows([
      [
        'Display Name',
        'Order Lines/Product/Product Code',
        'Order Lines/Product',
        'Order Lines/Quantity',
        'Order Lines/Unit of Measure',
        'R',
      ],
      ['PO/1', 'IT001', 'Rice', 20, 'KG (KG)', null],
      [null, 'IT001', 'Rice', 15, 'KG', 0],
      [null, 'NMPNF20', 'Chemical', 1, 'PCS', 1],
    ]);
    const file = Buffer.from(await workbook.xlsx.writeBuffer());
    const input = {
      receivedDate: '2026-11-19',
      quantities: JSON.stringify({ 2: 18, 3: 0 }),
    };
    await expect(
      inventory.confirmPurchaseOrders(site, file, input, actor),
    ).resolves.toEqual({ count: 1 });
    const receipt = await entries.findOne({ site, kind: 'receipt' }).lean();
    expect(receipt).toMatchObject({
      reference: 'PO/1',
      lines: [{ productCode: 'IT001', quantity: 18, unitOfMeasures: 'KG' }],
    });
    await expect(
      inventory.confirmPurchaseOrders(site, file, input, actor),
    ).rejects.toThrow('already been imported');
    expect(await entries.countDocuments({ site, kind: 'receipt' })).toBe(1);
  });

  beforeAll(async () => {
    const parsed = new URL(uri!);
    if (
      !['127.0.0.1', 'localhost'].includes(parsed.hostname) ||
      parsed.port !== '27028'
    )
      throw new Error(
        'Inventory tests require an isolated local MongoDB on port 27028.',
      );
    connection = await createConnection(uri!, {
      dbName: `inventory_test_${randomUUID().replaceAll('-', '')}`,
      serverSelectionTimeoutMS: 10000,
    }).asPromise();
    entries = connection.model<InventoryEntryDocument>(
      InventoryEntry.name,
      InventoryEntrySchema,
    );
    issues = connection.model<InventoryIssueDocument>(
      InventoryIssue.name,
      InventoryIssueSchema,
    );
    states = connection.model<InventoryStateDocument>(
      InventoryState.name,
      InventoryStateSchema,
    );
    previews = connection.model<InventoryOpeningPreviewDocument>(
      InventoryOpeningPreview.name,
      InventoryOpeningPreviewSchema,
    );
    sites = connection.model<SiteDocument>(Site.name, SiteSchema);
    menus = connection.model<MenuProductionDocument>(
      MenuProduction.name,
      MenuProductionSchema,
    );
    await Promise.all([
      entries.init(),
      issues.init(),
      states.init(),
      previews.init(),
      sites.init(),
      menus.init(),
    ]);
    inventory = new InventoryService(
      connection,
      states,
      entries,
      issues,
      previews,
      sites,
      materials as unknown as RawMaterialsService,
      units as unknown as UnitOfMeasuresService,
    );
    productions = new MenuProductionsService(
      menus,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      materials as never,
      undefined,
      inventory,
    );
    Object.defineProperty(productions, 'buildGroupedStoreRequestsFromMenus', {
      value: (
        records: Array<{ productionDate: string; productionCode: string }>,
      ) =>
        Promise.resolve([
          {
            date: records[0].productionDate,
            productionCode: records[0].productionCode,
            summary: [
              {
                productCode: 'IT001',
                name: 'Rice',
                unitOfMeasures: 'KG',
                qty: 3,
              },
            ],
          },
        ]),
    });
  }, 30000);

  afterAll(async () => {
    if (connection) {
      if (!connection.name.startsWith('inventory_test_'))
        throw new Error('Refusing to remove a non-test database.');
      await connection.dropDatabase();
      await connection.close();
    }
  });

  beforeEach(async () => {
    await Promise.all([
      entries.deleteMany({}),
      issues.deleteMany({}),
      states.deleteMany({}),
      previews.deleteMany({}),
      menus.deleteMany({}),
      sites.deleteMany({}),
    ]);
    await sites.create([
      { code: 'S001', name: 'Site 1' },
      { code: 'S002', name: 'Site 2' },
    ]);
  });

  const activate = () => inventory.activate('S001', [line], actor);
  it('lets superadmin add new opening items once while preserving activation and existing balances', async () => {
    await activate();
    const original = await inventory.status('S001');
    const workbook = new Workbook();
    workbook.addWorksheet('Opening').addRows([
      ['Kode Item', 'Satuan', 'Jumlah Stok Awal'],
      ['IT002', 'KG', 7],
    ]);
    const file = Buffer.from(await workbook.xlsx.writeBuffer());
    await expect(inventory.previewOpening('S001', file, actor)).rejects.toThrow(
      'already been imported',
    );
    const newMaterial = {
      ...material,
      productCode: 'IT002',
      productCodeNormalized: 'it002',
    };
    materials.findLookupsByNormalizedCodes.mockResolvedValueOnce([newMaterial]);
    const preview = await inventory.previewOpening('S001', file, actor, true);
    expect(preview.valid).toBe(true);
    materials.findLookupsByNormalizedCodes.mockResolvedValueOnce([newMaterial]);
    const competing = await inventory.previewOpening('S001', file, actor, true);
    await expect(
      inventory.confirmOpening('S001', preview.previewId!, actor),
    ).rejects.toThrow('already been imported');
    materials.findLookupsByNormalizedCodes.mockResolvedValueOnce([newMaterial]);
    await Promise.all([
      inventory.confirmOpening('S001', preview.previewId!, actor, true),
      inventory.confirmOpening('S001', preview.previewId!, actor, true),
    ]);
    expect(await inventory.status('S001')).toEqual(original);
    const additions = await entries
      .find({ site: 'S001', sourceKey: { $regex: '^opening-addition:' } })
      .lean();
    expect(additions).toHaveLength(1);
    expect(additions[0].lines[0]).toMatchObject({
      productCode: 'IT002',
      quantity: 7,
    });
    materials.findLookupsByNormalizedCodes.mockResolvedValueOnce([newMaterial]);
    await expect(
      inventory.confirmOpening('S001', competing.previewId!, actor, true),
    ).rejects.toThrow('already has inventory history');
    const balances = await inventory.balances('S001', new InventoryQueryDto());
    expect(balances.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productCode: 'IT001', quantity: 10 }),
        expect.objectContaining({ productCode: 'IT002', quantity: 7 }),
      ]),
    );
    materials.findLookupsByNormalizedCodes.mockResolvedValueOnce([newMaterial]);
    const repeated = await inventory.previewOpening('S001', file, actor, true);
    expect(repeated.valid).toBe(false);
    expect(repeated.rows[0].error).toContain('already has inventory history');
  });
  const balance = async () =>
    (await inventory.balances('S001', new InventoryQueryDto())).items[0]
      ?.quantity ?? 0;
  const receipt = (quantity = 5, requestId = randomUUID()) =>
    inventory.createReceipt(
      'S001',
      {
        requestId,
        receivedDate: '2026-11-18',
        supplier: 'Supplier',
        lines: [{ ...line, quantity }],
      },
      actor,
    );
  const makeMenu = (extra = {}) =>
    menus.create({
      site: 'S001',
      productionDate: '2026-11-18',
      productionCode: 'MPR0001',
      menuName: 'Rice',
      category: 'Main',
      portion: 1,
      cost: 0,
      approvalStatus: 'approved',
      storeRequestStatus: 'requested',
      ...extra,
    });
  const fulfill = (id: string, quantity: number, override = false) =>
    productions.fulfillStoreRequestBatch(
      {
        menuProductionIds: [id],
        items: [
          {
            productCode: 'IT001',
            name: 'Rice',
            unitOfMeasures: 'KG',
            actualQty: quantity,
            reason: 'Actual delivery',
          },
        ],
      },
      'S001',
      'Storekeeper',
      { allowStatusOverride: override },
    );

  it('paginates movement items, filters siblings, and resolves original PO references within the site', async () => {
    const base = {
      site: 'S001',
      actor: 'Storekeeper',
      occurredAt: new Date('2026-11-18T12:00:00Z'),
    };
    const rice = { ...line, name: 'Rice', quantity: 5 };
    const fruit = {
      ...line,
      productCode: 'IT002',
      name: 'Papaya',
      quantity: 2.5,
    };
    const received = await entries.create({
      ...base,
      sourceKey: 'receipt:test',
      kind: 'receipt',
      reference: 'PO/G/001',
      lines: [rice, fruit],
    });
    await entries.create([
      {
        ...base,
        sourceKey: 'issue:test',
        kind: 'issue',
        occurredAt: new Date('2026-11-20T01:00:00Z'),
        reference: 'S001__2026-11-18__MPR0001',
        lines: [
          { ...rice, quantity: -2 },
          { ...fruit, quantity: 1 },
        ],
      },
      {
        ...base,
        sourceKey: 'reverse:test',
        kind: 'receipt-reversal',
        reference: String(received._id),
        lines: [{ ...rice, quantity: -5 }],
      },
      {
        ...base,
        sourceKey: 'opening:test',
        kind: 'opening',
        lines: [{ ...rice, quantity: 0 }],
      },
      {
        ...base,
        site: 'S002',
        sourceKey: 'other-site',
        kind: 'receipt',
        lines: [rice],
      },
    ]);
    const query = Object.assign(new InventoryQueryDto(), {
      view: 'lines',
      limit: 2,
    });
    const pages = await Promise.all(
      [1, 2, 3].map((page) => inventory.history('S001', { ...query, page })),
    );
    expect(pages.map((page) => page.total)).toEqual([6, 6, 6]);
    const rows = pages.flatMap((page) => [...page.items]);
    expect(
      new Set(
        rows.map(
          (row) =>
            `${String(row._id)}-${'lineIndex' in row ? String(row.lineIndex) : ''}`,
        ),
      ).size,
    ).toBe(6);
    expect(rows.filter((row) => row.kind === 'issue')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productionCode: 'MPR0001', quantity: -2 }),
        expect.objectContaining({ productionCode: 'MPR0001', quantity: 1 }),
      ]),
    );
    expect(rows.find((row) => row.kind === 'receipt-reversal')).toEqual(
      expect.objectContaining({ poNumber: 'PO/G/001', quantity: -5 }),
    );
    expect(rows.find((row) => row.kind === 'opening')).toEqual(
      expect.objectContaining({ quantity: 0 }),
    );
    const filtered = await inventory.history('S001', {
      ...query,
      search: 'Papaya',
      limit: 100,
    });
    expect(filtered.total).toBe(2);
    expect(filtered.items).toEqual([
      expect.objectContaining({ productCode: 'IT002' }),
      expect.objectContaining({ productCode: 'IT002' }),
    ]);
    expect(
      (await inventory.history('S001', { ...query, from: '2026-11-19' })).total,
    ).toBe(0);
    const legacy = await inventory.history('S001', new InventoryQueryDto());
    const trend = await inventory.dashboardTrend('S001', {
      ...new InventoryQueryDto(),
      from: '2026-11-18',
      to: '2026-11-20',
      productCode: 'IT001',
    });
    expect(trend.points).toMatchObject([
      { date: '2026-11-18', stockOut: 7 },
      { date: '2026-11-19', stockOut: 0 },
      { date: '2026-11-20', stockOut: 0 },
    ]);
    expect(legacy.total).toBe(4);
    expect(legacy.items[0]).toHaveProperty('lines');
    const otherSite = await inventory.history('S002', query);
    expect(otherSite.total).toBe(1);
    await entries.create({
      ...base,
      site: 'S002',
      sourceKey: 'cross-site-reversal',
      kind: 'receipt-reversal',
      reference: String(received._id),
      lines: [{ ...rice, quantity: -5 }],
    });
    const isolated = await inventory.history('S002', { ...query, limit: 100 });
    expect(
      isolated.items.find((row) => row.kind === 'receipt-reversal'),
    ).not.toHaveProperty('poNumber', 'PO/G/001');
  });

  it('edits a receipt atomically, preserves history and makes retries safe', async () => {
    await activate();
    const original = await receipt(5);
    const input = {
      requestId: randomUUID(),
      receivedDate: '2026-11-17',
      supplier: 'Updated supplier',
      reference: 'PO-UPDATED',
      note: 'Correct quantity',
      lines: [{ ...line, quantity: 8 }],
    };
    await expect(
      inventory.createReceipt('S002', input, actor, String(original._id)),
    ).rejects.toThrow();
    await expect(
      inventory.createReceipt(
        'S001',
        { ...input, lines: [{ ...line, productCode: 'UNKNOWN' }] },
        actor,
        String(original._id),
      ),
    ).rejects.toThrow();
    expect(
      (await inventory.receipt('S001', String(original._id))).reversedAt,
    ).toBeUndefined();
    expect(await balance()).toBe(15);
    const [updated, retried] = await Promise.all([
      inventory.createReceipt('S001', input, actor, String(original._id)),
      inventory.createReceipt('S001', input, actor, String(original._id)),
    ]);
    expect(String(updated._id)).toBe(String(retried._id));
    expect(updated).toEqual(
      expect.objectContaining({
        reference: 'PO-UPDATED',
        supplier: 'Updated supplier',
        note: 'Correct quantity',
      }),
    );
    expect(await balance()).toBe(18);
    expect(
      (await inventory.receipt('S001', String(original._id))).lines[0].quantity,
    ).toBe(5);
    expect(
      (await inventory.receipt('S001', String(original._id))).reversedAt,
    ).toBeDefined();
    expect(await entries.countDocuments({ kind: 'receipt-reversal' })).toBe(1);
    await expect(
      inventory.createReceipt(
        'S001',
        { ...input, lines: [{ ...line, quantity: 9 }] },
        actor,
        String(original._id),
      ),
    ).rejects.toThrow('identifier');
    await expect(
      inventory.createReceipt(
        'S001',
        { ...input, requestId: randomUUID() },
        actor,
        String(original._id),
      ),
    ).rejects.toThrow('cancelled or edited');
    await inventory.reverseReceipt(
      'S001',
      String(updated._id),
      'Cancelled replacement',
      actor,
    );
    expect(await balance()).toBe(10);
    await expect(
      inventory.createReceipt(
        'S001',
        { ...input, requestId: randomUUID() },
        actor,
        String(updated._id),
      ),
    ).rejects.toThrow('cancelled or edited');
  });

  it('activates once and isolates sites', async () => {
    await expect(
      inventory.createReceipt(
        'S001',
        {
          requestId: randomUUID(),
          receivedDate: '2026-11-18',
          supplier: 'Supplier',
          lines: [line],
        },
        actor,
      ),
    ).rejects.toThrow('activate');
    await activate();
    await expect(activate()).rejects.toThrow('already been imported');
    expect(await balance()).toBe(10);
    expect(
      (await inventory.balances('S002', new InventoryQueryDto())).items,
    ).toEqual([]);
    expect((await inventory.status('S002')).active).toBe(false);
  });

  it('saves a repeated receipt only once, including concurrent retries', async () => {
    await activate();
    const id = randomUUID();
    await Promise.all([receipt(5, id), receipt(5, id), receipt(5, id)]);
    expect(await entries.countDocuments({ kind: 'receipt' })).toBe(1);
    expect(await balance()).toBe(15);
    await expect(receipt(6, id)).rejects.toThrow('another receipt');
  });

  it('reverses once and preserves the original receipt and reason', async () => {
    await activate();
    const saved = await receipt();
    await expect(
      inventory.reverseReceipt('S002', String(saved._id), 'Wrong site', actor),
    ).rejects.toThrow();
    await Promise.all([
      inventory.reverseReceipt(
        'S001',
        String(saved._id),
        'Duplicate delivery',
        actor,
      ),
      inventory.reverseReceipt(
        'S001',
        String(saved._id),
        'Duplicate delivery',
        actor,
      ),
    ]);
    expect(await balance()).toBe(10);
    expect(await entries.countDocuments({ kind: 'receipt-reversal' })).toBe(1);
    expect(
      (await inventory.receipt('S001', String(saved._id))).reversedAt,
    ).toBeTruthy();
    expect(
      (await inventory.history('S001', new InventoryQueryDto())).items.find(
        (entry) => entry.kind === 'receipt-reversal',
      )?.note,
    ).toBe('Duplicate delivery');
  });

  it('rejects insufficient stock, corrects by delta and reverses on cancellation', async () => {
    await activate();
    const menu = await makeMenu();
    await expect(fulfill(String(menu._id), 12)).rejects.toThrow(
      'Insufficient stock for IT001',
    );
    expect(await balance()).toBe(10);
    expect(await entries.countDocuments({ kind: 'issue' })).toBe(0);
    expect((await menus.findById(menu._id).lean())?.storeRequestStatus).toBe(
      'requested',
    );
    await fulfill(String(menu._id), 10);
    expect(await balance()).toBe(0);
    expect(
      (await inventory.previewIssue('S001', [{ ...line, quantity: 1 }]))
        .shortages[0].remaining,
    ).toBe(-1);
    await expect(fulfill(String(menu._id), 11, true)).rejects.toThrow(
      'Insufficient stock for IT001',
    );
    await expect(inventory.assertDeletable([String(menu._id)])).rejects.toThrow(
      'Cancel',
    );
    await fulfill(String(menu._id), 4, true);
    expect(await balance()).toBe(6);
    await fulfill(String(menu._id), 4, true);
    expect(await entries.countDocuments({ kind: 'issue' })).toBe(2);
    await productions.cancelStoreRequestBatch(
      { menuProductionIds: [String(menu._id)], reason: 'Return all materials' },
      'S001',
      'Superadmin',
      { allowStatusOverride: true },
    );
    expect(await balance()).toBe(10);
    await expect(
      inventory.assertDeletable([String(menu._id)]),
    ).resolves.toBeUndefined();
  });

  it('rejects cancelling or reducing a receipt when its stock has been used', async () => {
    await activate();
    const saved = await receipt(5);
    const menu = await makeMenu();
    await fulfill(String(menu._id), 14);
    const id = String(saved._id);
    await expect(
      inventory.reverseReceipt('S001', id, 'Duplicate delivery', actor),
    ).rejects.toThrow('Insufficient stock for IT001');
    await expect(
      inventory.createReceipt(
        'S001',
        {
          requestId: randomUUID(),
          receivedDate: '2026-11-18',
          lines: [{ ...line, quantity: 3 }],
        },
        actor,
        id,
      ),
    ).rejects.toThrow('Insufficient stock for IT001');
    expect(await balance()).toBe(1);
    expect(await entries.countDocuments({ kind: 'receipt-reversal' })).toBe(0);
  });

  it('posts actual quantity on the MPR production date when a later completion is submitted', async () => {
    await activate();
    await inventory.activate('S002', [line], actor);
    const menu = await makeMenu({ productionDate: '2020-01-01' });
    await inventory.previewIssue('S001', [{ ...line, quantity: 8 }]);
    expect(await balance()).toBe(10);
    expect(await entries.countDocuments({ kind: 'issue' })).toBe(0);
    expect((await menus.findById(menu._id).lean())?.storeRequestStatus).toBe(
      'requested',
    );

    const submittedAt = Date.now();
    await fulfill(String(menu._id), 8);
    const savedAt = Date.now();
    expect(await balance()).toBe(2);
    const completed = await menus.findById(menu._id).lean();
    expect(completed?.storeFulfillmentItems?.[0]).toMatchObject({
      plannedQty: 3,
      actualQty: 8,
    });
    const movement = await entries
      .findOne({ site: 'S001', kind: 'issue' })
      .lean();
    expect(movement).toMatchObject({
      actor: 'Storekeeper',
      lines: [{ productCode: 'IT001', unitOfMeasures: 'KG', quantity: -8 }],
    });
    expect(movement?.occurredAt).toEqual(new Date('2019-12-31T17:00:00Z'));
    const completedAt = completed?.storeFulfillmentCompletedAt?.getTime();
    expect(completedAt).toBeGreaterThanOrEqual(submittedAt);
    expect(completedAt).toBeLessThanOrEqual(savedAt);
    const history = await inventory.history('S001', {
      ...new InventoryQueryDto(),
      view: 'lines',
    });
    expect(history.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productionCode: 'MPR0001', quantity: -8 }),
      ]),
    );
    expect(
      (await inventory.balances('S002', new InventoryQueryDto())).items[0]
        .quantity,
    ).toBe(10);
    await expect(fulfill(String(menu._id), 8)).rejects.toThrow();
    expect(await balance()).toBe(2);
    expect(await entries.countDocuments({ kind: 'issue' })).toBe(1);
  });

  it('completes zero actual quantity without deducting planned stock', async () => {
    await activate();
    const menu = await makeMenu();
    await fulfill(String(menu._id), 0);
    expect((await menus.findById(menu._id).lean())?.storeRequestStatus).toBe(
      'fulfilled',
    );
    expect(await balance()).toBe(10);
    expect(await entries.countDocuments({ kind: 'issue' })).toBe(0);
    await fulfill(String(menu._id), 2, true);
    expect(await balance()).toBe(8);
    await fulfill(String(menu._id), 0, true);
    expect(await balance()).toBe(10);
  });

  it('converts submitted actual quantity into the established inventory unit', async () => {
    materials.findLookupsByNormalizedCodes.mockResolvedValueOnce([
      { ...material, unitOfMeasures: 'G' },
    ]);
    await inventory.activate(
      'S001',
      [{ ...line, unitOfMeasures: 'G', quantity: 10000 }],
      actor,
    );
    units.findActiveConversion.mockResolvedValueOnce({ multiplier: 1000 });
    const menu = await makeMenu();
    await fulfill(String(menu._id), 2);
    expect(await balance()).toBe(8000);
    expect(await entries.findOne({ kind: 'issue' }).lean()).toMatchObject({
      lines: [{ productCode: 'IT001', unitOfMeasures: 'G', quantity: -2000 }],
    });
  });

  it('prevents double issuance under concurrent fulfillment', async () => {
    await activate();
    const menu = await makeMenu();
    const results = await Promise.allSettled([
      fulfill(String(menu._id), 3),
      fulfill(String(menu._id), 3),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(await balance()).toBe(7);
    expect(await entries.countDocuments({ kind: 'issue' })).toBe(1);
  });

  it('rolls back fulfillment when inventory recording fails', async () => {
    await activate();
    const menu = await makeMenu();
    materials.findLookupsByNormalizedCodes.mockResolvedValueOnce([]);
    await expect(fulfill(String(menu._id), 3)).rejects.toThrow(
      'Unknown master item',
    );
    expect((await menus.findById(menu._id).lean())?.storeRequestStatus).toBe(
      'requested',
    );
    expect(await balance()).toBe(10);
    expect(await issues.countDocuments()).toBe(0);
  });

  it('rejects partial batches and the legacy fulfillment endpoint after activation', async () => {
    await activate();
    const first = await makeMenu();
    await makeMenu();
    await expect(fulfill(String(first._id), 3)).rejects.toThrow(
      'complete Store Request batch',
    );
    await expect(
      productions.setStoreRequestStatus(String(first._id), 'fulfilled', 'S001'),
    ).rejects.toThrow('actual quantities');
    expect(await balance()).toBe(10);
  });

  it('excludes NMP from issuance without blocking the existing workflow', async () => {
    await activate();
    const menu = await makeMenu();
    await productions.fulfillStoreRequestBatch(
      {
        menuProductionIds: [String(menu._id)],
        items: [
          {
            productCode: 'IT001',
            name: 'Rice',
            unitOfMeasures: 'KG',
            actualQty: 3,
          },
          {
            productCode: 'NMP',
            name: 'Other',
            unitOfMeasures: 'PCS',
            actualQty: 7,
            reason: 'Additional item',
          },
        ],
      },
      'S001',
      'Storekeeper',
    );
    expect(await balance()).toBe(7);
    expect(await entries.countDocuments({ 'lines.productCode': 'NMP' })).toBe(
      0,
    );
  });

  it('keeps historic fulfillments excluded even after multiple superadmin corrections', async () => {
    const menu = await makeMenu({
      storeRequestStatus: 'fulfilled',
      storeFulfillmentCompletedAt: new Date('2020-01-01'),
    });
    await activate();
    await fulfill(String(menu._id), 3, true);
    await fulfill(String(menu._id), 5, true);
    expect(await balance()).toBe(10);
    expect(await entries.countDocuments({ kind: 'issue' })).toBe(0);
  });

  it('preserves fulfillment for sites not yet activated', async () => {
    const menu = await makeMenu();
    await fulfill(String(menu._id), 3);
    expect((await menus.findById(menu._id).lean())?.storeRequestStatus).toBe(
      'fulfilled',
    );
    expect(await entries.countDocuments()).toBe(0);
  });

  it('rolls back a partial deletion when a batch changes concurrently', async () => {
    await activate();
    const first = await makeMenu();
    const second = await makeMenu();
    const guard = jest
      .spyOn(inventory, 'assertDeletable')
      .mockImplementationOnce(async () => {
        await menus.updateOne(
          { _id: second._id },
          { $set: { storeRequestStatus: 'cancelled' } },
        );
      });
    try {
      await expect(
        productions.deleteBatch(
          {
            menuProductionIds: [String(first._id), String(second._id)],
            reason: 'Delete duplicate batch',
          },
          'S001',
        ),
      ).rejects.toThrow('batch changed');
      expect(await menus.countDocuments()).toBe(2);
      expect(await balance()).toBe(10);
    } finally {
      guard.mockRestore();
    }
  });

  it('previews Excel errors per row and rejects invalid rows again at confirmation', async () => {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Opening Inventory');
    sheet.addRows([
      ['Kode Item', 'Satuan', 'Jumlah Stok Awal'],
      ['IT001', 'KG', 10],
      ['IT001', 'KG', 2],
      ['NMP', 'KG', 2],
      ['UNKNOWN', 'KG', 1],
      ['IT001', 'G', '5'],
    ]);
    const preview = await inventory.previewOpening(
      'S001',
      Buffer.from(await workbook.xlsx.writeBuffer()),
      actor,
    );
    expect(preview.valid).toBe(false);
    expect(preview.rows[0].error).toBeUndefined();
    expect(preview.rows.slice(1).every((row) => row.error)).toBe(true);
    await expect(
      inventory.activate('S001', [line, line], actor),
    ).rejects.toThrow('Duplicate');
    await expect(
      inventory.activate('S001', [{ ...line, unitOfMeasures: 'G' }], actor),
    ).rejects.toThrow('use inventory unit');
    await expect(
      inventory.activate('S001', [{ ...line, productCode: 'NMP' }], actor),
    ).rejects.toThrow('NMP');
    expect((await inventory.status('S001')).active).toBe(false);
  });

  it('confirms only a valid preview owned by the same site and user', async () => {
    const workbook = new Workbook();
    workbook.addWorksheet('Opening').addRows([
      ['Kode Item', 'Satuan', 'Jumlah Stok Awal'],
      ['IT001', 'KG', 10],
    ]);
    const preview = await inventory.previewOpening(
      'S001',
      Buffer.from(await workbook.xlsx.writeBuffer()),
      actor,
    );
    expect(preview.valid).toBe(true);
    expect(preview.previewId).toBeTruthy();
    await expect(
      inventory.confirmOpening('S002', preview.previewId!, actor),
    ).rejects.toThrow('another site or user');
    await expect(
      inventory.confirmOpening('S001', preview.previewId!, {
        ...actor,
        id: 'another-user',
      }),
    ).rejects.toThrow('another site or user');
    await inventory.confirmOpening('S001', preview.previewId!, actor);
    expect(await balance()).toBe(10);
    await expect(
      inventory.confirmOpening('S001', preview.previewId!, actor),
    ).rejects.toThrow('already been imported');
  });

  it('rejects expired previews and revalidates changed master data at confirmation', async () => {
    const workbook = new Workbook();
    workbook.addWorksheet('Opening').addRows([
      ['Kode Item', 'Satuan', 'Jumlah Stok Awal'],
      ['IT001', 'KG', 10],
    ]);
    const preview = await inventory.previewOpening(
      'S001',
      Buffer.from(await workbook.xlsx.writeBuffer()),
      actor,
    );
    materials.findLookupsByNormalizedCodes.mockResolvedValueOnce([]);
    await expect(
      inventory.confirmOpening('S001', preview.previewId!, actor),
    ).rejects.toThrow('Unknown master item');
    expect((await inventory.status('S001')).active).toBe(false);
    await previews.updateOne(
      { _id: preview.previewId },
      { $set: { expiresAt: new Date(0) } },
    );
    await expect(
      inventory.confirmOpening('S001', preview.previewId!, actor),
    ).rejects.toThrow('expired');
  });

  it('keeps the historical inventory unit when master units change', async () => {
    await activate();
    materials.findLookupsByNormalizedCodes.mockResolvedValueOnce([
      { ...material, unitOfMeasures: 'G' },
    ]);
    await receipt(2);
    expect(await balance()).toBe(12);
  });
});
