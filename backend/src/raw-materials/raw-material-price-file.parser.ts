import { BadRequestException } from '@nestjs/common';
import { parse } from 'csv-parse';
import ExcelJS from 'exceljs';
import { createReadStream } from 'fs';
import { extname } from 'path';
import type { RawMaterialPriceUpdateInput } from './raw-material-price-update.types';

type PriceHeaderField =
  | 'productCode'
  | 'price'
  | 'name'
  | 'site'
  | 'vendor'
  | 'currency'
  | 'unitOfMeasures'
  | 'minimumQuantity'
  | 'priceQuantity'
  | 'startDate';

type PriceHeaderMap = Partial<Record<PriceHeaderField, number>> & {
  productCode: number;
  price: number;
  vendorMode: boolean;
};

const HEADER_ALIASES: Record<PriceHeaderField, string[]> = {
  productCode: [
    'product code',
    'product_code',
    'productcode',
    'code',
    'sku',
    'kode',
    'kode produk',
  ],
  price: ['price', 'prices', 'unit price', 'unit_price', 'harga', 'cost'],
  name: ['name', 'nama', 'product name', 'material name'],
  site: ['site', 'location', 'lokasi', 'cabang'],
  vendor: ['vendor', 'supplier', 'supplier name', 'vendor name', 'pemasok'],
  currency: ['currency', 'curr', 'mata uang', 'mata_uang'],
  unitOfMeasures: [
    'unit of measures',
    'unit of measure',
    'unit',
    'uom',
    'unit_of_measures',
    'satuan',
  ],
  minimumQuantity: [
    'minimal quantity',
    'minimum quantity',
    'min quantity',
    'min qty',
    'minimal qty',
    'minimum qty',
    'min_qty',
    'minimum_qty',
    'minimal_qty',
  ],
  priceQuantity: [
    'quantity',
    'price quantity',
    'pricing quantity',
    'price_quantity',
  ],
  startDate: [
    'start date',
    'start_date',
    'startdate',
    'valid from',
    'valid_from',
    'effective date',
    'effective_date',
  ],
};

export class RawMaterialPriceFileParser {
  parse(
    filePath: string,
    fileName: string,
  ): AsyncGenerator<RawMaterialPriceUpdateInput> {
    const ext = extname(fileName || '').toLowerCase();
    if (ext === '.csv') return this.parseCsv(filePath);
    return this.parseWorkbook(filePath);
  }

  private async *parseWorkbook(
    filePath: string,
  ): AsyncGenerator<RawMaterialPriceUpdateInput> {
    const reader = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
      worksheets: 'emit',
      sharedStrings: 'cache',
      hyperlinks: 'ignore',
      styles: 'ignore',
    });
    let worksheetFound = false;

    for await (const worksheet of reader) {
      worksheetFound = true;
      let header: PriceHeaderMap | undefined;

      for await (const row of worksheet) {
        const values = Array.isArray(row.values)
          ? (row.values as unknown[]).slice(1)
          : [];
        if (!header) {
          header = this.buildHeaderMap(values);
          continue;
        }

        const parsed = this.parseRow(values, header, row.number);
        if (parsed) yield parsed;
      }
      break;
    }

    if (!worksheetFound) {
      throw new BadRequestException('Worksheet not found.');
    }
  }

  private async *parseCsv(
    filePath: string,
  ): AsyncGenerator<RawMaterialPriceUpdateInput> {
    const records = createReadStream(filePath).pipe(
      parse({
        columns: false,
        bom: true,
        skip_empty_lines: true,
        trim: true,
      }),
    );
    let header: PriceHeaderMap | undefined;
    let rowNumber = 0;

    for await (const record of records) {
      rowNumber += 1;
      const values = Array.isArray(record) ? (record as unknown[]) : [];
      if (!header) {
        header = this.buildHeaderMap(values);
        continue;
      }

      const parsed = this.parseRow(values, header, rowNumber);
      if (parsed) yield parsed;
    }
  }

  private parseRow(
    values: unknown[],
    header: PriceHeaderMap,
    rowNumber: number,
  ): RawMaterialPriceUpdateInput | undefined {
    const value = (field: PriceHeaderField) => {
      const index = header[field];
      return index === undefined ? undefined : values[index];
    };
    const productCode = this.cellToText(value('productCode'));
    const rawPrice = value('price');
    const priceText = this.cellToText(rawPrice);
    const price = this.parseNumber(rawPrice);
    const name = this.cellToText(value('name'));
    const site = this.cellToText(value('site'));
    const vendor = this.cellToText(value('vendor'));
    const currency = this.cellToText(value('currency'));
    const unitOfMeasures = this.cellToText(value('unitOfMeasures'));
    const minimumQuantityText = this.cellToText(value('minimumQuantity'));
    const priceQuantityText = this.cellToText(value('priceQuantity'));
    const startDateText = this.cellToText(value('startDate'));

    if (
      !productCode &&
      !priceText &&
      !name &&
      !site &&
      !vendor &&
      !currency &&
      !unitOfMeasures &&
      !minimumQuantityText &&
      !priceQuantityText &&
      !startDateText
    ) {
      return undefined;
    }

    if (!productCode || price === undefined || price < 0) {
      throw new BadRequestException(
        `Invalid price update row ${rowNumber}. Product code and a non-negative price are required.`,
      );
    }
    if (header.vendorMode && (!site || !vendor)) {
      throw new BadRequestException(
        `Invalid vendor price row ${rowNumber}. Site and vendor are required when the file includes vendor pricing columns.`,
      );
    }

    const minimumQuantity = minimumQuantityText
      ? this.parseNumber(value('minimumQuantity'))
      : undefined;
    if (minimumQuantityText && minimumQuantity === undefined) {
      throw new BadRequestException(
        `Invalid minimum quantity at row ${rowNumber}.`,
      );
    }
    const priceQuantity = priceQuantityText
      ? this.parseNumber(value('priceQuantity'))
      : undefined;
    if (priceQuantityText && (!priceQuantity || priceQuantity <= 0)) {
      throw new BadRequestException(
        `Invalid quantity at row ${rowNumber}. Quantity must be greater than 0.`,
      );
    }
    const startDate = startDateText
      ? this.parseDateOnly(value('startDate'))
      : undefined;
    if (startDateText && !startDate) {
      throw new BadRequestException(`Invalid start date at row ${rowNumber}.`);
    }

    return {
      productCode,
      price,
      rowNumber,
      ...(name ? { name } : {}),
      ...(site ? { site } : {}),
      ...(vendor ? { vendor } : {}),
      ...(currency ? { currency } : {}),
      ...(unitOfMeasures ? { unitOfMeasures } : {}),
      ...(minimumQuantity !== undefined ? { minimumQuantity } : {}),
      ...(priceQuantity !== undefined ? { priceQuantity } : {}),
      ...(startDate ? { startDate } : {}),
    };
  }

  private buildHeaderMap(values: unknown[]): PriceHeaderMap {
    const normalizedHeaders = values.map((value) =>
      this.normalizeHeader(this.cellToText(value)),
    );
    const indexes = Object.fromEntries(
      Object.entries(HEADER_ALIASES).map(([field, aliases]) => [
        field,
        normalizedHeaders.findIndex((header) => aliases.includes(header)),
      ]),
    ) as Record<PriceHeaderField, number>;

    if (indexes.productCode === -1 || indexes.price === -1) {
      throw new BadRequestException(
        'Header must include product code and price.',
      );
    }
    const hasSite = indexes.site !== -1;
    const hasVendor = indexes.vendor !== -1;
    if (hasSite !== hasVendor) {
      throw new BadRequestException(
        'Vendor-aware price files must include both site and vendor headers.',
      );
    }

    const header: Partial<Record<PriceHeaderField, number>> = {};
    for (const [field, index] of Object.entries(indexes)) {
      if (index !== -1) header[field as PriceHeaderField] = index;
    }

    return {
      ...header,
      productCode: indexes.productCode,
      price: indexes.price,
      vendorMode: hasSite && hasVendor,
    };
  }

  private normalizeHeader(value: string) {
    return value
      .trim()
      .toLowerCase()
      .replace(/\./g, '_')
      .replace(/\$/g, '')
      .replace(/\s+/g, ' ');
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private cellToText(value: unknown): string {
    if (value === undefined || value === null) return '';
    if (this.isRecord(value)) {
      if ('text' in value) return this.cellToText(value.text).trim();
      if ('result' in value) return this.cellToText(value.result).trim();
      if ('richText' in value && Array.isArray(value.richText)) {
        return value.richText
          .map((part) =>
            this.isRecord(part) ? this.cellToText(part.text) : '',
          )
          .join('')
          .trim();
      }
    }
    if (typeof value === 'string') return value.trim();
    if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      return String(value).trim();
    }
    if (value instanceof Date) return value.toISOString();
    return '';
  }

  private parseNumber(value: unknown): number | undefined {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : undefined;
    }

    const text = this.cellToText(value).replace(/[^\d,.-]/g, '');
    if (!text) return undefined;

    const lastComma = text.lastIndexOf(',');
    const lastDot = text.lastIndexOf('.');
    let normalized = text;

    if (lastComma > -1 && lastDot > -1) {
      const decimalSeparator = lastComma > lastDot ? ',' : '.';
      const thousandSeparator = decimalSeparator === ',' ? '.' : ',';
      normalized = text
        .replace(new RegExp(`\\${thousandSeparator}`, 'g'), '')
        .replace(decimalSeparator, '.');
    } else if (lastComma > -1) {
      normalized = /^\d{1,3}(,\d{3})+$/.test(text)
        ? text.replace(/,/g, '')
        : text.replace(',', '.');
    } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
      normalized = text.replace(/\./g, '');
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private parseDateOnly(value: unknown): string | undefined {
    if (value instanceof Date) {
      if (!Number.isFinite(value.getTime())) return undefined;
      return this.formatDateOnly(
        value.getFullYear(),
        value.getMonth() + 1,
        value.getDate(),
      );
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      const excelDate = new Date(Date.UTC(1899, 11, 30 + value));
      return this.formatDateOnly(
        excelDate.getUTCFullYear(),
        excelDate.getUTCMonth() + 1,
        excelDate.getUTCDate(),
      );
    }

    const text = this.cellToText(value);
    const isoMatch = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    const dayFirstMatch = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (isoMatch) {
      return this.formatDateOnly(
        Number(isoMatch[1]),
        Number(isoMatch[2]),
        Number(isoMatch[3]),
      );
    }
    if (dayFirstMatch) {
      return this.formatDateOnly(
        Number(dayFirstMatch[3]),
        Number(dayFirstMatch[2]),
        Number(dayFirstMatch[1]),
      );
    }
    return undefined;
  }

  private formatDateOnly(year: number, month: number, day: number) {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return undefined;
    }
    return `${year.toString().padStart(4, '0')}-${month
      .toString()
      .padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
  }
}
