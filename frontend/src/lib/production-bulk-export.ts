import type { SpreadsheetSheet, SpreadsheetCell } from './spreadsheet-export'

export type ProductionExportGroup = {
  date: string
  items: { clientName?: string }[]
}

export const filterProductionExportGroups = <T extends ProductionExportGroup>(
  groups: T[], from: string, to: string, client: string,
): T[] => {
  if (from && to && from > to) return []
  const normalizedClient = client.trim().toLowerCase()
  return groups.filter((group) =>
    (!from || group.date >= from) &&
    (!to || group.date <= to) &&
    (!normalizedClient || group.items.some((item) => item.clientName?.trim().toLowerCase() === normalizedClient)),
  )
}

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
