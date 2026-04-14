export type StoreRequestSummaryIngredient = {
  productCode: string
  name: string
  unitOfMeasures: string
  qty: number
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
    })
  })

  return Array.from(summaryMap.values())
}
