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

export const aggregateStoreRequestSummary = (
  items: StoreRequestSummaryIngredient[] = [],
): StoreRequestSummaryIngredient[] => {
  const summaryMap = new Map<string, StoreRequestSummaryIngredient>()

  items.forEach((item) => {
    const productCode = String(item.productCode ?? '').trim()
    const name = String(item.name ?? '').trim()
    const unitOfMeasures = String(item.unitOfMeasures ?? '').trim()
    const key = productCode || `${name}__${unitOfMeasures}`
    if (!key) return

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
      if (existing.vendor !== item.vendor) {
        existing.vendor = existing.vendor ? 'Multiple' : item.vendor
      }
      if (existing.vendorSite !== item.vendorSite) {
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
      vendor: item.vendor,
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
