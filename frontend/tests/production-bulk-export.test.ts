import assert from 'node:assert/strict'
import test from 'node:test'
import { buildProductionBulkSheets } from '../src/lib/production-bulk-export.ts'
import type { SpreadsheetSheet } from '../src/lib/spreadsheet-export.ts'

const batch = (code: string, client: string, cost: number): SpreadsheetSheet[] => [
  { name: 'Menu Production Information', rows: [
    ['Field', 'Value'], ['Production code', code], ['Client', client],
    ['Total Estimated Food Cost', { kind: 'decimal', value: cost }],
  ] },
  { name: 'Store Request Detail', rows: [['No', 'Production Code', 'Ingredient'], [1, code, 'Rice']] },
  { name: 'Ingredient Summary', rows: [['Client', 'Ingredient', 'QTY'], [client, 'Rice', 10]] },
]

test('keeps batch identity and financial values separate across clients in every sheet', () => {
  const batches = [batch('MPR-1', 'Client A', 100), batch('MPR-2', 'Client B', 250)]
  const before = structuredClone(batches)
  const sheets = buildProductionBulkSheets(batches)
  assert.deepEqual(sheets[0].rows, [
    ['Batch No', 'Production code', 'Client', 'Total Estimated Food Cost'],
    [1, 'MPR-1', 'Client A', { kind: 'decimal', value: 100 }],
    [2, 'MPR-2', 'Client B', { kind: 'decimal', value: 250 }],
  ])
  assert.deepEqual(sheets[1].rows.slice(1), [[1, 1, 'MPR-1', 'Rice'], [2, 1, 'MPR-2', 'Rice']])
  assert.deepEqual(sheets[2].rows.slice(1), [[1, 'Client A', 'Rice', 10], [2, 'Client B', 'Rice', 10]])
  assert.deepEqual(batches, before)
})

test('exports every supplied batch across pagination boundaries and keeps empty details valid', () => {
  const batches = Array.from({ length: 25 }, (_, index) => batch(`MPR-${index}`, 'Client A', index))
  batches[0][1].rows = [batches[0][1].rows[0]]
  const sheets = buildProductionBulkSheets(batches)
  assert.equal(sheets[0].rows.length, 26)
  assert.equal(sheets[1].rows.length, 25)
  assert.equal(sheets[2].rows.at(-1)?.[0], 25)
  assert.deepEqual(buildProductionBulkSheets([]), [])
})
