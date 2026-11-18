import assert from 'node:assert/strict'
import test from 'node:test'
import { printIngredientSummary, summaryMetadata } from '../src/lib/ingredient-summary-print.ts'

test('print metadata combines batches without repeating menu rows', () => {
  const metadata = summaryMetadata([{
    name: 'Store Requests',
    rows: [
      ['Production Date', 'Site', 'Client Name', 'Production Code'],
      [new Date('2026-11-23T00:00:00Z'), 'S116', 'Client A', 'MPR0112'],
      [new Date('2026-11-23T00:00:00Z'), 'S116', 'Client A', 'MPR0112'],
      [new Date('2026-11-24T00:00:00Z'), 'S116', 'Client B', 'MPR0118'],
    ],
  }])
  assert.deepEqual(metadata, [
    'Production date: 23-11-2026, 24-11-2026', 'Site: S116',
    'Client: Client A, Client B', 'Batches: 2',
  ])
})

test('single MPR information sheet exposes production date and code', () => {
  assert.deepEqual(summaryMetadata([{ name: 'Menu Production Information', rows: [
    ['Field', 'Value'], ['Production code', 'MPR0112'],
    ['Production date', new Date('2026-11-23T00:00:00Z')], ['Client', 'Client A'],
  ] }]), ['MPR: MPR0112', 'Production date: 23-11-2026', 'Client: Client A'])
})

test('PDF uses the Excel filename and restores the page title after printing or failure', () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  try {
    for (const failPrint of [false, true]) {
      const elements: Array<{ textContent: string }> = []
      const createElement = () => {
        const element = {
          textContent: '', className: '', style: { cssText: '' },
          append() {}, remove() {},
        }
        elements.push(element)
        return element
      }
      const printDocument = { title: '', createElement, head: createElement(), body: createElement() }
      let afterPrint = () => {}
      let removed = false
      const page = {
        title: 'Quick View | SPICES', body: createElement(),
        createElement: () => ({
          style: { cssText: '' }, contentDocument: printDocument,
          contentWindow: {
            focus() {},
            addEventListener(_event: string, callback: () => void) { afterPrint = callback },
            print() {
              assert.equal(page.title, 'SR-23-11-2026')
              assert.equal(printDocument.title, 'SR-23-11-2026')
              assert.ok(elements.some((element) => element.textContent === 'Store Request Summary'))
              if (failPrint) throw new Error('Print failed')
            },
          },
          remove() { removed = true },
        }),
      }
      Object.defineProperty(globalThis, 'document', { configurable: true, value: page })
      const print = () => printIngredientSummary({
        name: 'Ingredient Summary', rows: [['Product Code', 'Ingredient Name'], ['IT001', 'Carrot']],
      }, 'SR-23-11-2026.xlsx', [])
      if (failPrint) assert.throws(print, /Print failed/)
      else {
        print()
        afterPrint()
      }
      assert.equal(page.title, 'Quick View | SPICES')
      assert.equal(removed, true)
    }
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument)
    else Reflect.deleteProperty(globalThis, 'document')
  }
})
