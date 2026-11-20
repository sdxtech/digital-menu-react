import { Workbook } from 'exceljs';
import { readPurchaseOrders } from './po-import';

async function purchaseOrderFile(includeReceived = true) {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  sheet.addRows([
    [
      'Display Name',
      'Order Lines/Product/Product Code',
      'Order Lines/Product',
      'Order Lines/Quantity',
      'Order Lines/Unit of Measure',
      includeReceived ? 'R' : 'Total',
    ],
    ['PO/1', 'IT00672_N', 'Fish', 20, 'KG (KG)', 18],
    [null, 'IT00203_N', 'Egg', 15, 'PCS', null],
    ['PO/2', 'NMPNF20', 'Chemical', 1, 'PCS', 1],
    [null, false, false, 0, false, null],
    [null, 'IT 00901_N', 'Rice', 10, 'KG', 0],
  ]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('Purchase order import', () => {
  it('reads R by header and rejects an export without it', async () => {
    await expect(
      readPurchaseOrders(await purchaseOrderFile(false)),
    ).rejects.toThrow('header R');
  });

  it('preserves PO groups, reads actual quantities, and skips non-IT codes', async () => {
    const preview = await readPurchaseOrders(await purchaseOrderFile());
    expect(preview.groups).toMatchObject([
      {
        reference: 'PO/1',
        rows: [
          {
            productCode: 'IT00672_N',
            orderedQuantity: '20',
            quantity: 18,
            unitOfMeasures: 'KG',
          },
          { productCode: 'IT00203_N', quantity: null, invalidQuantity: false },
        ],
      },
      { reference: 'PO/2', rows: [{ productCode: 'IT 00901_N', quantity: 0 }] },
    ]);
    expect(preview.skipped).toEqual([
      { row: 4, productCode: 'NMPNF20' },
      { row: 5, productCode: 'FALSE' },
    ]);
  });
});
