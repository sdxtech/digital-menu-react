import { toSpreadsheetDecimal, type SpreadsheetCell } from './spreadsheet-export.ts'
import { formatUnitLabel } from './unit-of-measures.ts'

export const productionQuantityExportCells = (ingredient?: {
  prodQty?: number
  prodUomCode?: string
}): SpreadsheetCell[] => [
  ingredient?.prodQty != null && Number.isFinite(ingredient.prodQty)
    ? toSpreadsheetDecimal(ingredient.prodQty) : '',
  ingredient?.prodUomCode ? formatUnitLabel(ingredient.prodUomCode) : '',
]
