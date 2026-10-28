import assert from 'node:assert/strict'
import test from 'node:test'
import { applyProductionTableFilters, usesProductionTableQuery } from '../src/lib/production-table-query.ts'

test('the affected role tables use their own paginated requests instead of global preloads', () => {
  for (const path of [
    '/chef/menu-production-drafts', '/superadmin/menu-production-drafts',
    '/unit-manager', '/corporate-chef/', '/unit-manager/menu-production-records',
    '/admin-site/menu-production-history', '/admin-site/menu-productions', '/executive/menu-production-progress',
  ]) assert.equal(usesProductionTableQuery(path), true, path)
  for (const path of ['/chef/menu-cycle', '/chef/menu-create', '/chef/dashboard']) {
    assert.equal(usesProductionTableQuery(path), false, path)
  }
})

test('table filters retain server pagination and use inclusive local calendar date boundaries', () => {
  const params = new URLSearchParams({ page: '3', limit: '10', view: 'records' })
  applyProductionTableFilters(params, {
    productionDateFrom: '2026-10-01', productionDateTo: '2026-10-28',
    createdDateFrom: '2026-10-02', createdDateTo: '2026-10-03', clientName: ' KTB ', dateSort: 'created-desc',
  })
  assert.equal(params.get('page'), '3')
  assert.equal(params.get('limit'), '10')
  assert.equal(params.get('clientName'), 'KTB')
  assert.equal(params.get('startDate'), '2026-10-01')
  assert.equal(params.get('endDate'), '2026-10-28')
  assert.equal(params.get('createdFrom'), new Date(2026, 9, 2).toISOString())
  assert.equal(params.get('createdBefore'), new Date(2026, 9, 4).toISOString())
  assert.equal(params.get('dateSort'), 'created-desc')
})
