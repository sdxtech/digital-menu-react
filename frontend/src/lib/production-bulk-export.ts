import type { SpreadsheetSheet, SpreadsheetCell } from './spreadsheet-export'
import { buildMprIngredientSummaryRows } from './ingredient-summary-export.ts'
import type { StoreRequestSummaryIngredient } from './store-request-summary'

export type ProductionExportGroup = {
  date: string
  items: { costCalculationVersion?: number; estimatedCost?: number; clientName?: string; ingredients?: StoreRequestSummaryIngredient[] }[]
  summary?: StoreRequestSummaryIngredient[]
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
export const buildProductionBulkSheets = (
  batches: SpreadsheetSheet[][],
  groups?: ProductionExportGroup[],
): SpreadsheetSheet[] => {
  if (!batches.length) return []
  const sheets = batches[0].map((sheet, sheetIndex) => {
    if (sheet.name === 'Ingredient Summary' && groups) {
      const rows = buildMprIngredientSummaryRows(groups, true)
      if (rows.length > 1_048_576) {
        throw new Error('Too many rows for an Excel worksheet. Narrow the export filters.')
      }
      return { name: sheet.name, rows }
    }
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
  const menus = groups?.flatMap(group => group.items) ?? []
  if (menus.some(menu => menu.costCalculationVersion === 2) &&
      menus.some(menu => menu.costCalculationVersion !== 2)) {
    const rows: SpreadsheetCell[][] = [['Cost Version', 'Total Estimated Food Cost']]
    for (const version of [1, 2]) {
      const subtotal = menus.filter(menu => (menu.costCalculationVersion ?? 1) === version)
        .reduce((total, menu) => total + (menu.estimatedCost ?? 0), 0)
      rows.push([version === 1 ? 'Legacy' : '2', { kind: 'decimal', value: subtotal, format: 'money' }])
    }
    sheets.push({ name: 'Cost Subtotals', rows })
  }
  return sheets
}
