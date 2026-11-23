import type { SpreadsheetCell, SpreadsheetSheet } from './spreadsheet-export'

export type SummaryPrintMenu = {
  submittedByName?: string
  approvalStatus?: 'pending' | 'approved' | 'rejected'
  reviewedBy?: string
  financeApprovalRequired?: boolean
  financeCostStatus?: 'pending' | 'approved' | 'rejected'
  financeCostReviewedBy?: string
}

export type SummaryPrintGroup = {
  siteName?: string
  productionCode?: string
  items: SummaryPrintMenu[]
}

export const summaryApprovalRows = (groups: SummaryPrintGroup[]): string[][] => {
  if (!groups.length) return []
  const names = (values: Array<string | undefined>) =>
    Array.from(new Set(values.map(value => value?.trim()).filter(Boolean))).join(', ') || '-'
  const approval = (menus: SummaryPrintMenu[], finance: boolean) => {
    const entries = new Map<string, Array<string | undefined>>()
    for (const menu of menus) {
      const status = finance && menu.financeApprovalRequired === false
        ? 'Not Required'
        : ({ approved: 'Approved', pending: 'Pending', rejected: 'Rejected' }[
          (finance ? menu.financeCostStatus : menu.approvalStatus) ?? 'pending'
        ])
      const reviewers = entries.get(status) ?? []
      reviewers.push(finance ? menu.financeCostReviewedBy : menu.reviewedBy)
      entries.set(status, reviewers)
    }
    return Array.from(entries, ([status, reviewers]) =>
      status === 'Not Required' ? status : `${status} (${names(reviewers)})`).join(', ') || 'Pending (-)'
  }
  const menus = groups.flatMap(group => group.items)
  return [[
    names(groups.map(group => group.productionCode)),
    names(menus.map(menu => menu.submittedByName)),
    approval(menus, false),
    approval(menus, true),
  ]]
}

const cellText = (cell: SpreadsheetCell): string => {
  if (cell == null) return ''
  if (cell instanceof Date) return cell.toISOString().slice(0, 10).split('-').reverse().join('-')
  if (typeof cell === 'object') return cell.format === 'money' ? cell.value.toFixed(2) : String(cell.value)
  return String(cell)
}

export const chooseSummaryExportFormat = (): Promise<'excel' | 'pdf' | 'cancel'> =>
  new Promise((resolve) => {
    const dialog = document.createElement('dialog')
    dialog.style.cssText = 'margin:auto;padding:24px;border:1px solid #d6dce7;border-radius:8px;box-shadow:0 8px 32px #0003;font:14px sans-serif;max-width:90vw'
    const title = document.createElement('h2')
    title.textContent = 'Export Ingredient Summary'
    const description = document.createElement('p')
    description.textContent = 'Choose Excel or print the Ingredient Summary as PDF.'
    dialog.append(title, description)
    for (const [label, value] of [['Export Excel', 'excel'], ['Export PDF', 'pdf'], ['Cancel', 'cancel']] as const) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = label
      button.style.cssText = 'padding:8px 12px;margin:8px 8px 0 0;cursor:pointer'
      button.addEventListener('click', () => dialog.close(value))
      dialog.append(button)
    }
    dialog.addEventListener('close', () => {
      const value = dialog.returnValue
      dialog.remove()
      resolve(value === 'excel' || value === 'pdf' ? value : 'cancel')
    }, { once: true })
    document.body.append(dialog)
    try {
      dialog.showModal()
    } catch (error) {
      dialog.remove()
      throw error
    }
  })

export const summaryMetadata = (sheets: SpreadsheetSheet[]): string[] => {
  const values = new Map<string, Set<string>>()
  const names = new Map([
    ['production date', 'Production date'], ['site', 'Site'],
    ['client', 'Client'], ['client name', 'Client'],
  ])
  const add = (key: string, cell: SpreadsheetCell) => {
    const name = names.get(key.trim().toLowerCase())
    const value = cellText(cell).trim()
    if (!name || !value || value === '-') return
    const entries = values.get(name) ?? new Set<string>()
    entries.add(value)
    values.set(name, entries)
  }
  for (const sheet of sheets) {
    if (sheet.name === 'Ingredient Summary' || !sheet.rows.length) continue
    const headers = sheet.rows[0].map(cellText)
    if (headers[0]?.toLowerCase() === 'field') {
      sheet.rows.slice(1).forEach((row) => add(cellText(row[0]), row[1]))
    } else {
      sheet.rows.slice(1).forEach((row) => headers.forEach((header, index) => add(header, row[index])))
    }
  }
  return Array.from(values, ([name, entries]) => `${name}: ${Array.from(entries).join(', ')}`)
}

export const printIngredientSummary = (sheet: SpreadsheetSheet, filename: string, sheets: SpreadsheetSheet[], groups?: SummaryPrintGroup[]): void => {
  if (sheet.rows.length <= 1) throw new Error('No ingredient summary data found.')
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;width:1px;height:1px;right:0;bottom:0;border:0'
  document.body.append(frame)
  const doc = frame.contentDocument
  const view = frame.contentWindow
  if (!doc || !view) { frame.remove(); throw new Error('Unable to open print view.') }
  const printTitle = filename.replace(/\.xlsx$/i, '')
  doc.title = printTitle
  const style = doc.createElement('style')
  style.textContent = `
    @page{size:A4 portrait;margin:10mm}
    body{margin:0;font:10px Arial,sans-serif;color:#111}
    h1{font-size:17px;text-align:center}
    table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:8pt;line-height:1.15}
    thead{display:table-header-group}
    tr{break-inside:avoid}
    th,td{box-sizing:border-box;border:0.5px solid #aaa;padding:1px 2px;overflow-wrap:break-word;text-align:left;vertical-align:top}
    th{background:#d9e1f2;-webkit-print-color-adjust:exact;print-color-adjust:exact;text-align:center}
    .duplicate-product td{background:#fff59d;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    th:nth-child(1){width:3%}
    th:nth-child(2){width:10%}
    th:nth-child(3){width:39%}
    th:nth-child(4){width:21.6%}
    th:nth-child(5){width:6.35%}
    th:nth-child(6){width:7.35%}
    th:nth-child(7),th:nth-child(8){width:6.35%}
    td:nth-child(5),td:nth-child(7){text-align:right}
    td:first-child{text-align:center}
    .summary-information{padding:0;border:0;text-align:left}
    .metadata-table,.approval-table{margin:0 0 16px;font-size:9px;table-layout:fixed;break-inside:avoid}
    .metadata-table{margin-bottom:0}
    .metadata-table + .approval-table thead th{border-top:0}
    .metadata-table th:nth-child(n),.approval-table th:nth-child(n){width:auto}
    .metadata-table th,.metadata-table td,.approval-table th,.approval-table td{padding:5px;text-align:center;vertical-align:middle}
    .approval-table tr{break-inside:avoid}
  `
  if (sheet.rows[0].includes('Ingredient Cost')) {
    style.textContent += `
      @page{size:A4 landscape}
      table{table-layout:auto}
      thead th:nth-child(n){width:auto}
    `
  }
  doc.head.append(style)
  const heading = doc.createElement('h1')
  heading.textContent = 'Store Request Summary'
  const metadata = summaryMetadata(sheets)
  if (groups?.length) {
    const siteNames = Array.from(new Set(groups.map(group => group.siteName?.trim() || '-')))
    const siteIndex = metadata.findIndex(value => value.startsWith('Site:'))
    const siteText = `Site: ${siteNames.join(', ')}`
    if (siteIndex >= 0) metadata[siteIndex] = siteText
    else metadata.push(siteText)
  }
  const timestamp = `${new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(new Date())} WIB`
  const metadataTable = doc.createElement('table')
  metadataTable.className = 'metadata-table'
  const metadataHead = doc.createElement('thead')
  const metadataBody = doc.createElement('tbody')
  const metadataRows = [
    ['Production Date', 'Site', 'Client', 'Print Timestamp'],
    [
      ...['Production date', 'Site', 'Client'].map(name =>
        metadata.find(value => value.startsWith(`${name}: `))?.slice(name.length + 2) || '-'),
      timestamp,
    ],
  ]
  metadataRows.forEach((row, index) => {
    const tr = doc.createElement('tr')
    row.forEach(value => {
      const cell = doc.createElement(index === 0 ? 'th' : 'td')
      cell.textContent = value
      tr.append(cell)
    })
    ;(index === 0 ? metadataHead : metadataBody).append(tr)
  })
  metadataTable.append(metadataHead, metadataBody)
  const table = doc.createElement('table')
  const head = doc.createElement('thead')
  const body = doc.createElement('tbody')
  const productTypeIndex = sheet.rows[0].findIndex((cell) => cellText(cell).trim().toLowerCase() === 'product type')
  const informationRow = doc.createElement('tr')
  const informationCell = doc.createElement('td')
  informationCell.className = 'summary-information'
  informationCell.colSpan = sheet.rows[0].length + 1 - (productTypeIndex >= 0 ? 1 : 0)
  if (informationCell.colSpan === 8 && !sheet.rows[0].includes('Ingredient Cost')) {
    // A spanning first header row needs explicit columns to preserve the print widths.
    const columns = doc.createElement('colgroup')
    for (const width of [3, 10, 39, 21.6, 6.35, 7.35, 6.35, 6.35]) {
      const column = doc.createElement('col')
      column.style.width = `${width}%`
      columns.append(column)
    }
    table.append(columns)
  }
  informationCell.append(heading, metadataTable)
  informationRow.append(informationCell)
  head.append(informationRow)
  const productionQuantityIndex = sheet.rows[0].findIndex((cell) => cellText(cell).trim().toLowerCase() === 'prod qty')
  const productCodeIndex = sheet.rows[0].findIndex((cell) =>
    ['product code', 'it code'].includes(cellText(cell).trim().toLowerCase()))
  const productCodeCounts = new Map<string, number>()
  for (const row of sheet.rows.slice(1)) {
    const code = cellText(row[productCodeIndex]).trim().toUpperCase()
    if (code) productCodeCounts.set(code, (productCodeCounts.get(code) ?? 0) + 1)
  }
  sheet.rows.forEach((row, index) => {
    const tr = doc.createElement('tr')
    const code = cellText(row[productCodeIndex]).trim().toUpperCase()
    if (index > 0 && (productCodeCounts.get(code) ?? 0) > 1) tr.className = 'duplicate-product'
    const numberCell = doc.createElement(index === 0 ? 'th' : 'td')
    numberCell.textContent = index === 0 ? 'No' : String(index)
    tr.append(numberCell)
    row.forEach((cell, columnIndex) => {
      if (columnIndex === productTypeIndex) return
      const td = doc.createElement(index === 0 ? 'th' : 'td')
      const value = typeof cell === 'object' && cell !== null && 'value' in cell ? cell.value : cell
      td.textContent = index > 0 && columnIndex === productionQuantityIndex && typeof value === 'number' && Number.isFinite(value)
        ? String(Number(value.toFixed(2)))
        : cellText(cell)
      tr.append(td)
    })
    ;(index === 0 ? head : body).append(tr)
  })
  table.append(head, body)
  if (groups?.length) {
    const approvals = doc.createElement('table')
    approvals.className = 'approval-table'
    const approvalHead = doc.createElement('thead')
    const approvalBody = doc.createElement('tbody')
    const rows = [
      ['Production Code', 'Created By', 'UM Approval', 'Finance Ops. Controller Approval'],
      ...summaryApprovalRows(groups),
    ]
    rows.forEach((row, index) => {
      const tr = doc.createElement('tr')
      row.forEach(value => {
        const cell = doc.createElement(index === 0 ? 'th' : 'td')
        cell.textContent = value
        tr.append(cell)
      })
      ;(index === 0 ? approvalHead : approvalBody).append(tr)
    })
    approvals.append(approvalHead, approvalBody)
    informationCell.append(approvals)
  }
  doc.body.append(table)
  const originalTitle = document.title
  view.addEventListener('afterprint', () => {
    if (document.title === printTitle) document.title = originalTitle
    frame.remove()
  }, { once: true })
  try {
    document.title = printTitle
    view.focus()
    view.print()
  } catch (error) {
    if (document.title === printTitle) document.title = originalTitle
    frame.remove()
    throw error
  }
}
