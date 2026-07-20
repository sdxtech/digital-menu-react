import ExcelJS from 'exceljs';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { RawMaterialPriceFileParser } from './raw-material-price-file.parser';
import type { RawMaterialPriceUpdateInput } from './raw-material-price-update.types';

const collect = async (
  rows: AsyncIterable<RawMaterialPriceUpdateInput>,
): Promise<RawMaterialPriceUpdateInput[]> => {
  const collected: RawMaterialPriceUpdateInput[] = [];
  for await (const row of rows) collected.push(row);
  return collected;
};

describe('RawMaterialPriceFileParser', () => {
  let directory: string;
  const parser = new RawMaterialPriceFileParser();

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'raw-material-prices-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('keeps the legacy product code and price CSV format', async () => {
    const filePath = join(directory, 'prices.csv');
    await writeFile(filePath, 'Product Code,Price\nRM-001,42500\n', 'utf8');

    await expect(
      collect(parser.parse(filePath, 'prices.csv')),
    ).resolves.toEqual([
      {
        productCode: 'RM-001',
        price: 42500,
        rowNumber: 2,
      },
    ]);
  });

  it('parses the full pricelist headers and preserves the price quantity', async () => {
    const filePath = join(directory, 'pricelist.xlsx');
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      filename: filePath,
      useSharedStrings: false,
    });
    const sheet = workbook.addWorksheet('Sheet1');
    sheet
      .addRow([
        'Product Code',
        'Name',
        'Site',
        'Vendor',
        'Currency',
        'Quantity',
        'Unit of Measure',
        'Price',
      ])
      .commit();
    sheet
      .addRow([
        'IT00786_N',
        'Leaves _ KEMANGI LOCAL 1KG (KG)',
        'PT Donggi Senoro LNG',
        'CV FITRA MANDIRI',
        'IDR',
        0.1,
        'KG (KG)',
        7000,
      ])
      .commit();
    await workbook.commit();

    await expect(
      collect(parser.parse(filePath, 'pricelist.xlsx')),
    ).resolves.toEqual([
      {
        productCode: 'IT00786_N',
        name: 'Leaves _ KEMANGI LOCAL 1KG (KG)',
        site: 'PT Donggi Senoro LNG',
        vendor: 'CV FITRA MANDIRI',
        currency: 'IDR',
        priceQuantity: 0.1,
        unitOfMeasures: 'KG (KG)',
        price: 7000,
        rowNumber: 2,
      },
    ]);
  });

  it('requires site and vendor headers together', async () => {
    const filePath = join(directory, 'invalid.csv');
    await writeFile(
      filePath,
      'Product Code,Site,Price\nRM-001,Site A,42500\n',
      'utf8',
    );

    await expect(
      collect(parser.parse(filePath, 'invalid.csv')),
    ).rejects.toThrow('must include both site and vendor headers');
  });
});
