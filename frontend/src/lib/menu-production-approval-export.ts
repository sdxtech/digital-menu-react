import { formatCreatedDate } from './date-format'
import { formatFoodCostPercentage } from './food-cost'
import { formatQuantity } from './quantity'
import { formatRecipeVersion } from './recipe-version'
import {
  aggregateStoreRequestSummaryByVendor,
  type StoreRequestSummaryIngredient,
} from './store-request-summary'
import { getApprovalStatusLabel, getStoreRequestStatusLabel } from './status-labels'
import { formatUnitLabel } from './unit-of-measures'
import {
  downloadSpreadsheet,
  toSpreadsheetDate,
  toSpreadsheetDecimal,
  type SpreadsheetCell,
  type SpreadsheetSheet,
} from './spreadsheet-export'

type MenuProductionApprovalExportMenu = {
  estimatedCost?: number
  sellingPricePerPax?: number
  sellingQuantity?: number
  estimatedRevenue?: number
  productionCode?: string
  submittedByName?: string
  submittedAt?: string
  recipeId?: string
  recipeCode?: string
  recipeVersion?: number
  menuName: string
  clientName?: string
  category: string
  group?: string
  portion: number
  salesInputBy?: string
  reviewedBy?: string
  fulfilledBy?: string
  cancelledBy?: string
  salesRejectionReason?: string
  productionDate: string
  approvalStatus: 'pending' | 'approved' | 'rejected'
  storeRequestStatus: 'not-requested' | 'requested' | 'fulfilled' | 'cancelled'
  ingredients: StoreRequestSummaryIngredient[]
}

type MenuProductionApprovalExportGroup = {
  date: string
  productionCode?: string
  items: MenuProductionApprovalExportMenu[]
  summary: StoreRequestSummaryIngredient[]
}

export const buildMenuProductionFinancialRows = (
  items: Array<{
    estimatedCost?: number
    sellingPricePerPax?: number
    sellingQuantity?: number
    estimatedRevenue?: number
  }>,
): SpreadsheetCell[][] => {
  const totalEstimatedCost = items.reduce(
    (total, item) => total + (Number.isFinite(Number(item.estimatedCost))
      ? Number(item.estimatedCost) : 0),
    0,
  )
  const firstMenu = items[0]
  const sellingPrice = Number(firstMenu?.sellingPricePerPax)
  const sellingQuantity = Number(firstMenu?.sellingQuantity)
  const estimatedRevenue = Number.isFinite(sellingPrice) && Number.isFinite(sellingQuantity)
    ? sellingPrice * sellingQuantity
    : firstMenu?.estimatedRevenue

  return [
    ['Total Estimated Food Cost', toSpreadsheetDecimal(totalEstimatedCost, 'integer')],
    ['Total Pax Calculation', toSpreadsheetDecimal(sellingQuantity)],
    ['Food Cost Percentage', formatFoodCostPercentage(totalEstimatedCost, estimatedRevenue)],
    ['Selling Price', toSpreadsheetDecimal(sellingPrice)],
    ['Estimated Revenue', toSpreadsheetDecimal(estimatedRevenue)],
  ]
}

const getGroupSubmittedAt = (group: MenuProductionApprovalExportGroup) =>
  group.items.find((item) => item.submittedAt)?.submittedAt

const getBatchStatus = (items: MenuProductionApprovalExportMenu[]) => {
  if (items.some((item) => item.salesRejectionReason)) return 'Returned to Admin Sales'
  if (items.some((item) => item.storeRequestStatus === 'cancelled')) return 'Cancelled'
  if (items.some((item) => item.storeRequestStatus === 'fulfilled')) return 'Completed'
  if (items.some((item) => item.approvalStatus === 'rejected')) return 'Returned to Chef'
  if (items.some((item) => item.storeRequestStatus === 'requested')) return 'Waiting for Storekeeper'
  return items[0]?.salesInputBy?.trim() ? 'Waiting for Approval' : 'Waiting for Sales Input'
}

export const buildMenuProductionApprovalSheets = (group: MenuProductionApprovalExportGroup): SpreadsheetSheet[] => {
  const rows: SpreadsheetCell[][] = [
    [
      'No',
      'Created Date',
      'Production Date',
      'Client Name',
      'Production Code',
      'Group By',
      'Menu Name',
      'Version',
      'Recipe Code',
      'Category',
      'Portion',
      'Product Type',
      'Product Code',
      'Ingredient Name',
      'Vendor',
      'QTY',
      'Unit',
      'Price',
      'Ingredient Cost',
    ],
  ]

  let rowNumber = 1
  group.items.forEach((menu) => {
    const ingredients = menu.ingredients ?? []
    if (ingredients.length === 0) {
      rows.push([
        rowNumber,
        formatCreatedDate(menu.submittedAt),
        toSpreadsheetDate(group.date),
        menu.clientName ?? '',
        group.productionCode ?? '',
        menu.group ?? '',
        menu.menuName,
        formatRecipeVersion(menu.recipeVersion),
        menu.recipeCode ?? menu.recipeId ?? '',
        menu.category,
        menu.portion,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
      ])
      rowNumber += 1
      return
    }

    ingredients.forEach((ingredient) => {
      rows.push([
        rowNumber,
        formatCreatedDate(menu.submittedAt),
        toSpreadsheetDate(menu.productionDate ?? group.date),
        menu.clientName ?? '',
        menu.productionCode ?? group.productionCode ?? '',
        menu.group ?? '',
        menu.menuName,
        formatRecipeVersion(menu.recipeVersion),
        menu.recipeCode ?? menu.recipeId ?? '',
        menu.category,
        menu.portion,
        ingredient.ingredientType ?? '',
        ingredient.productCode,
        ingredient.name,
        ingredient.vendor ?? '',
        toSpreadsheetDecimal(formatQuantity(ingredient.qty)),
        formatUnitLabel(ingredient.unitOfMeasures),
        toSpreadsheetDecimal(ingredient.price),
        Number.isFinite(ingredient.ingredientCost) ? ingredient.ingredientCost : '',
      ])
      rowNumber += 1
    })
  })

  const summaryRows: SpreadsheetCell[][] = [
    ['Client Name', 'Product Type', 'Product Code', 'Ingredient Name', 'Vendor', 'QTY', 'Unit', 'Price', 'Ingredient Cost'],
    ...aggregateStoreRequestSummaryByVendor(group).map((item) => [
      group.items[0]?.clientName ?? '',
      item.ingredientType ?? '',
      item.productCode,
      item.name,
      item.vendor ?? '',
      toSpreadsheetDecimal(formatQuantity(item.qty)),
      formatUnitLabel(item.unitOfMeasures),
      toSpreadsheetDecimal(item.price),
      Number.isFinite(item.ingredientCost) ? item.ingredientCost : '',
    ]),
  ]

  const firstMenu = group.items[0]
  const submittedBy = Array.from(new Set(
    group.items.map((item) => item.submittedByName?.trim()).filter(Boolean),
  )).join(', ')
  const informationRows: SpreadsheetCell[][] = [
    ['Field', 'Value'],
    ['Production code', group.productionCode || '-'],
    ['Batch status', getBatchStatus(group.items)],
    ['Created date', formatCreatedDate(getGroupSubmittedAt(group))],
    ['Production date', toSpreadsheetDate(group.date)],
    ['Submitted by', submittedBy || '-'],
    ['Client', firstMenu?.clientName || '-'],
    ['Admin', firstMenu?.salesInputBy?.trim() || '-'],
    ['Total menu', group.items.length],
    ['Reviewed by', Array.from(new Set(
      group.items.map((item) => item.reviewedBy?.trim()).filter(Boolean),
    )).join(', ') || '-'],
    ['Approval status', Array.from(new Set(
      group.items.map((item) => getApprovalStatusLabel(item.approvalStatus)),
    )).join(', ') || '-'],
    ['Storekeeper', Array.from(new Set(
      group.items.map((item) => item.fulfilledBy?.trim() || item.cancelledBy?.trim()).filter(Boolean),
    )).join(', ') || '-'],
    ['Store request status', Array.from(new Set(
      group.items.map((item) => getStoreRequestStatusLabel(item.storeRequestStatus)),
    )).join(', ') || '-'],
    ...buildMenuProductionFinancialRows(group.items),
  ]

  return [
    { name: 'Menu Production Information', rows: informationRows },
    { name: 'Store Request Detail', rows },
    { name: 'Ingredient Summary', rows: summaryRows },
  ]
}

export const downloadMenuProductionApproval = (group: MenuProductionApprovalExportGroup) => {
  const safeDate = group.date.replace(/[\\/:*?"<>|]/g, '-')
  const safeProductionCode = (group.productionCode ?? 'no-code').replace(
    /[\\/:*?"<>|]/g,
    '-',
  )
  return downloadSpreadsheet(`menu-production-${safeDate}-${safeProductionCode}.xlsx`, buildMenuProductionApprovalSheets(group))
}

