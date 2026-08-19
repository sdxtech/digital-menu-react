export type StoreRequestSummaryIngredient = {
  productCode: string
  name: string
  unitOfMeasures: string
  qty: number
  vendor?: string
  vendorSite?: string
  price?: number
  ingredientCost?: number
  plannedIngredientCost?: number
}

type AggregateStoreRequestSummaryOptions = {
  splitByVendor?: boolean
}

type StoreRequestSummaryGroup = {
  items?: Array<{
    ingredients?: StoreRequestSummaryIngredient[]
  }>
  summary?: StoreRequestSummaryIngredient[]
}

export const aggregateStoreRequestSummary = (
  items: StoreRequestSummaryIngredient[] = [],
  options: AggregateStoreRequestSummaryOptions = {},
): StoreRequestSummaryIngredient[] => {
  const summaryMap = new Map<string, StoreRequestSummaryIngredient>()

  items.forEach((item) => {
    const productCode = String(item.productCode ?? '').trim()
    const name = String(item.name ?? '').trim()
    const unitOfMeasures = String(item.unitOfMeasures ?? '').trim()
    const vendor = String(item.vendor ?? '').trim()
    const vendorSite = String(item.vendorSite ?? '').trim()
    const identity = (productCode || name).toLowerCase()
    const normalizedUnit = unitOfMeasures.toLowerCase()
    if (!identity || !normalizedUnit) return

    // Keep this identity in sync with the backend store-request key. A product
    // can legitimately be requested in more than one unit of measure.
    const keyBase = `${identity}__${normalizedUnit}`
    const key = options.splitByVendor
      ? `${keyBase}__${vendor.toLowerCase()}__${vendorSite.toLowerCase()}`
      : keyBase

    const qty = Number.isFinite(Number(item.qty)) ? Number(item.qty) : 0
    const existing = summaryMap.get(key)
    if (existing) {
      existing.qty += qty
      if (Number.isFinite(Number(item.ingredientCost))) {
        existing.ingredientCost =
          (existing.ingredientCost ?? 0) + Number(item.ingredientCost)
      }
      if (Number.isFinite(Number(item.plannedIngredientCost))) {
        existing.plannedIngredientCost =
          (existing.plannedIngredientCost ?? 0) +
          Number(item.plannedIngredientCost)
      }
      if (!options.splitByVendor && (existing.vendor ?? '') !== vendor) {
        existing.vendor = existing.vendor ? 'Multiple' : vendor || undefined
      }
      if (!options.splitByVendor && existing.vendorSite !== item.vendorSite) {
        existing.vendorSite = undefined
      }
      if (existing.price !== item.price) {
        existing.price = undefined
      }
      if (!existing.productCode && productCode) existing.productCode = productCode
      if (!existing.name && name) existing.name = name
      if (!existing.unitOfMeasures && unitOfMeasures) {
        existing.unitOfMeasures = unitOfMeasures
      }
      return
    }

    summaryMap.set(key, {
      productCode,
      name,
      unitOfMeasures,
      qty,
      vendor: vendor || undefined,
      vendorSite: item.vendorSite,
      price: Number.isFinite(Number(item.price)) ? Number(item.price) : undefined,
      ingredientCost: Number.isFinite(Number(item.ingredientCost))
        ? Number(item.ingredientCost)
        : undefined,
      plannedIngredientCost: Number.isFinite(Number(item.plannedIngredientCost))
        ? Number(item.plannedIngredientCost)
        : Number.isFinite(Number(item.ingredientCost))
          ? Number(item.ingredientCost)
          : undefined,
    })
  })

  return Array.from(summaryMap.values())
}

export const aggregateStoreRequestSummaryByVendor = (
  group: StoreRequestSummaryGroup,
) => {
  const ingredientRows =
    group.items?.flatMap((item) => item.ingredients ?? []) ?? []
  const sourceItems = ingredientRows.length ? ingredientRows : group.summary ?? []

  return aggregateStoreRequestSummary(sourceItems, { splitByVendor: true })
}
