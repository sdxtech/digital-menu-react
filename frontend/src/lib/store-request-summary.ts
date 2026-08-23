export type StoreRequestSummaryIngredient = {
  ingredientType?: 'IT' | 'NMP'
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

type StoreRequestSummaryGroup = {
  items?: Array<{
    ingredients?: StoreRequestSummaryIngredient[]
  }>
  summary?: StoreRequestSummaryIngredient[]
}

export const aggregateStoreRequestSummary = (
  items: StoreRequestSummaryIngredient[] = [],
): StoreRequestSummaryIngredient[] => {
  const summaryMap = new Map<string, StoreRequestSummaryIngredient>()
  const nonSummarizedItems: StoreRequestSummaryIngredient[] = []

  items.forEach((item) => {
    // NMP rows must stay separate even when they share the NMP product code.
    // Older IT recipes may not have ingredientType, so infer it from the IT
    // product-code prefix when needed.
    const productCode = String(item.productCode ?? '').trim()
    const isNmpProductCode = productCode.toUpperCase() === 'NMP'
    const isItIngredient =
      item.ingredientType === 'IT' ||
      (!item.ingredientType && productCode.toUpperCase().startsWith('IT'))
    if (
      !isItIngredient ||
      isNmpProductCode
    ) {
      nonSummarizedItems.push({ ...item })
      return
    }

    const name = String(item.name ?? '').trim()
    const unitOfMeasures = String(item.unitOfMeasures ?? '').trim()
    const vendor = String(item.vendor ?? '').trim()
    const identity = (productCode || name).toLowerCase()
    const normalizedUnit = unitOfMeasures.toLowerCase()
    if (!identity || !normalizedUnit) return

    // Recipe ingredients are already site-scoped. Summaries therefore group
    // by IT identity, UOM, and vendor; vendorSite must not split equal vendors.
    const keyBase = `${identity}__${normalizedUnit}`
    const key = `${keyBase}__${vendor.toLowerCase()}`

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
      if ((existing.vendor ?? '') !== vendor) {
        existing.vendor = existing.vendor ? 'Multiple' : vendor || undefined
      }
      if (existing.vendorSite !== item.vendorSite) {
        existing.vendorSite = undefined
      }
      if (existing.price !== item.price) {
        existing.price = undefined
      }
      if (!existing.productCode && productCode) existing.productCode = productCode
      if (!existing.name && name) existing.name = name
      if (!existing.ingredientType && item.ingredientType) {
        existing.ingredientType = item.ingredientType
      }
      if (!existing.unitOfMeasures && unitOfMeasures) {
        existing.unitOfMeasures = unitOfMeasures
      }
      return
    }

    summaryMap.set(key, {
      ingredientType: isItIngredient ? 'IT' : item.ingredientType,
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

  return [...Array.from(summaryMap.values()), ...nonSummarizedItems]
}

export const aggregateStoreRequestSummaryByVendor = (
  group: StoreRequestSummaryGroup,
) => {
  const ingredientRows =
    group.items?.flatMap((item) => item.ingredients ?? []) ?? []
  const sourceItems = ingredientRows.length ? ingredientRows : group.summary ?? []

  return aggregateStoreRequestSummary(sourceItems)
}
