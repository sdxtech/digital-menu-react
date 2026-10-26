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

test('a completed import with only duplicates stops loading and shows the failed row count', () => {
  assert.deepEqual(getRawMaterialImportResult({
    jobId: '18',
    status: 'completed',
    result: { status: 'completed', successCount: 0, failCount: 2166, errors: [] },
  }), {
    status: 'success',
    title: 'Raw material import completed',
    message: 'Raw material import finished. Success: 0, failed: 2166.',
  })
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
