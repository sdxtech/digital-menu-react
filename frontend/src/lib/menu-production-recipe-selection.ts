type RecipeSelection = {
  recipeId: string
  pricingRecipeId: string
  recipeQuery: string
}

export const updateMenuRecipeSelection = <T extends RecipeSelection>(
  row: T,
  recipeId: string,
  recipeQuery: string,
) => ({
  row: {
    ...row,
    recipeId,
    recipeQuery,
    // Keep the pricing identity while the user types an incomplete search.
    pricingRecipeId: recipeId || row.pricingRecipeId,
  },
  resetIngredientSelections: Boolean(recipeId && recipeId !== row.pricingRecipeId),
})

export const clearRowIngredientSelections = (
  selections: Record<string, string>,
  rowId: string,
) => Object.fromEntries(
  Object.entries(selections).filter(([key]) => !key.startsWith(`${rowId}::`)),
)
