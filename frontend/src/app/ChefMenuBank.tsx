import PageHeading from '../components/PageHeading'
import RecipeDetailOverview, { formatRecipeDetailPrice } from '../components/RecipeDetailOverview'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import RecipeFilters from '../components/RecipeFilters'
import { RecipeExportToolbar, RecipeExportDialog, RecipeExportCheckbox } from '../components/RecipeExportControls'
import { useRecipeExportSelection } from '../lib/use-recipe-export-selection'
import { useRecipeSiteOptions } from '../lib/use-recipe-site-options'
import { RecipeStatusBadge, RecipeApprovalStatusBadge } from '../components/RecipeStatusBadge'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'
import { formatRecipeVersion } from '../lib/recipe-version'
import { formatUnitLabel } from '../lib/unit-of-measures'
import { useRecipeIngredientVendors } from '../lib/use-recipe-ingredient-vendors'

const ITEMS_PER_PAGE = 10
const RECIPE_NOTIFICATION_COMPONENT_KEY = 'RECIPE_DATA_BANK'

type RecipeIngredient = {
  vendor?: string
  priceSourceSite?: string
  priceSourceSiteName?: string
  priceUom?: number
  foodCost?: number
  ingredientType?: 'IT' | 'NMP'
  productCode: string
  name: string
  unitOfMeasures: string
  qty: number
}

type Recipe = {
  cookingMethod?: string[]
  targetFoodCostPercentage?: number
  foodCostRecipe?: number
  id?: string
  _id?: string
  recipeCode?: string
  version?: number
  versionGroupId?: string
  parentRecipeId?: string
  name: string
  category: string
  site?: string
  siteName?: string
  description?: string
  createdAt?: string
  updatedAt?: string
  createdBy?: string
  createdByName?: string
  createdByEmail?: string
  updatedBy?: string
  updatedByName?: string
  updatedByEmail?: string
  price: number
  portionSize: number
  status: 'draft' | 'active'
  isActive?: boolean
  approvalStatus: 'pending' | 'approved' | 'rejected'
  reviewedBy?: string
  reviewedByName?: string
  reviewedByEmail?: string
  reviewedAt?: string
  rejectionReason?: string
  approvalHistory?: Array<{
    rejectionReason: string
    rejectedByName?: string
    rejectedAt?: string
    resubmissionFeedback?: string
    resubmittedByName?: string
    resubmittedAt?: string
  }>
  ingredients: RecipeIngredient[]
}

const formatActorLabel = (name?: string) => {
  if (name) return name
  return 'Unknown'
}

const formatRecipeSite = (recipe: Recipe) =>
  recipe.siteName?.trim() || recipe.site?.trim() || 'All sites'

const formatTimestamp = (value?: string) => {
  if (!value) return 'Unknown'
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return 'Unknown'
  return parsed.toLocaleString('en-GB')
}

const hasTextValue = (value?: string | null) => Boolean(value?.trim())

const hasQtyValue = (value?: number | null) =>
  value !== null &&
  value !== undefined &&
  `${value}`.trim() !== '' &&
  Number.isFinite(Number(value))

const getMissingIngredientFields = (ingredient: RecipeIngredient) => {
  const missingFields: string[] = []

  if (!hasTextValue(ingredient.productCode)) {
    missingFields.push('product code')
  }

  if (!hasTextValue(ingredient.name)) {
    missingFields.push('ingredient name')
  }

  if (!hasQtyValue(ingredient.qty)) {
    missingFields.push('qty')
  }

  if (!hasTextValue(ingredient.unitOfMeasures)) {
    missingFields.push('unit')
  }

  return missingFields
}

const getRecipeId = (recipe: Recipe) => recipe.id ?? recipe._id ?? ''

const ChefMenuBank = () => {
  const { user, accessToken } = useAuth()
  const { sites: recipeSites, error: siteError } = useRecipeSiteOptions(accessToken)
  const [siteFilter, setSiteFilter] = useState('')
  const rawRole = user?.roles?.[0] || user?.role || ''
  const cleanRole = rawRole.startsWith('/') ? rawRole.slice(1) : rawRole
  const targetUserRole = cleanRole === 'unit-manager' ? 'unit.manager' : cleanRole
  const siteCode = user?.site || 'global'
  const [unreadRecipeIds, setUnreadRecipeIds] = useState<string[]>([])
  
  useEffect(() => {
    const fetchActiveNotifications = async () => {
      if (!accessToken) return
      try {
        const data = await apiFetch<
          Array<{
            read?: boolean
            componentKey?: string
            payload?: { recipeId?: string; id?: string }
          }>
        >(
          `/notifications/role-unread?siteCode=${encodeURIComponent(siteCode)}&targetUserRole=${encodeURIComponent(targetUserRole)}&componentKey=${RECIPE_NOTIFICATION_COMPONENT_KEY}`,
          undefined,
          accessToken,
        )
        if (Array.isArray(data)) {
          const unreadRecipeNotifications = data.filter(
            (n) => !n.read && n.componentKey === RECIPE_NOTIFICATION_COMPONENT_KEY,
          )
          const ids = unreadRecipeNotifications
            .map((n) => n.payload?.recipeId || n.payload?.id)
            .filter((value): value is string => Boolean(value))
          setUnreadRecipeIds(ids)

          if (unreadRecipeNotifications.length > 0) {
            await apiFetch(
              '/notifications/mark-role-read',
              {
                method: 'PATCH',
                body: JSON.stringify({
                  siteCode,
                  targetUserRole,
                  componentKey: RECIPE_NOTIFICATION_COMPONENT_KEY,
                }),
              },
              accessToken,
            )
            window.dispatchEvent(new Event('refresh-notifications'))
          }
        }
      } catch (err) {
        console.error('Failed to load active notifications for highlights:', err)
      }
    }
    fetchActiveNotifications()
  }, [accessToken, siteCode, targetUserRole])
  const navigate = useNavigate()
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [searchInput, setSearchInput] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilters, setStatusFilters] = useState<Array<'draft' | 'active'>>(
    [],
  )
  const [approvalFilter, setApprovalFilter] = useState<
    '' | 'pending' | 'approved' | 'rejected'
  >('')
  const [categoryFilters, setCategoryFilters] = useState<string[]>([])
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalItems, setTotalItems] = useState(0)
  const [loading, setLoading] = useState(false)
  const recipeExport = useRecipeExportSelection(accessToken, user?.id ?? user?.email, { loading })
  const [error, setError] = useState('')

  // FRONTEND VIEW: fetch filter categories from backend.
  const fetchCategories = useCallback(async () => {
    if (!accessToken) return
    try {
      const data = await apiFetch<string[]>(
        '/recipes/categories',
        undefined,
        accessToken,
      )
      setCategories(data ?? [])
    } catch {
      // keep categories empty on failure
    }
  }, [accessToken])

  // FRONTEND VIEW: fetch recipes with server-side filters/pagination.
  const fetchRecipes = useCallback(async () => {
    if (!accessToken) return
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('limit', String(ITEMS_PER_PAGE))
      if (siteFilter) params.set('siteFilter', siteFilter)
      if (searchTerm.trim()) params.set('search', searchTerm.trim())
      if (statusFilters.length) {
        params.set('statuses', statusFilters.join(','))
      }
      if (categoryFilters.length) {
        params.set('categories', categoryFilters.join(','))
      }
      if (approvalFilter) {
        params.set('approvalStatus', approvalFilter)
      }

      const data = await apiFetch<{
        items: Recipe[]
        total: number
        page: number
        limit: number
        totalPages?: number
      }>(`/recipes?${params.toString()}`, undefined, accessToken)

      setRecipes(data.items ?? [])
      setTotalItems(data.total ?? 0)
      setTotalPages(data.totalPages ?? Math.max(1, Math.ceil((data.total ?? 0) / ITEMS_PER_PAGE)))
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load recipes.'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [accessToken, page, searchTerm, statusFilters, categoryFilters, approvalFilter, siteFilter])

  useEffect(() => {
    fetchCategories().catch(() => null)
  }, [fetchCategories])

  useEffect(() => {
    fetchRecipes().catch(() => null)
  }, [fetchRecipes])

  useEffect(() => {
    setPage(1)
  }, [searchTerm, statusFilters, categoryFilters, approvalFilter, siteFilter])

  const selectedRecipe =
    selectedRecipeId === null
      ? null
      : recipes.find((item) => (item.id ?? item._id) === selectedRecipeId) ?? null
  const createdByLabel = selectedRecipe
    ? formatActorLabel(selectedRecipe.createdByName)
    : 'Unknown'
  const updatedByLabel = selectedRecipe
    ? formatActorLabel(
        selectedRecipe.updatedByName ?? selectedRecipe.createdByName,
      )
    : 'Unknown'
  const createdAtLabel = selectedRecipe
    ? formatTimestamp(selectedRecipe.createdAt)
    : 'Unknown'
  const updatedAtLabel = selectedRecipe
    ? formatTimestamp(selectedRecipe.updatedAt ?? selectedRecipe.createdAt)
    : 'Unknown'
  const reviewedByLabel = selectedRecipe
    ? formatActorLabel(
        selectedRecipe.reviewedByName ||
          selectedRecipe.reviewedByEmail ||
          selectedRecipe.reviewedBy,
      )
    : 'Unknown'
  const reviewedAtLabel = selectedRecipe
    ? formatTimestamp(selectedRecipe.reviewedAt)
    : 'Unknown'
  const selectedRecipeIngredients = selectedRecipe?.ingredients ?? []
  const ingredientVendors = useRecipeIngredientVendors(selectedRecipe, accessToken)
  const selectedRecipeIngredientRows = selectedRecipeIngredients.map((ingredient) => ({
    ingredient,
    missingFields: getMissingIngredientFields(ingredient),
  }))
  const canEditSelectedRecipe =
    selectedRecipe?.approvalStatus === 'rejected'
  const canCreateFromSelectedRecipe =
    selectedRecipe?.approvalStatus === 'approved'

  const buildRecipeTemplate = (recipe: Recipe) => ({
    recipeCode: recipe.recipeCode,
    version: recipe.version,
    name: recipe.name,
    category: recipe.category,
    description: recipe.description ?? '',
    cookingMethod: recipe.cookingMethod ?? [],
    portionSize: recipe.portionSize,
    targetFoodCostPercentage: recipe.targetFoodCostPercentage,
    ingredients: recipe.ingredients ?? [],
  })

  const handleCreateNewVersion = (recipe: Recipe) => {
    if (recipe.approvalStatus !== 'approved') return

    navigate('/chef/menu-create', {
      state: {
        baseRecipe: {
          ...buildRecipeTemplate(recipe),
          sourceRecipeId: getRecipeId(recipe),
        },
      },
    })
  }

  const handleUseAsTemplate = (recipe: Recipe) => {
    if (recipe.approvalStatus !== 'approved') return

    navigate('/chef/menu-create', {
      state: {
        baseRecipe: buildRecipeTemplate(recipe),
      },
    })
  }

  const handleEditRecipe = (recipe: Recipe) => {
    if (recipe.approvalStatus !== 'rejected') return

    const recipeId = getRecipeId(recipe)
    if (!recipeId) return

    navigate('/chef/menu-create', {
      state: {
        baseRecipe: {
          id: recipeId,
          name: recipe.name,
          category: recipe.category,
          description: recipe.description ?? '',
          cookingMethod: recipe.cookingMethod ?? [],
          portionSize: recipe.portionSize,
          targetFoodCostPercentage: recipe.targetFoodCostPercentage,
          approvalStatus: recipe.approvalStatus,
          rejectionReason: recipe.rejectionReason ?? '',
          approvalHistory: recipe.approvalHistory ?? [],
          reviewedByName: recipe.reviewedByName ?? '',
          reviewedByEmail: recipe.reviewedByEmail ?? '',
          reviewedBy: recipe.reviewedBy ?? '',
          ingredients: recipe.ingredients ?? [],
        },
      },
    })
  }

  return (
    <div className="space-y-6">
      <RecipeExportDialog exportState={recipeExport} />
      <div className="space-y-2">
        <div>
          <PageHeading className="text-2xl font-semibold">Recipe Data</PageHeading>
        </div>

        <div className="rounded-md border border-border bg-surface shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div className="min-w-0 flex-1">
              <RecipeFilters
                sites={recipeSites}
                selectedSite={siteFilter}
                onSiteChange={(site) => {
                  setSiteFilter(site)
                  setPage(1)
                  setSelectedRecipeId(null)
                }}
                siteError={siteError}
                searchTerm={searchInput}
                onSearchChange={setSearchInput}
                onSearch={() => {
                  setSearchTerm(searchInput.trim())
                  setPage(1)
                }}
                statuses={statusFilters}
                approvalStatus={approvalFilter}
                categories={categories}
                selectedCategories={categoryFilters}
                onStatusesChange={setStatusFilters}
                onApprovalStatusChange={setApprovalFilter}
                onCategoriesChange={setCategoryFilters}
              />
            </div>
            <RecipeExportToolbar exportState={recipeExport} variant="primary" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-t-md border-b border-border bg-white px-5 py-4 text-xs">
            <span className="text-muted">
              Showing {recipes.length} of {totalItems} recipes
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={page === 1 || loading}
                className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                Prev
              </button>
              <span className="text-xs font-semibold text-foreground">
                Page {page} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={page === totalPages || loading}
                className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                Next
              </button>
            </div>
          </div>
          <div className="max-w-full overflow-x-auto">
            <table className="dm-table min-w-full text-sm">
              <thead className="bg-background">
                <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                  <th className="w-12 px-5 py-4"><RecipeExportCheckbox exportState={recipeExport} /></th>
                  <th className="w-16 px-5 py-4 font-semibold">No</th>
                  <th className="px-5 py-4 font-semibold">Recipe ID</th>
                  <th className="px-5 py-4 font-semibold">Name</th>
                  <th className="px-5 py-4 font-semibold">Version</th>
                  <th className="px-5 py-4 font-semibold">Category</th>
                  <th className="px-5 py-4 font-semibold">Site</th>
                  <th className="px-5 py-4 font-semibold">Recipe status</th>
                  <th className="px-5 py-4 font-semibold">Approval status</th>
                  <th className="px-5 py-4 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr className="border-t border-border">
                    <td colSpan={10} className="px-5 py-10 text-center text-muted">
                      Loading recipes...
                    </td>
                  </tr>
                ) : recipes.length === 0 ? (
                  <tr className="border-t border-border">
                    <td colSpan={10} className="px-5 py-10 text-center text-muted">
                      {error ? error : 'No recipes yet.'}
                    </td>
                  </tr>
                ) : (
                  recipes.map((recipe, index) => {
                    const recipeKey = recipe.id ?? recipe._id ?? null
                    const isSelected = selectedRecipeId === recipeKey
                    const isNewItem = recipeKey ? unreadRecipeIds.includes(recipeKey) : false;

                    return (
                      <tr
                        key={recipe.id ?? recipe._id}
                        // 🌟 INJECTED: Added dynamic flash highlighting styling class rules
                        className={`border-t border-border transition-all duration-700 ${
                          isNewItem 
                            ? 'bg-yellow-100/80 dark:bg-yellow-900/20 animate-pulse' 
                            : 'hover:bg-slate-50/50'
                        }`}
                      >
                        <td className="px-5 py-4"><RecipeExportCheckbox exportState={recipeExport} id={recipeKey ?? ''} name={recipe.name} /></td>
                        <td className="px-5 py-4 text-sm text-muted">
                          {(page - 1) * ITEMS_PER_PAGE + index + 1}
                        </td>
                        <td className="px-5 py-4 font-medium">
                          {recipe.recipeCode ?? '-'}
                        </td>
                        <td className="px-5 py-4">{recipe.name}</td>
                        <td className="px-5 py-4 font-semibold text-foreground">
                          {formatRecipeVersion(recipe.version)}
                        </td>
                        <td className="px-5 py-4">{recipe.category}</td>
                        <td className="px-5 py-4">{formatRecipeSite(recipe)}</td>
                        <td className="px-5 py-4">
                          <RecipeStatusBadge status={recipe.status} isActive={recipe.isActive} />
                        </td>
                        <td className="px-5 py-4">
                          <RecipeApprovalStatusBadge status={recipe.approvalStatus} />
                        </td>
                        <td className="px-5 py-4">
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedRecipeId((prev) =>
                                prev === recipeKey ? null : recipeKey,
                              )
                            }
                            className="rounded-md border border-primary bg-primary-soft px-3 py-1 text-xs font-semibold text-primary hover:bg-primary-soft/80"
                          >
                            {isSelected ? 'Hide details' : 'View details'}
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {selectedRecipe ? (
        <div className="rounded-md border border-border bg-surface p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <h2 className="text-lg font-semibold">Recipe Detail</h2>
            <div className="flex items-center gap-2">
              {canCreateFromSelectedRecipe ? (
                <>
                  <button
                    type="button"
                    onClick={() => handleUseAsTemplate(selectedRecipe)}
                    className="rounded-md border border-primary bg-background px-4 py-2 text-xs font-semibold text-primary shadow-sm"
                  >
                    Create menu from this recipe
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCreateNewVersion(selectedRecipe)}
                    className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white shadow-sm"
                  >
                    Create new version
                  </button>
                </>
              ) : null}
              {canEditSelectedRecipe ? (
                <button
                  type="button"
                  onClick={() => handleEditRecipe(selectedRecipe)}
                  className="rounded-md border border-border bg-background px-4 py-2 text-xs font-semibold text-primary"
                >
                  Edit recipe
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setSelectedRecipeId(null)}
                aria-label="Close recipe detail"
                title="Close"
                className="dm-x-button"
              >
                <i className="bi bi-x-lg text-sm leading-none" aria-hidden="true" />
              </button>
            </div>
          </div>
          <RecipeDetailOverview recipe={selectedRecipe} siteLabel={formatRecipeSite(selectedRecipe)} />

          {selectedRecipe.approvalStatus !== 'approved' &&
          selectedRecipe.approvalHistory?.length ? (
            <div className="mt-4 rounded-md border border-border bg-background p-4 text-sm">
              <p className="font-semibold text-foreground">Approval history</p>
              <div className="mt-3 space-y-3">
                {selectedRecipe.approvalHistory.map((entry, index) => (
                  <div
                    key={`${entry.rejectedAt ?? 'rejection'}-${index}`}
                    className="rounded-md border border-border bg-white p-3"
                  >
                    <p className="font-semibold text-danger">
                      Rejection {index + 1}
                    </p>
                    <p className="mt-1 text-foreground">
                      {entry.rejectionReason || 'No rejection note.'}
                    </p>
                    {entry.resubmissionFeedback?.trim() ? (
                      <div className="mt-3 rounded-md border border-primary/20 bg-primary-soft p-3">
                        <p className="font-semibold text-primary">Chef feedback</p>
                        <p className="mt-1 text-foreground">
                          {entry.resubmissionFeedback}
                        </p>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
              {selectedRecipe.approvalStatus === 'rejected' ? (
                <p className="mt-3 text-xs text-muted">
                  Latest review by {reviewedByLabel} | {reviewedAtLabel}
                </p>
              ) : null}
            </div>
          ) : selectedRecipe.approvalStatus === 'rejected' ? (
            <div className="mt-4 rounded-md border border-danger/30 bg-danger/5 p-4 text-sm">
              <p className="font-semibold text-danger">Rejected by Unit Manager</p>
              <p className="mt-2 text-foreground">
                {selectedRecipe.rejectionReason?.trim() ||
                  'No rejection reason was provided.'}
              </p>
              <p className="mt-2 text-xs text-muted">
                Reviewed by {reviewedByLabel} | {reviewedAtLabel}
              </p>
            </div>
          ) : null}

          <div className="mt-6">
            <h3 className="font-semibold text-foreground">
              Ingredients
            </h3>
            {ingredientVendors.error ? <p className="mt-2 text-xs text-danger">{ingredientVendors.error}</p> : null}

            {selectedRecipeIngredients.length === 0 ? (
              <div className="mt-3 rounded-md border border-border bg-background p-4 text-sm text-muted">
                No ingredients for this recipe yet.
              </div>
            ) : (
              <div className="mt-3 max-w-full overflow-x-auto rounded-md border border-border bg-white">
                <table className="dm-table min-w-full text-sm">
                  <thead className="bg-background">
                    <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                      <th className="w-16 px-4 py-3 font-semibold">No</th>
                      <th className="px-4 py-3 font-semibold">Type</th>
                      <th className="px-4 py-3 font-semibold">Product code</th>
                      <th className="px-4 py-3 font-semibold">Ingredient name</th>
                      <th className="px-4 py-3 font-semibold">Qty</th>
                      <th className="px-4 py-3 font-semibold">Unit</th>
                      <th className="px-4 py-3 font-semibold">Vendor</th>
                      <th className="px-4 py-3 font-semibold">Price</th>
                      <th className="px-4 py-3 font-semibold">Ingredient Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedRecipeIngredientRows.map(
                      ({ ingredient, missingFields }, idx) => {
                        const missingProductCode =
                          missingFields.includes('product code')
                        const missingIngredientName =
                          missingFields.includes('ingredient name')
                        const missingQty = missingFields.includes('qty')
                        const missingUnit = missingFields.includes('unit')
                        const rowHighlightClass =
                          missingFields.length > 0 ? 'bg-danger/5' : ''

                        return (
                          <tr
                            key={`${ingredient.productCode}-${idx}`}
                            className="border-t border-border"
                          >
                            <td
                              className={`px-4 py-3 text-sm ${rowHighlightClass} ${missingFields.length > 0 ? 'font-semibold text-danger' : 'text-muted'}`}
                            >
                              {idx + 1}
                            </td>
                            <td className={`px-4 py-3 align-top ${rowHighlightClass}`}>
                              {ingredient.ingredientType || '-'}
                            </td>
                            <td className={`px-4 py-3 align-top ${rowHighlightClass}`}>
                              {missingProductCode ? (
                                <span className="font-medium text-danger">
                                  Missing product code
                                </span>
                              ) : (
                                ingredient.productCode
                              )}
                            </td>
                            <td className={`px-4 py-3 align-top ${rowHighlightClass}`}>
                              <div
                                className={
                                  missingIngredientName
                                    ? 'font-medium text-danger'
                                    : undefined
                                }
                              >
                                {missingIngredientName
                                  ? 'Missing ingredient name'
                                  : ingredient.name}
                                {ingredient.priceSourceSite ? <p className="mt-1 text-xs text-muted">Price source: {ingredient.priceSourceSiteName ?? ingredient.priceSourceSite}</p> : null}
                              </div>
                            </td>
                            <td
                              className={`px-4 py-3 align-top ${rowHighlightClass} ${missingQty ? 'font-medium text-danger' : ''}`}
                            >
                              {missingQty ? 'Missing qty' : ingredient.qty}
                            </td>
                            <td
                              className={`px-4 py-3 align-top ${rowHighlightClass} ${missingUnit ? 'font-medium text-danger' : ''}`}
                            >
                              {missingUnit
                                ? 'Missing unit'
                                : formatUnitLabel(ingredient.unitOfMeasures)}
                            </td>
                            <td className={`px-4 py-3 align-top ${rowHighlightClass}`}>
                              {ingredientVendors.loading ? 'Loading...' : ingredientVendors.vendorsByCode[ingredient.productCode] || ingredient.vendor?.trim() || '-'}
                            </td>
                            <td className={`px-4 py-3 align-top ${rowHighlightClass}`}>{formatRecipeDetailPrice(ingredient.priceUom, '-')}</td>
                            <td className={`px-4 py-3 align-top font-medium ${rowHighlightClass}`}>{formatRecipeDetailPrice(ingredient.foodCost, '-')}</td>
                          </tr>
                        )
                      },
                    )}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-4 text-xs text-muted">
              <p>
                <span className="font-medium text-foreground">Created by</span>{' '}
                {createdByLabel} | {createdAtLabel}
              </p>
              <p className="mt-1">
                <span className="font-medium text-foreground">
                  Last updated by
                </span>{' '}
                {updatedByLabel} | {updatedAtLabel}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default ChefMenuBank

