export const calculateFoodCostPercentage = (
  estimatedCost?: number,
  estimatedRevenue?: number,
) => {
  const cost = Number(estimatedCost)
  const revenue = Number(estimatedRevenue)

  if (!Number.isFinite(cost) || !Number.isFinite(revenue) || revenue <= 0) {
    return undefined
  }

  return (cost / revenue) * 100
}

export const formatFoodCostPercentage = (
  estimatedCost?: number,
  estimatedRevenue?: number,
) => {
  const percentage = calculateFoodCostPercentage(
    estimatedCost,
    estimatedRevenue,
  )
  return percentage === undefined ? '-' : `${percentage.toFixed(2)}%`
}
