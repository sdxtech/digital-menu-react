import assert from 'node:assert/strict'
import test from 'node:test'
import ExcelJS from 'exceljs'
import { buildSpreadsheetBuffer, toSpreadsheetDecimal, toSpreadsheetSrQuantity } from '../src/lib/spreadsheet-export.ts'
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

test('SR quantities are numeric and rounded to at most two decimals in single and bulk workbooks', async () => {
  const sheet = { name: 'Detail', rows: [
    ['SR QTY'], ...[30.809090, 0, 2, 1.234, 1.999, undefined].map((qty) => [toSpreadsheetSrQuantity(qty)]),
  ] }
  for (const sheets of [[sheet], buildProductionBulkSheets([[sheet]])]) {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await buildSpreadsheetBuffer(sheets))
    const column = sheets[0].rows[0].length === 1 ? 'A' : 'B'
    for (const [index, value] of [30.81, 0, 2, 1.23, 2].entries()) {
      const cell = workbook.worksheets[0].getCell(`${column}${index + 2}`)
      assert.equal(cell.value, value)
      assert.equal(typeof cell.value, 'number')
      assert.equal(cell.numFmt, Number.isInteger(value) ? '#,##0' : '0.##')
    }
  }
  assert.equal(toSpreadsheetSrQuantity(undefined), '')
  assert.equal(toSpreadsheetSrQuantity(Infinity), '')
})

test('preserves legacy rows and reconciles new numeric Excel cells at each vendor price', async () => {
  const line = (qty: number, price: number) => ({
    productCode: 'IT-TEA', name: 'Tea', unitOfMeasures: 'PK', vendor: 'Saved vendor',
    qty, price, ingredientCost: qty * price,
  })
  const old = line(0.123456, 11450)
  old.ingredientCost = 137400
  const items = [line(2, 11450), line(0.123456, 11900), line(0.012345, 11900)]
  const sum = items.reduce((value, item) => value + item.ingredientCost, 0)
  const legacy = { date: '2026-11-23', items: [{ ingredients: [old], estimatedCost: old.ingredientCost }] }
  const current = { date: legacy.date, items: [{ costCalculationVersion: 2, ingredients: items, estimatedCost: sum }] }
  const template = [{ name: 'Ingredient Summary', rows: [[]] }]
  const sheets = buildProductionBulkSheets([template, template], [legacy, current])
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await buildSpreadsheetBuffer(sheets))
  const rows = workbook.worksheets[0]
  assert.equal(rows.getCell('E2').value, 0.12)
  assert.equal(rows.getCell('K2').value, 'Legacy')
  assert.equal(rows.getCell('E3').value, 2)
  assert.equal(rows.getCell('J3').value, 22900)
  assert.equal(rows.getCell('J3').numFmt, '#,##0.00')
  assert.equal(rows.rowCount, 4)
  const manual = [3, 4].reduce((value, row) =>
    value + Number(rows.getCell('E' + row).value) * Number(rows.getCell('I' + row).value), 0)
  assert.equal(manual.toFixed(2), sum.toFixed(2))
  assert.equal(workbook.worksheets[1].getCell('B2').value, 137400)
  assert.equal(workbook.worksheets[1].getCell('B3').value, sum)
  assert.equal(buildProductionBulkSheets([template], [legacy])[0].rows[0].length, 8)
})
