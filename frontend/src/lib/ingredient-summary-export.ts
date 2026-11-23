import {
  aggregateStoreRequestSummary,
  aggregateStoreRequestSummaryByVendor,
  aggregateStoreRequestSummaryAcrossGroups,
  type StoreRequestSummaryIngredient,
} from './store-request-summary.ts'
import { productionQuantityExportCells } from './production-quantity-export.ts'
import { toSpreadsheetDecimal, toSpreadsheetSrQuantity, type SpreadsheetCell } from './spreadsheet-export.ts'
import { formatUnitLabel } from './unit-of-measures.ts'

type SummaryExportGroup = {
  items: Array<{ costCalculationVersion?: number; clientName?: string; ingredients?: StoreRequestSummaryIngredient[] }>
  summary?: StoreRequestSummaryIngredient[]
}

const summaryCollator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

const ingredientSortKey = (cell: SpreadsheetCell) => {
  const value = String(cell ?? '').trim()
  const separator = value.indexOf('_')
  const category = separator < 0 ? '' : value.slice(0, separator).trim().replace(/\s+/g, ' ').toLowerCase()
  return {
    category: category === 'vegetable' ? 'vegetables' : category,
    name: separator < 0 ? value : value.slice(separator + 1).trim(),
  }
}

const compareSummaryRows = (a: SpreadsheetCell[], b: SpreadsheetCell[]) => {
  const left = ingredientSortKey(a[2])
  const right = ingredientSortKey(b[2])
  // Both layouts put Prod QTY/UOM in columns G/H. Zero is complete.
  return Number(!left.category) - Number(!right.category) ||
    summaryCollator.compare(left.category, right.category) ||
    Number(a[6] !== '' && Boolean(a[7])) - Number(b[6] !== '' && Boolean(b[7])) ||
    summaryCollator.compare(left.name, right.name) ||
    summaryCollator.compare(String(a[3] ?? '').trim(), String(b[3] ?? '').trim())
}

const buildQuantitySummaryRows = (
  groups: SummaryExportGroup[],
  aggregateAcrossGroups: boolean,
  costCalculationVersion?: number,
): SpreadsheetCell[][] => {
  const cells = (item: StoreRequestSummaryIngredient): SpreadsheetCell[] => [
    item.productCode,
    item.name,
    item.vendor ?? '',
    toSpreadsheetSrQuantity(item.qty, costCalculationVersion),
    formatUnitLabel(item.unitOfMeasures),
    ...productionQuantityExportCells(item),
  ]
  if (aggregateAcrossGroups) {
    return [
      ['Product Type', 'Product Code', 'Ingredient Name', 'Vendor', 'SR QTY', 'SR UOM', 'Prod QTY', 'Prod UOM'],
      ...aggregateStoreRequestSummaryAcrossGroups(groups, true).map((item) => [
        item.ingredientType ?? '', ...cells(item),
      ]).sort(compareSummaryRows),
    ]
  }

  return [
    ['Client Name', 'IT Code', 'Ingredient Name', 'Vendor', 'SR QTY', 'SR UOM', 'Prod QTY', 'Prod UOM'],
    ...groups.flatMap((group) => aggregateStoreRequestSummaryByVendor(group, true).map((item) => [
      group.items[0]?.clientName ?? '', ...cells(item),
    ])).sort(compareSummaryRows),
  ]
}

const groupsForCostVersion = (groups: SummaryExportGroup[], current: boolean) =>
  groups.flatMap(group => {
    const items = group.items.filter(menu => (menu.costCalculationVersion === 2) === current)
    if (items.length > 0 && items.length === group.items.length) return [group]
    if (!current && !group.items.length) return [group]
    return items.length ? [{ items }] : []
  })

export const buildIngredientSummaryExportRows = (
  groups: SummaryExportGroup[],
  acrossGroups = false,
): SpreadsheetCell[][] => {
  const current = groupsForCostVersion(groups, true)
  if (!current.length) return buildQuantitySummaryRows(groups, acrossGroups)
  const [headers, ...legacy] = buildQuantitySummaryRows(groupsForCostVersion(groups, false), acrossGroups)
  const rows = [...legacy, ...buildQuantitySummaryRows(current, acrossGroups, 2).slice(1)]
  return [headers, ...rows.sort(compareSummaryRows)]
}

export const buildMprIngredientSummaryRows = (
  groups: SummaryExportGroup[],
  acrossGroups = false,
): SpreadsheetCell[][] => {
  if (!groups.some(group => group.items.some(menu => menu.costCalculationVersion === 2))) {
    return buildIngredientSummaryExportRows(groups, acrossGroups)
  }

  const legacyGroups = groupsForCostVersion(groups, false)
  const [headers, ...legacyRows] = buildQuantitySummaryRows(legacyGroups, acrossGroups)
  const mixed = legacyGroups.length > 0
  const rows: SpreadsheetCell[][] = [
    [...headers, 'Price', 'Ingredient Cost', ...(mixed ? ['Cost Version'] : [])],
    ...legacyRows.map(row => [...row, '', '', 'Legacy']),
  ]
  const currentMenus = groups.flatMap(group => group.items.filter(menu => menu.costCalculationVersion === 2))
  const batches = acrossGroups ? [currentMenus] : groups.map(group => group.items.filter(menu => menu.costCalculationVersion === 2))
  for (const menus of batches) {
    const ingredients = menus.flatMap(menu => menu.ingredients ?? [])
    for (const item of aggregateStoreRequestSummary(ingredients, acrossGroups, true, true)) {
      rows.push([
        acrossGroups ? item.ingredientType ?? '' : menus[0]?.clientName ?? '',
        item.productCode, item.name, item.vendor ?? '', toSpreadsheetDecimal(item.qty),
        formatUnitLabel(item.unitOfMeasures), ...productionQuantityExportCells(item),
        toSpreadsheetDecimal(item.price), toSpreadsheetDecimal(item.ingredientCost, 'money'),
        ...(mixed ? ['2'] : []),
      ])
    }
  }
  return rows
}
