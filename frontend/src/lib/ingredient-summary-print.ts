import type { SpreadsheetCell, SpreadsheetSheet } from './spreadsheet-export'

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
    ['client', 'Client'], ['client name', 'Client'], ['production code', 'MPR'],
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
  return Array.from(values, ([name, entries]) => {
    const list = Array.from(entries)
    return name === 'MPR' && list.length > 1 ? `Batches: ${list.length}` : `${name}: ${list.join(', ')}`
  })
}

export const printIngredientSummary = (sheet: SpreadsheetSheet, filename: string, sheets: SpreadsheetSheet[]): void => {
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
    h1{font-size:17px}
    .summary-metadata{font-size:13px;line-height:1.5}
    table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:6pt;line-height:1.15}
    thead{display:table-header-group}
    tr{break-inside:avoid}
    th,td{box-sizing:border-box;border:0.5px solid #aaa;padding:1px 2px;overflow-wrap:break-word;text-align:left;vertical-align:top}
    th{background:#d9e1f2;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    th:nth-child(1){width:3%}
    th:nth-child(2){width:10%}
    th:nth-child(3){width:39%}
    th:nth-child(4){width:27%}
    th:nth-child(5){width:5%}
    th:nth-child(6){width:6%}
    th:nth-child(7),th:nth-child(8){width:5%}
    td:nth-child(5),td:nth-child(7){text-align:right}
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
  const subtitle = doc.createElement('p')
  subtitle.className = 'summary-metadata'
  subtitle.textContent = summaryMetadata(sheets).join(' | ') || filename.replace(/\.xlsx$/i, '')
  const timestamp = doc.createElement('p')
  timestamp.textContent = `Print Timestamp : ${new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(new Date())} WIB`
  const table = doc.createElement('table')
  const head = doc.createElement('thead')
  const body = doc.createElement('tbody')
  const productTypeIndex = sheet.rows[0].findIndex((cell) => cellText(cell).trim().toLowerCase() === 'product type')
  const productionQuantityIndex = sheet.rows[0].findIndex((cell) => cellText(cell).trim().toLowerCase() === 'prod qty')
  sheet.rows.forEach((row, index) => {
    const tr = doc.createElement('tr')
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
  doc.body.append(timestamp, heading, subtitle, table)
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
