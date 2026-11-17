import {
  aggregateStoreRequestSummaryByVendor,
  aggregateStoreRequestSummaryAcrossGroups,
  type StoreRequestSummaryIngredient,
} from './store-request-summary.ts'
import { productionQuantityExportCells } from './production-quantity-export.ts'
import { toSpreadsheetSrQuantity, type SpreadsheetCell } from './spreadsheet-export.ts'
import { formatUnitLabel } from './unit-of-measures.ts'

type SummaryExportGroup = {
  items: Array<{ clientName?: string; ingredients?: StoreRequestSummaryIngredient[] }>
  summary?: StoreRequestSummaryIngredient[]
}

export const buildIngredientSummaryExportRows = (
  groups: SummaryExportGroup[],
  aggregateAcrossGroups = false,
): SpreadsheetCell[][] => {
  const cells = (item: StoreRequestSummaryIngredient): SpreadsheetCell[] => [
    item.productCode,
    item.name,
    item.vendor ?? '',
    toSpreadsheetSrQuantity(item.qty),
    formatUnitLabel(item.unitOfMeasures),
    ...productionQuantityExportCells(item),
  ]
  // Both summary layouts put Prod QTY/UOM in columns G/H. Zero is complete.
  const incompleteFirst = (a: SpreadsheetCell[], b: SpreadsheetCell[]) =>
    Number(a[6] !== '' && Boolean(a[7])) - Number(b[6] !== '' && Boolean(b[7]))

  if (aggregateAcrossGroups) {
    return [
      ['Product Type', 'Product Code', 'Ingredient Name', 'Vendor', 'SR QTY', 'SR UOM', 'Prod QTY', 'Prod UOM'],
      ...aggregateStoreRequestSummaryAcrossGroups(groups, true).map((item) => [
        item.ingredientType ?? '', ...cells(item),
      ]).sort(incompleteFirst),
    ]
  }

  return [
    ['Client Name', 'IT Code', 'Ingredient Name', 'Vendor', 'SR QTY', 'SR UOM', 'Prod QTY', 'Prod UOM'],
    ...groups.flatMap((group) => aggregateStoreRequestSummaryByVendor(group, true).map((item) => [
      group.items[0]?.clientName ?? '', ...cells(item),
    ])).sort(incompleteFirst),
  ]
}
