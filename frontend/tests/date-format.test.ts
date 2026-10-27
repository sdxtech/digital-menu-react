import assert from 'node:assert/strict'
import test from 'node:test'
import { formatCreatedDate, formatProductionDate } from '../src/lib/date-format.ts'

test('production dates use dd-mm-yyyy without changing the calendar day', () => {
  assert.equal(formatProductionDate('2026-10-27'), '27-10-2026')
  assert.equal(formatProductionDate('2026-01-02'), '02-01-2026')
  assert.equal(formatProductionDate('2028-02-29'), '29-02-2028')
})

test('created dates use the local date and 24-hour hh:mm without seconds', () => {
  assert.equal(formatCreatedDate(new Date(2026, 9, 27, 8, 5, 59).toISOString()), '27-10-2026 08:05')
  assert.equal(formatCreatedDate(new Date(2026, 0, 2, 0, 0, 30).toISOString()), '02-01-2026 00:00')
  assert.equal(formatCreatedDate(new Date(2026, 11, 31, 23, 59).toISOString()), '31-12-2026 23:59')
})

test('missing or invalid dates display a placeholder', () => {
  for (const value of [undefined, '', 'invalid']) {
    assert.equal(formatCreatedDate(value), '-')
    assert.equal(formatProductionDate(value), '-')
  }
  for (const value of ['2026-02-29', '2026-04-31', '2026-13-01', '27-10-2026']) {
    assert.equal(formatProductionDate(value), '-')
  }
})
