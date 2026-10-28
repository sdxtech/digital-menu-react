import assert from 'node:assert/strict'
import test from 'node:test'
import ExcelJS from 'exceljs'
import { buildSpreadsheetBuffer, toSpreadsheetDecimal } from '../src/lib/spreadsheet-export.ts'
import { buildProductionBulkSheets } from '../src/lib/production-bulk-export.ts'

test('food cost displays thousands with no decimal places in single and bulk exports while preserving its value', async () => {
  const cost = 335748.649448
  const information = { name: 'Menu Production Information', rows: [
    ['Field', 'Value'], ['Total Estimated Food Cost', toSpreadsheetDecimal(cost, 'integer')],
  ] }
  for (const sheets of [[information], buildProductionBulkSheets([[information]])]) {
    const bytes = await buildSpreadsheetBuffer(sheets)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(bytes)
    const cell = workbook.worksheets[0].getCell('B2')
    assert.equal(cell.value, cost)
    assert.equal(cell.numFmt, '#,##0')
  }
})

test('ingredient quantities retain their decimal display', async () => {
  const bytes = await buildSpreadsheetBuffer([{ name: 'Detail', rows: [['QTY'], [toSpreadsheetDecimal(1.234567)]] }])
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes)
  assert.equal(workbook.worksheets[0].getCell('A2').value, 1.234567)
  assert.equal(workbook.worksheets[0].getCell('A2').numFmt, '0.######')
})
