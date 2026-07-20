type VersionedRecipe = {
  name: string
  version?: number
}

export const getRecipeVersion = (version?: number) => {
  const parsed = Number(version)
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1
}

export const formatRecipeVersion = (version?: number) =>
  `V${getRecipeVersion(version)}`

export const formatVersionedRecipeName = (recipe: VersionedRecipe) =>
  `${recipe.name} (${formatRecipeVersion(recipe.version)})`
