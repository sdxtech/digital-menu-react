import assert from 'node:assert/strict'
import test from 'node:test'
import { printIngredientSummary, summaryApprovalRows, summaryMetadata } from '../src/lib/ingredient-summary-print.ts'

test('approval summary combines production codes and deduplicates chef and approver names', () => {
  const menu = {
    submittedByName: ' Chef One ', approvalStatus: 'approved' as const,
    reviewedBy: 'UM One', financeApprovalRequired: true,
    financeCostStatus: 'approved' as const, financeCostReviewedBy: 'Finance One',
  }
  assert.deepEqual(summaryApprovalRows([
    { productionCode: 'MPR001', items: [menu, menu] },
    { productionCode: 'MPR002', items: [{ ...menu, submittedByName: 'Chef Two' }] },
    { productionCode: 'MPR001', items: [menu] },
  ]), [[
    'MPR001, MPR002', 'Chef One, Chef Two', 'Approved (UM One)', 'Approved (Finance One)',
  ]])
})

test('finance approval handles sites without a controller and missing metadata', () => {
  assert.deepEqual(summaryApprovalRows([{ items: [{
    approvalStatus: 'approved', reviewedBy: 'UM One', financeApprovalRequired: false,
  }] }]), [['-', '-', 'Approved (UM One)', 'Not Required']])
  assert.deepEqual(summaryApprovalRows([{ items: [{}] }]), [['-', '-', 'Pending (-)', 'Pending (-)']])
  assert.deepEqual(summaryApprovalRows([]), [])
})

test('summary preserves actual statuses when exporting mixed approval requirements', () => {
  assert.deepEqual(summaryApprovalRows([{ productionCode: 'MPR003', items: [
    { approvalStatus: 'approved', reviewedBy: 'UM One', financeApprovalRequired: true, financeCostStatus: 'approved', financeCostReviewedBy: 'Finance One' },
    { approvalStatus: 'pending', financeApprovalRequired: true, financeCostStatus: 'rejected', financeCostReviewedBy: 'Finance Two' },
    { approvalStatus: 'rejected', reviewedBy: 'UM Two', financeApprovalRequired: false },
  ] }]), [[
    'MPR003', '-', 'Approved (UM One), Pending (-), Rejected (UM Two)',
    'Approved (Finance One), Rejected (Finance Two), Not Required',
  ]])
})

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
    'Client: Client A, Client B',
  ])
})

test('single MPR information sheet exposes metadata without duplicating production codes', () => {
  assert.deepEqual(summaryMetadata([{ name: 'Menu Production Information', rows: [
    ['Field', 'Value'], ['Production code', 'MPR0112'],
    ['Production date', new Date('2026-11-23T00:00:00Z')], ['Client', 'Client A'],
  ] }]), ['Production date: 23-11-2026', 'Client: Client A'])
})

test('PDF highlights every duplicate product code row across vendors and preserves unique or empty codes', () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  type Element = { textContent: string; className: string; children: Element[]; append(...children: Element[]): void }
  const createElement = (): Element => ({
    textContent: '', className: '', children: [],
    append(...children) { this.children.push(...children) },
  })
  try {
    for (const header of ['Product Code', 'IT Code', 'Other']) {
      const printDocument = { title: '', createElement, head: createElement(), body: createElement() }
      Object.defineProperty(globalThis, 'document', { configurable: true, value: {
        title: 'Store Request', body: createElement(),
        createElement: () => ({
          style: { cssText: '' }, contentDocument: printDocument,
          contentWindow: { focus() {}, print() {}, addEventListener() {} }, remove() {},
        }),
      } })
      printIngredientSummary({ name: 'Ingredient Summary', rows: [
        [header, 'Vendor'],
        ['IT001', 'Vendor A'],
        ['IT002', 'Vendor A'],
        [' it001 ', 'Vendor B'],
        ['', 'Vendor A'],
        [null, 'Vendor B'],
        ['IT001', 'Vendor C'],
      ] }, 'SR.xlsx', [])
      const table = printDocument.body.children.at(-1)!
      const [head, body] = table.children
      assert.equal(head.children[0].className, '')
      assert.deepEqual(body.children.map(row => row.className), header === 'Other'
        ? ['', '', '', '', '', '']
        : ['duplicate-product', '', 'duplicate-product', '', '', 'duplicate-product'])
      assert.deepEqual(body.children.map(row => row.children[1].textContent),
        ['IT001', 'IT002', ' it001 ', '', '', 'IT001'])
      assert.ok(printDocument.head.children.some(element =>
        element.textContent.includes('.duplicate-product td{background:#fff59d;') &&
        element.textContent.includes('print-color-adjust:exact')))
    }
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument)
    else Reflect.deleteProperty(globalThis, 'document')
  }
})

test('PDF repeats SR information in the table header and restores the page title after printing or failure', () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  try {
    for (const failPrint of [false, true]) {
      const elements: Array<{ textContent: string; className: string; children: unknown[] }> = []
      const createElement = () => {
        const element = {
          textContent: '', className: '', style: { cssText: '' }, children: [] as unknown[],
          append(...children: unknown[]) { this.children.push(...children) }, remove() {},
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
              assert.ok(elements.some((element) => element.textContent === 'Site One, -'))
              assert.ok(!elements.some((element) => element.textContent.includes('Site: S116')))
              assert.ok(elements.some((element) => element.textContent === 'Finance Ops. Controller Approval'))
              assert.ok(elements.some((element) => element.textContent === 'Chef One'))
              assert.ok(elements.some((element) => element.textContent === 'Production Code'))
              assert.ok(elements.some((element) => element.textContent === 'MPR001, MPR002'))
              assert.equal(printDocument.body.children.length, 1)
              const mainTable = printDocument.body.children[0] as typeof elements[number]
              const columns = mainTable.children[0] as typeof elements[number]
              assert.deepEqual(columns.children.map(column =>
                (column as { style: { width: string } }).style.width),
                ['3%', '10%', '39%', '21.6%', '6.35%', '7.35%', '6.35%', '6.35%'])
              const repeatedHead = mainTable.children[1] as typeof elements[number]
              assert.equal(repeatedHead.children.length, 2)
              const informationRow = repeatedHead.children[0] as typeof elements[number]
              const informationCell = informationRow.children[0] as typeof elements[number] & { colSpan: number }
              assert.equal(informationCell.className, 'summary-information')
              assert.equal(informationCell.colSpan, 8)
              assert.equal((informationCell.children[0] as typeof elements[number]).textContent, 'Store Request Summary')
              const tables = informationCell.children.filter((child) =>
                elements.includes(child as typeof elements[number]) &&
                (child as typeof elements[number]).className === 'approval-table')
              assert.equal(tables.length, 1)
              assert.equal(informationCell.children[2], tables[0])
              assert.equal(informationCell.children.length, 3)
              const metadataTable = informationCell.children[1] as typeof elements[number]
              assert.equal(metadataTable.className, 'metadata-table')
              const metadataHead = metadataTable.children[0] as typeof elements[number]
              const metadataHeaders = metadataHead.children[0] as typeof elements[number]
              assert.deepEqual(metadataHeaders.children.map(cell => (cell as typeof elements[number]).textContent),
                ['Production Date', 'Site', 'Client', 'Print Timestamp'])
              assert.equal(elements.filter(element => element.textContent === 'Print Timestamp').length, 1)
              assert.ok(elements.some(element => /\d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}:\d{2} WIB$/.test(element.textContent)))
              assert.ok(!elements.some(element => element.textContent.includes('Batches:')))
              assert.ok(!elements.some(element => element.textContent.startsWith('Print Timestamp :')))
              assert.ok(elements.some(element => element.textContent.includes('text-align:center')))
              if (failPrint) throw new Error('Print failed')
            },
          },
          remove() { removed = true },
        }),
      }
      Object.defineProperty(globalThis, 'document', { configurable: true, value: page })
      const print = () => printIngredientSummary({
        name: 'Ingredient Summary', rows: [
          ['Product Type', 'Product Code', 'Ingredient Name', 'Vendor', 'SR QTY', 'SR UOM', 'Prod QTY', 'Prod UOM'],
          ['Vegetable', 'IT001', 'Carrot', 'Vendor One', 1, 'KG', 1000, 'GR'],
        ],
      }, 'SR-23-11-2026.xlsx', [{ name: 'Store Requests', rows: [
        ['Production Date', 'Site', 'Client Name', 'Production Code'],
        [new Date('2026-11-23T00:00:00Z'), 'S116', 'Client A', 'MPR001'],
        [new Date('2026-11-23T00:00:00Z'), 'S116', 'Client B', 'MPR002'],
      ] }], [
        { siteName: 'Site One', productionCode: 'MPR001', items: [{ submittedByName: 'Chef One' }] },
        { productionCode: 'MPR002', items: [{}] },
      ])
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
