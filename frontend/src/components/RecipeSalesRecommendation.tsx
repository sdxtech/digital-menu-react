type RecipeCost = {
  portionSize?: number
  foodCostRecipe?: number
  targetFoodCostPercentage?: number | null
  ingredients?: Array<{ qty?: number; priceUom?: number; foodCost?: number }>
}

const formatPrice = (value?: number) =>
  value === undefined || !Number.isFinite(value)
    ? 'Rp. 0'
    : new Intl.NumberFormat('id-ID', {
        style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
      }).format(value)

export const getRecipeCostPerPax = (recipe: RecipeCost) => {
  let totalCost = recipe.foodCostRecipe
  if (totalCost === undefined) {
    const costs = (recipe.ingredients ?? []).map((ingredient) => {
      if (ingredient.foodCost !== undefined) return ingredient.foodCost
      if (ingredient.priceUom !== undefined && ingredient.qty !== undefined) {
        return ingredient.priceUom * ingredient.qty
      }
      return undefined
    })
    if (costs.length && costs.every((cost) => cost !== undefined && Number.isFinite(cost))) {
      totalCost = costs.reduce<number>((total, cost) => total + (cost ?? 0), 0)
    }
  }
  const pax = recipe.portionSize ?? 1
  return totalCost !== undefined && Number.isFinite(totalCost) && pax > 0
    ? totalCost / pax : undefined
}

const RecipeSalesRecommendation = ({ recipe, costPerPax, labelColSpan }: {
  recipe: RecipeCost
  costPerPax?: number
  labelColSpan?: number
}) => {
  const target = recipe.targetFoodCostPercentage
  const hasTarget = typeof target === 'number' && Number.isFinite(target) && target > 0
  const cost = costPerPax ?? getRecipeCostPerPax(recipe)
  const recommendation = hasTarget && cost !== undefined ? cost / (target / 100) : undefined

  if (labelColSpan !== undefined) {
    return (
      <>
        <tr className="border-t border-border bg-background">
          <th scope="row" colSpan={labelColSpan} className="bg-primary px-4 py-3 text-right font-semibold text-surface">
            Target food cost (%)
          </th>
          <td className="whitespace-nowrap border-l border-border px-4 py-3 font-semibold">
            {hasTarget ? `${target}%` : '0%'}
          </td>
        </tr>
        <tr className="border-t border-border bg-background">
          <th scope="row" colSpan={labelColSpan} className="bg-primary px-4 py-3 text-right font-semibold text-surface">
            Sales price/pax (recommendation)
          </th>
          <td className="whitespace-nowrap border-l border-border px-4 py-3 font-semibold">
            {formatPrice(recommendation)}
          </td>
        </tr>
      </>
    )
  }

  return (
    <div className="my-4 grid gap-3 sm:grid-cols-2">
      <div className="rounded-md border border-border bg-background p-4">
        <p className="text-xs text-muted">Target food cost (%)</p>
        <p className="mt-2 text-sm font-medium">{hasTarget ? `${target}%` : '0%'}</p>
      </div>
      <div className="rounded-md border border-border bg-background p-4">
        <p className="text-xs text-muted">Sales price/pax (recommendation)</p>
        <p className="mt-2 text-sm font-medium">{formatPrice(recommendation)}</p>
        <p className="mt-1 text-xs text-muted">Cost per pax ÷ target food cost</p>
      </div>
    </div>
  )
}

export default RecipeSalesRecommendation
