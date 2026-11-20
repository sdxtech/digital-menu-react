import { BadRequestException } from '@nestjs/common';
import { Workbook } from 'exceljs';
import { inventoryCode, roundInventory } from './inventory-quantity';

export function isPoQuantity(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1e12 &&
    roundInventory(value) === value
  );
}

export async function readPurchaseOrders(buffer: Buffer) {
  const workbook = new Workbook();
  try {
    await workbook.xlsx.load(new Uint8Array(buffer).buffer);
  } catch {
    throw new BadRequestException('Upload a valid .xlsx purchase order file.');
  }

  const sheet = workbook.worksheets[0];
  const headers = new Map<string, number>();
  sheet?.getRow(1).eachCell((cell, column) => {
    const header = inventoryCode(cell.text);
    headers.set(header, headers.has(header) ? 0 : column);
  });
  const received = headers.get('R');
  if (!received)
    throw new BadRequestException(
      'Import ditolak: header R untuk qty diterima wajib ada tepat satu kali.',
    );
  const reference = headers.get('DISPLAY NAME');
  const code = headers.get('ORDER LINES/PRODUCT/PRODUCT CODE');
  const ordered = headers.get('ORDER LINES/QUANTITY');
  const unit = headers.get('ORDER LINES/UNIT OF MEASURE');
  const name = headers.get('ORDER LINES/PRODUCT');
  if (!sheet || !reference || !code || !ordered || !unit || !name)
    throw new BadRequestException('Use the purchase order export format.');
  if (sheet.rowCount > 5001)
    throw new BadRequestException('Purchase orders are limited to 5000 rows.');

  const skipped: Array<{ row: number; productCode: string }> = [];
  const groups = new Map<
    string,
    {
      reference: string;
      rows: Array<{
        row: number;
        productCode: string;
        name: string;
        unitOfMeasures: string;
        orderedQuantity: string;
        quantity: number | null;
        invalidQuantity: boolean;
      }>;
    }
  >();
  let po = '';
  for (let index = 2; index <= sheet.rowCount; index++) {
    const row = sheet.getRow(index);
    const nextReference = row.getCell(reference).text.trim();
    if (nextReference) po = nextReference;
    const productCode = inventoryCode(row.getCell(code).text);
    if (!productCode.startsWith('IT')) {
      if (productCode || row.getCell(name).text.trim())
        skipped.push({ row: index, productCode });
      continue;
    }
    if (!po || po.length > 200 || po.toLowerCase() === 'false')
      throw new BadRequestException(
        `Row ${index}: invalid or missing PO number.`,
      );

    const rawUnit = inventoryCode(row.getCell(unit).text);
    const unitOfMeasures = rawUnit.replace(/^(.+) \(\1\)$/, '$1');
    const rawQuantity = row.getCell(received).value;
    const blank =
      rawQuantity == null ||
      (typeof rawQuantity === 'string' && !rawQuantity.trim());
    const quantity =
      typeof rawQuantity === 'string' &&
      /^\d+(\.\d+)?$/.test(rawQuantity.trim())
        ? Number(rawQuantity)
        : rawQuantity;
    const group = groups.get(inventoryCode(po)) ?? { reference: po, rows: [] };
    group.rows.push({
      row: index,
      productCode,
      name: row.getCell(name).text,
      unitOfMeasures,
      orderedQuantity: row.getCell(ordered).text,
      quantity: isPoQuantity(quantity) ? quantity : null,
      invalidQuantity: !blank && !isPoQuantity(quantity),
    });
    groups.set(inventoryCode(po), group);
  }

  if (!groups.size)
    throw new BadRequestException(
      'No product codes starting with IT were found.',
    );
  return { groups: [...groups.values()], skipped };
}
