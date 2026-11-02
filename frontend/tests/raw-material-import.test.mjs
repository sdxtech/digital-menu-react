import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../src/lib/raw-material-import.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
})
const { getRawMaterialImportResult } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
)

test('an import with only duplicates explains why this attempt added no rows', () => {
  assert.deepEqual(getRawMaterialImportResult({
    jobId: '18',
    status: 'completed',
    result: { status: 'completed', successCount: 0, failCount: 36910, errors: [
      { row: 2, reason: 'Product code already exists. Use Update Prices instead.' },
      { row: 3, reason: 'Product code already exists. Use Update Prices instead.' },
    ] },
  }), {
    status: 'error',
    title: 'No raw materials imported',
    message: 'This import attempt: 0 imported, 36910 rejected. Reported issues: Product code already exists. Use Update Prices instead.',
  })
})

test('a partially successful attempt retains the imported count and shows rejection reasons', () => {
  assert.deepEqual(getRawMaterialImportResult({
    jobId: 'first', status: 'completed',
    result: { status: 'completed', successCount: 27674, failCount: 9236, errors: [
      { row: 2, reason: 'Product code already exists. Use Update Prices instead.' },
    ] },
  }), {
    status: 'success', title: 'Raw material import partially completed',
    message: 'This import attempt: 27674 imported, 9236 rejected. Reported issues: Product code already exists. Use Update Prices instead.',
  })
})

test('an entirely successful attempt reports its imported count', () => {
  assert.deepEqual(getRawMaterialImportResult({
    jobId: 'success', status: 'completed',
    result: { status: 'completed', successCount: 20, failCount: 0, errors: [] },
  }), {
    status: 'success', title: 'Raw material import completed',
    message: 'This import attempt: 20 imported, 0 rejected.',
  })
})

test('an all-rejected attempt without stored reasons does not invent a cause', () => {
  const result = getRawMaterialImportResult({
    jobId: 'rejected', status: 'completed',
    result: { status: 'completed', successCount: 0, failCount: 10, errors: [] },
  })
  assert.equal(result.status, 'error')
  assert.equal(result.message, 'This import attempt: 0 imported, 10 rejected.')
})

test('an older completed job still stops loading when its summary was not stored', () => {
  const result = getRawMaterialImportResult({ jobId: '17', status: 'completed', result: null })
  assert.equal(result.status, 'success')
  assert.match(result.message, /Detailed results are unavailable/)
})

test('retrying or queued jobs do not display a terminal result', () => {
  for (const status of ['waiting', 'active', 'delayed', 'prioritized', 'waiting-children']) {
    assert.equal(getRawMaterialImportResult({ jobId: '18', status, result: null }), null)
  }
})

test('failure and cancellation finish with the correct outcome', () => {
  assert.equal(getRawMaterialImportResult({ jobId: '18', status: 'failed', result: null }).status, 'error')
  const cancelled = getRawMaterialImportResult({
    jobId: '18',
    status: 'cancelled',
    result: { status: 'cancelled', successCount: 5, failCount: 2, errors: [] },
  })
  assert.equal(cancelled.status, 'cancelled')
  assert.match(cancelled.message, /Success before cancellation: 5, failed: 2/)
})
