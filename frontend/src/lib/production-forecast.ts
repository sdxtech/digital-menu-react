export type ForecastRow = {
  id: string
  group: string
  recipeId: string
  recipeCode: string
  menu: string
  category: string
  portion: number | ''
  costPerPax: number | null
}

export type ForecastDrafts = Record<string, ForecastRow[]>

export const forecastDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

export const shiftForecastDate = (date: string, days: number) => {
  const next = new Date(`${date}T12:00:00`)
  next.setDate(next.getDate() + days)
  return forecastDate(next)
}

export const forecastKey = (site: string, client: string, date: string) =>
  JSON.stringify([site, client, date])

export const createForecastRow = (): ForecastRow => ({
  id: crypto.randomUUID(), group: '', recipeId: '', recipeCode: '',
  menu: '', category: '', portion: '', costPerPax: null,
})

type CostRecipe = {
  portionSize: number
  ingredients: Array<{ qty: number; priceUom?: number; foodCost?: number }>
}

// Forecasts use the recipe's saved ingredient prices, divided by its base portions.
export const forecastRecipeCostPerPax = (recipe: CostRecipe): number | null => {
  if (!Number.isFinite(recipe.portionSize) || recipe.portionSize <= 0 || !recipe.ingredients.length) return null
  let total = 0
  for (const ingredient of recipe.ingredients) {
    if (!Number.isFinite(ingredient.qty) || ingredient.qty < 0) return null
    if (ingredient.qty === 0) continue
    const cost = ingredient.priceUom !== undefined
      ? ingredient.qty * ingredient.priceUom
      : ingredient.foodCost
    if (cost === undefined || !Number.isFinite(cost) || cost < 0) return null
    total += cost
  }
  const perPax = total / recipe.portionSize
  return Number.isFinite(perPax) ? perPax : null
}

export const forecastIngredientAmounts = (
  ingredient: CostRecipe['ingredients'][number],
  basePortions: number,
  portion: number | '',
) => {
  const targetPortions = portion === '' ? basePortions : portion
  if (!Number.isFinite(basePortions) || basePortions <= 0 ||
    !Number.isFinite(targetPortions) || targetPortions <= 0 ||
    !Number.isFinite(ingredient.qty) || ingredient.qty < 0) {
    return { qty: null, cost: null }
  }
  const qty = ingredient.qty * targetPortions / basePortions
  const costPerPax = forecastRecipeCostPerPax({ portionSize: basePortions, ingredients: [ingredient] })
  const cost = costPerPax === null ? null : costPerPax * targetPortions
  return {
    qty: Number.isFinite(qty) ? qty : null,
    cost: cost !== null && Number.isFinite(cost) ? cost : null,
  }
}

export const forecastRowCost = (row: ForecastRow): number | null => {
  if (!row.recipeId || row.portion === '' || row.portion <= 0 || row.costPerPax === null) return null
  const cost = row.portion * row.costPerPax
  return Number.isFinite(cost) ? cost : null
}

export const parseForecastDrafts = (value: string | null): ForecastDrafts => {
  if (!value) return {}
  const parsed: unknown = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid forecast draft.')
  for (const [key, rows] of Object.entries(parsed)) {
    const scope: unknown = JSON.parse(key)
    if (!Array.isArray(scope) || scope.length !== 3 || !scope.every((part) => typeof part === 'string') ||
      !/^\d{4}-\d{2}-\d{2}$/.test(scope[2]) || !Array.isArray(rows)) throw new Error('Invalid forecast draft.')
    for (const row of rows) {
      if (!row || typeof row !== 'object' ||
        !['id', 'group', 'recipeId', 'recipeCode', 'menu', 'category'].every((field) => typeof row[field] === 'string') ||
        !(row.portion === '' || (typeof row.portion === 'number' && Number.isFinite(row.portion) && row.portion > 0)) ||
        !(row.costPerPax === null || (typeof row.costPerPax === 'number' && Number.isFinite(row.costPerPax) && row.costPerPax >= 0))) {
        throw new Error('Invalid forecast draft.')
      }
    }
  }
  return parsed as ForecastDrafts
}
