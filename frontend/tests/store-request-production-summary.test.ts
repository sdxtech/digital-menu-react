import assert from 'node:assert/strict'
import test from 'node:test'
import { aggregateStoreRequestSummary } from '../src/lib/store-request-summary.ts'
import { buildIngredientSummaryExportRows } from '../src/lib/ingredient-summary-export.ts'

const ingredient = { productCode: 'IT001', name: 'Rice', unitOfMeasures: 'KG', qty: 1, prodQty: 1000, prodUomCode: 'GR' }

test('single and bulk summary export merge resolved legacy and new quantities', () => {
  const old = { ...ingredient, qty: 6, prodQty: 6000, vendor: 'Same Vendor' }
  const recent = { ...ingredient, qty: 1.2, prodQty: 1200, vendor: 'Same Vendor' }
  const group = { items: [{ clientName: 'Client', ingredients: [old, recent] }] }
  for (const bulk of [false, true]) {
    const rows = buildIngredientSummaryExportRows([group], bulk)
    assert.equal(rows.length, 2)
    assert.deepEqual(rows[1].slice(4), [
      { kind: 'decimal', value: 7.2, format: 'quantity' }, 'KG', { kind: 'decimal', value: 7200 }, 'GR',
    ])
  }
})

test('production summary merges SR quantities and blanks conflicting production units', () => {
  const rows = [ingredient, { ...ingredient, qty: 2, prodQty: 2000 }, { ...ingredient, prodQty: 1, prodUomCode: 'KG' }]
  const summary = aggregateStoreRequestSummary(rows, false, true)
  assert.equal(summary.length, 1)
  assert.equal(summary[0].qty, 4)
  assert.equal(summary[0].prodQty, undefined)
  assert.equal(summary[0].prodUomCode, undefined)
  assert.equal(aggregateStoreRequestSummary(rows).length, 1)
  assert.equal(aggregateStoreRequestSummary(rows)[0].qty, 4)
})

test('production summary preserves zero, missing values, and separate NMP rows', () => {
  assert.equal(aggregateStoreRequestSummary([{ ...ingredient, prodQty: 0 }], false, true)[0].prodQty, 0)
  const incomplete = aggregateStoreRequestSummary([ingredient, { ...ingredient, prodQty: undefined }], false, true)
  assert.equal(incomplete[0].prodQty, undefined)
  assert.equal(incomplete[0].prodUomCode, undefined)
  assert.equal(incomplete[0].qty, 2)
  const nmp = { ...ingredient, productCode: 'NMP', ingredientType: 'NMP' as const }
  assert.equal(aggregateStoreRequestSummary([nmp, nmp], false, true).length, 2)
})

test('single and bulk exports merge incomplete lettuce rows and keep production totals blank in either order', () => {
  const old = { ...ingredient, qty: 9, prodQty: undefined, prodUomCode: undefined }
  const recent = { ...ingredient, qty: 1.8, prodQty: 1800 }
  for (const rows of [[old, recent, recent], [recent, old, recent], [recent, recent, old]]) {
    const original = JSON.stringify(rows)
    const groups = rows.map((row) => ({ items: [{ ingredients: [row] }] }))
    const single = { items: [{ ingredients: rows }] }
    for (const exported of [buildIngredientSummaryExportRows([single]), buildIngredientSummaryExportRows(groups, true)]) {
      assert.equal(exported.length, 2)
      assert.deepEqual(exported[1].slice(4), [{ kind: 'decimal', value: 12.6, format: 'quantity' }, 'KG', '', ''])
    }
    assert.equal(JSON.stringify(rows), original)
  }
  const summary = aggregateStoreRequestSummary([old, recent], true, true)
  assert.equal(summary.length, 1)
  assert.equal(summary[0].qty, 10.8)
  assert.equal(summary[0].prodQty, undefined)
  assert.equal(summary[0].prodUomCode, undefined)
})

test('production summaries keep different SR units and vendors separate', () => {
  const summary = aggregateStoreRequestSummary([
    ingredient, { ...ingredient, unitOfMeasures: 'BAG' }, { ...ingredient, vendor: 'Another vendor' },
  ], true, true)
  assert.equal(summary.length, 3)
})

test('single and bulk summary exports put incomplete production data first and preserve zero', () => {
  const rows = [
    { ...ingredient, productCode: 'IT001', prodQty: 0 },
    { ...ingredient, productCode: 'IT002', prodQty: undefined, prodUomCode: undefined },
    { ...ingredient, productCode: 'IT003' },
    { ...ingredient, productCode: 'IT004', prodQty: undefined },
  ]
  const groups = rows.map((row) => ({ items: [{ clientName: 'Client', ingredients: [row] }] }))
  const original = JSON.stringify(groups)
  for (const bulk of [false, true]) {
    const result = buildIngredientSummaryExportRows(groups, bulk)
    assert.deepEqual(result.slice(1).map((row) => row[1]), ['IT002', 'IT004', 'IT001', 'IT003'])
    assert.deepEqual(result[3][6], { kind: 'decimal', value: 0 })
    assert.equal(result[3][7], 'GR')
  }
  assert.equal(JSON.stringify(groups), original)
})

test('SR summaries sort categories first, then missing production data, ingredient name and vendor', () => {
  const rows = [
    { ...ingredient, productCode: 'IT001', name: 'Vegetable _ GARLIC', vendor: 'Vendor Z' },
    { ...ingredient, productCode: 'IT002', name: 'Uncategorized', prodQty: undefined },
    { ...ingredient, productCode: 'IT003', name: 'Vegetables _ CARROT', prodQty: undefined },
    { ...ingredient, productCode: 'IT004', name: 'Leaves _ LETTUCE', prodQty: 0 },
    { ...ingredient, productCode: 'IT005', name: 'Fruit _ LEMON' },
    { ...ingredient, productCode: 'IT006', name: 'Dairy _ MILK' },
    { ...ingredient, productCode: 'IT007', name: 'Dry Goods _ SALT' },
    { ...ingredient, productCode: 'IT008', name: 'Cooking Oil _ CANOLA' },
    { ...ingredient, productCode: 'IT009', name: 'vegetables _ APPLE', prodQty: 0 },
    { ...ingredient, productCode: 'IT010', name: 'Vegetables _ ZUCCHINI', prodQty: undefined },
    { ...ingredient, productCode: 'IT011', name: 'Vegetables _ GARLIC', vendor: 'Vendor A' },
    { ...ingredient, productCode: 'IT012', name: ' _ No category' },
  ]
  const groups = rows.map(row => ({ items: [{ clientName: 'Client', ingredients: [row] }] }))
  const original = JSON.stringify(groups)
  for (const bulk of [false, true]) {
    const result = buildIngredientSummaryExportRows(groups, bulk)
    assert.deepEqual(result.slice(1).map(row => row[1]), [
      'IT008', 'IT006', 'IT007', 'IT005', 'IT004',
      'IT003', 'IT010', 'IT009', 'IT011', 'IT001', 'IT002', 'IT012',
    ])
    assert.equal(result.length, rows.length + 1)
    assert.deepEqual(result.slice(1).map(row => row[2]).sort(), rows.map(row => row.name.trim()).sort())
  }
  assert.equal(JSON.stringify(groups), original)
})

test('SR categories stay together across legacy and current cost versions without changing number formats', () => {
  const groups = [
    { items: [{ ingredients: [{ ...ingredient, productCode: 'IT001', name: 'Leaves _ LETTUCE' }] }] },
    { items: [{ costCalculationVersion: 2, ingredients: [
      { ...ingredient, productCode: 'IT002', name: 'Fruit _ LEMON', qty: 1.234567 },
      { ...ingredient, productCode: 'IT003', name: 'Leaves _ BASIL', prodQty: undefined },
    ] }] },
  ]
  for (const bulk of [false, true]) {
    const result = buildIngredientSummaryExportRows(groups, bulk)
    assert.deepEqual(result.slice(1).map(row => row[1]), ['IT002', 'IT003', 'IT001'])
    assert.deepEqual(result[1][4], { kind: 'decimal', value: 1.234567 })
    assert.deepEqual(result[3][4], { kind: 'decimal', value: 1, format: 'quantity' })
  }
})
