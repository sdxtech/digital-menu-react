import type { SpreadsheetSheet, SpreadsheetCell } from './spreadsheet-export'

// Keep each batch's existing calculations and fulfillment detail intact.
export const buildProductionBulkSheets = (batches: SpreadsheetSheet[][]): SpreadsheetSheet[] => {
  if (!batches.length) return []
  return batches[0].map((sheet, sheetIndex) => {
    const information = sheet.name === 'Menu Production Information'
    const rows: SpreadsheetCell[][] = [
      ['Batch No', ...(information
        ? sheet.rows.slice(1).map((row) => row[0])
        : sheet.rows[0])],
    ]
    batches.forEach((batch, index) => {
      const source = batch[sheetIndex]
      if (information) {
        rows.push([index + 1, ...source.rows.slice(1).map((row) => row[1])])
      } else {
        source.rows.slice(1).forEach((row) => rows.push([index + 1, ...row]))
      }
    })
    if (rows.length > 1_048_576) {
      throw new Error('Too many rows for an Excel worksheet. Narrow the export filters.')
    }
    return { name: sheet.name, rows }
  })
}
