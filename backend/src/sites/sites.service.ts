import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import ExcelJS from 'exceljs';
import { createReadStream, promises as fs } from 'fs';
import { Model, Types } from 'mongoose';
import { Site, SiteDocument } from './schemas/site.schema';

const SITE_IMPORT_HEADER_ALIASES = new Set([
  'sites',
  'site',
  'site name',
  'nama site',
  'nama situs',
  'nama cabang',
  'cabang',
  'lokasi',
]);

export type CreateSiteInput = {
  name: string;
  code: string;
  description?: string;
  isActive?: boolean;
};

export type UpdateSiteInput = Partial<CreateSiteInput>;

export type ListSitesQuery = {
  page: number;
  limit: number;
  search?: string;
  isActive?: boolean;
};

export type SiteSummary = {
  id: string;
  name: string;
  code: string;
  description?: string;
  isActive: boolean;
};

export type ImportSiteRow = {
  row: number;
  name: string;
};

export type ImportSitesError = {
  row: number;
  name?: string;
  reason: string;
};

export type ImportSitesResult = {
  processedCount: number;
  createdCount: number;
  skippedCount: number;
  failedCount: number;
  errors: ImportSitesError[];
};

@Injectable()
export class SitesService {
  constructor(
    @InjectModel(Site.name)
    private readonly siteModel: Model<SiteDocument>,
  ) {}

  async create(input: CreateSiteInput) {
    const name = input.name.trim();
    const code = this.normalizeCode(input.code);
    if (!name || !code) {
      throw new BadRequestException('Site name and code are required.');
    }

    try {
      return await this.siteModel.create({
        name,
        code,
        description: this.normalizeOptionalText(input.description),
        isActive: input.isActive ?? true,
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException('Site code already exists');
      }
      throw error;
    }
  }

  async createWithNextSequentialCode(name: string) {
    const normalizedName = name.trim();
    if (!normalizedName) {
      throw new BadRequestException('Site name is required.');
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const code = await this.nextSequentialCode();
      try {
        return await this.create({
          name: normalizedName,
          code,
          isActive: true,
        });
      } catch (error) {
        if (error instanceof ConflictException) continue;
        throw error;
      }
    }

    throw new ConflictException('Failed to reserve next site code');
  }

  async importFromExcel(filePath: string): Promise<ImportSitesResult> {
    try {
      const rows = await this.readSiteImportRowsFromExcel(filePath);
      return this.importRows(rows);
    } finally {
      await fs.unlink(filePath).catch(() => null);
    }
  }

  async update(id: string, input: UpdateSiteInput) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid site id.');
    }

    const updateFields: UpdateSiteInput = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException('Site name is required.');
      updateFields.name = name;
    }
    if (input.code !== undefined) {
      const code = this.normalizeCode(input.code);
      if (!code) throw new BadRequestException('Site code is required.');
      updateFields.code = code;
    }
    if (input.description !== undefined) {
      updateFields.description = input.description.trim();
    }
    if (input.isActive !== undefined) {
      updateFields.isActive = input.isActive;
    }

    if (Object.keys(updateFields).length === 0) {
      throw new BadRequestException('No changes provided');
    }

    try {
      const updated = await this.siteModel.findByIdAndUpdate(id, updateFields, {
        new: true,
      });
      if (!updated) throw new NotFoundException('Site not found');
      return updated;
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException('Site code already exists');
      }
      throw error;
    }
  }

  async setActive(id: string, isActive: boolean) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid site id.');
    }

    const updated = await this.siteModel.findByIdAndUpdate(
      id,
      { isActive },
      { new: true },
    );
    if (!updated) throw new NotFoundException('Site not found');
    return updated;
  }

  async delete(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid site id.');
    }

    const deleted = await this.siteModel.findByIdAndDelete(id);
    if (!deleted) throw new NotFoundException('Site not found');
    return deleted;
  }

  async findAll(query: ListSitesQuery) {
    const filter: Record<string, unknown> = {};
    if (query.search?.trim()) {
      const text = query.search.trim();
      filter.$or = [
        { name: new RegExp(this.escapeRegExp(text), 'i') },
        { code: new RegExp(this.escapeRegExp(text), 'i') },
        { description: new RegExp(this.escapeRegExp(text), 'i') },
      ];
    }
    if (query.isActive !== undefined) {
      filter.isActive = query.isActive;
    }

    const skip = (query.page - 1) * query.limit;
    const [items, total] = await Promise.all([
      this.siteModel
        .find(filter)
        .collation({ locale: 'en', numericOrdering: true })
        .sort({ code: 1 })
        .skip(skip)
        .limit(query.limit)
        .lean(),
      this.siteModel.countDocuments(filter),
    ]);

    return {
      items: items.map((site) => this.toSummary(site)),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  async findById(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid site id.');
    }
    const site = await this.siteModel.findById(id);
    if (!site) throw new NotFoundException('Site not found');
    return site;
  }

  async findSummaryById(id?: string | Types.ObjectId | null) {
    const normalizedId = this.normalizeId(id);
    if (!normalizedId) return null;

    const site = await this.siteModel.findById(normalizedId).lean();
    return site ? this.toSummary(site) : null;
  }

  async findSummariesByIds(
    ids: Array<string | Types.ObjectId | undefined | null>,
  ) {
    const normalizedIds = Array.from(
      new Set(
        ids
          .map((id) => this.normalizeId(id))
          .filter((id): id is string => Boolean(id)),
      ),
    );
    if (normalizedIds.length === 0) return new Map<string, SiteSummary>();

    const sites = await this.siteModel
      .find({ _id: { $in: normalizedIds } })
      .lean();
    const map = new Map<string, SiteSummary>();
    sites.forEach((site) => {
      map.set(String(site._id), this.toSummary(site));
    });
    return map;
  }

  async findSummariesByCodes(codes: string[]) {
    const normalizedCodes = Array.from(
      new Set(codes.map((code) => this.normalizeCode(code)).filter(Boolean)),
    );
    if (normalizedCodes.length === 0) return new Map<string, SiteSummary>();

    const sites = await this.siteModel
      .find({ code: { $in: normalizedCodes } })
      .lean();
    const map = new Map<string, SiteSummary>();
    sites.forEach((site) => {
      map.set(site.code, this.toSummary(site));
    });
    return map;
  }

  toSummary(site: {
    _id: unknown;
    name: string;
    code: string;
    description?: string;
    isActive?: boolean;
  }): SiteSummary {
    return {
      id: String(site._id),
      name: site.name,
      code: site.code,
      description: site.description,
      isActive: site.isActive ?? true,
    };
  }

  private normalizeCode(value?: string) {
    return (value ?? '').trim().replace(/\s+/g, '-').toUpperCase();
  }

  private async nextSequentialCode() {
    const lastNumber = await this.lastSequentialCodeNumber();
    return this.formatSequentialCode(lastNumber + 1);
  }

  private async lastSequentialCodeNumber() {
    const sites = await this.siteModel
      .find({ code: /^S\d+$/ })
      .select({ code: 1 })
      .lean();

    return sites.reduce((max, site) => {
      const match = /^S(\d+)$/.exec(site.code);
      if (!match) return max;
      return Math.max(max, Number(match[1]));
    }, 0);
  }

  private formatSequentialCode(value: number) {
    return `S${String(value).padStart(3, '0')}`;
  }

  private async importRows(rows: ImportSiteRow[]): Promise<ImportSitesResult> {
    const errors: ImportSitesError[] = [];
    let createdCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    const candidates: ImportSiteRow[] = [];
    const seenNames = new Set<string>();

    const pushError = (error: ImportSitesError) => {
      if (errors.length < 50) errors.push(error);
    };

    const skipRow = (error: ImportSitesError) => {
      skippedCount += 1;
      pushError(error);
    };

    const failRow = (error: ImportSitesError) => {
      failedCount += 1;
      pushError(error);
    };

    for (const row of rows) {
      const name = row.name.trim();
      if (!name) {
        skipRow({ row: row.row, reason: 'Site name is empty' });
        continue;
      }

      const nameKey = this.normalizeNameKey(name);
      if (seenNames.has(nameKey)) {
        skipRow({
          row: row.row,
          name,
          reason: 'Duplicate site in import file',
        });
        continue;
      }

      seenNames.add(nameKey);
      candidates.push({ row: row.row, name });
    }

    const existingNames = await this.findExistingNameKeys(
      candidates.map((candidate) => candidate.name),
    );
    let nextNumber = await this.lastSequentialCodeNumber();

    for (const candidate of candidates) {
      const nameKey = this.normalizeNameKey(candidate.name);
      if (existingNames.has(nameKey)) {
        skipRow({
          row: candidate.row,
          name: candidate.name,
          reason: 'Site already exists',
        });
        continue;
      }

      try {
        nextNumber += 1;
        await this.create({
          name: candidate.name,
          code: this.formatSequentialCode(nextNumber),
          isActive: true,
        });
        createdCount += 1;
        existingNames.add(nameKey);
      } catch (error) {
        if (error instanceof ConflictException) {
          try {
            await this.createWithNextSequentialCode(candidate.name);
            nextNumber = await this.lastSequentialCodeNumber();
            createdCount += 1;
            existingNames.add(nameKey);
          } catch (retryError) {
            this.handleImportSaveFailure(candidate, retryError, failRow);
          }
        } else {
          this.handleImportSaveFailure(candidate, error, failRow);
        }
      }
    }

    return {
      processedCount: rows.length,
      createdCount,
      skippedCount,
      failedCount,
      errors,
    };
  }

  private async findExistingNameKeys(names: string[]) {
    const uniqueNames = Array.from(new Set(names.map((name) => name.trim())));
    if (uniqueNames.length === 0) return new Set<string>();

    const sites = await this.siteModel
      .find({ name: { $in: uniqueNames } })
      .collation({ locale: 'en', strength: 2 })
      .select({ name: 1 })
      .lean();

    return new Set(sites.map((site) => this.normalizeNameKey(site.name)));
  }

  private async readSiteImportRowsFromExcel(filePath: string) {
    const workbook = new ExcelJS.stream.xlsx.WorkbookReader(
      createReadStream(filePath),
      {
        worksheets: 'emit',
        sharedStrings: 'cache',
        hyperlinks: 'ignore',
        styles: 'ignore',
      },
    );
    const rows: ImportSiteRow[] = [];
    let siteColumnIndex = 0;
    let headerFound = false;

    for await (const worksheet of workbook) {
      for await (const row of worksheet) {
        const values = Array.isArray(row.values) ? row.values : [];
        if (!headerFound) {
          if (!this.rowHasValues(values)) continue;
          siteColumnIndex = this.findSiteColumnIndex(values);
          if (!siteColumnIndex) {
            throw new BadRequestException(
              'Excel file must include a "sites" column.',
            );
          }
          headerFound = true;
          continue;
        }

        if (!this.rowHasValues(values)) continue;
        rows.push({
          row: row.number,
          name: this.getCellValue(values, siteColumnIndex),
        });
      }
      break;
    }

    if (!headerFound) {
      throw new BadRequestException(
        'Excel file must include a "sites" column.',
      );
    }

    return rows;
  }

  private handleImportSaveFailure(
    row: ImportSiteRow,
    error: unknown,
    failRow: (error: ImportSitesError) => void,
  ) {
    const reason =
      error instanceof Error && error.message
        ? error.message
        : 'Failed to save site';
    failRow({ row: row.row, name: row.name, reason });
  }

  private findSiteColumnIndex(values: unknown[]) {
    for (let index = 1; index < values.length; index += 1) {
      const header = this.normalizeHeader(values[index]);
      if (SITE_IMPORT_HEADER_ALIASES.has(header)) return index;
    }
    return 0;
  }

  private rowHasValues(values: unknown[]) {
    return values.some((value, index) => index > 0 && this.toText(value));
  }

  private getCellValue(values: unknown[], index: number) {
    return this.toText(values[index]);
  }

  private normalizeHeader(value: unknown) {
    return this.toText(value)
      .toLowerCase()
      .replace(/[._-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalizeNameKey(value: string) {
    return value.trim().replace(/\s+/g, ' ').toLowerCase();
  }

  private toText(value: unknown): string {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value).trim();
    }
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') {
      const cell = value as {
        text?: unknown;
        result?: unknown;
        richText?: Array<{ text?: unknown }>;
      };
      if (cell.text !== undefined) return this.toText(cell.text);
      if (cell.result !== undefined) return this.toText(cell.result);
      if (Array.isArray(cell.richText)) {
        return cell.richText.map((part) => this.toText(part.text)).join('');
      }
    }
    return '';
  }

  private normalizeOptionalText(value?: string) {
    const trimmed = value?.trim();
    return trimmed || undefined;
  }

  private normalizeId(id?: string | Types.ObjectId | null) {
    if (!id) return undefined;
    const value = String(id);
    return Types.ObjectId.isValid(value) ? value : undefined;
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
