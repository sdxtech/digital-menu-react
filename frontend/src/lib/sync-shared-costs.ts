import { apiFetch } from './api'

type RecipeSyncResult = {
  updatedRecipes: number
}

type ProductionDraftSyncResult = {
  updatedDrafts: number
}

export const syncSharedCosts = async (accessToken: string) => {
  const recipes = await apiFetch<RecipeSyncResult>(
    '/recipes/ingredient-costs/backfill',
    { method: 'PATCH' },
    accessToken,
  )
  let productions: ProductionDraftSyncResult
  try {
    productions = await apiFetch<ProductionDraftSyncResult>(
      '/menu-productions/drafts/sync-costs',
      { method: 'PATCH' },
      accessToken,
    )
  } catch {
    throw new Error('Recipe costs were updated, but production draft costs could not be synced. Retry Sync Cost.')
  }
  return {
    updatedRecipes: recipes.updatedRecipes,
    updatedDrafts: productions.updatedDrafts,
  }
}
