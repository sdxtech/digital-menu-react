import PageHeading from '../components/PageHeading'
import { useCallback, useEffect, useMemo, useState } from 'react'
import TablePagination from '../components/TablePagination'
import RecipeFilters from '../components/RecipeFilters'
import { RecipeExportToolbar, RecipeExportDialog, RecipeExportCheckbox } from '../components/RecipeExportControls'
import { useRecipeExportSelection } from '../lib/use-recipe-export-selection'
import { useRecipeSiteOptions } from '../lib/use-recipe-site-options'
import RecipeSalesRecommendation from '../components/RecipeSalesRecommendation'
import { RecipeStatusBadge, RecipeApprovalStatusBadge } from '../components/RecipeStatusBadge'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'
import { formatRecipeVersion } from '../lib/recipe-version'
import { formatUnitLabel } from '../lib/unit-of-measures'

const ITEMS_PER_PAGE = 10

type RecipeIngredient = {
  priceUom?: number
  foodCost?: number
  ingredientType?: 'IT' | 'NMP'
  productCode: string
  name: string
  unitOfMeasures: string
  qty: number
}

type Recipe = {
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
  portionSize: number
  status: 'draft' | 'active'
  isActive?: boolean
  approvalStatus: 'pending' | 'approved' | 'rejected'
  approvalHistory?: Array<{
    rejectionReason: string
    rejectedByName?: string
    rejectedAt?: string
    resubmissionFeedback?: string
    resubmittedByName?: string
    resubmittedAt?: string
  }>
  ingredients?: RecipeIngredient[]
}

const formatActorLabel = (name?: string, email?: string, fallback?: string) =>
  name?.trim() || email?.trim() || fallback?.trim() || 'Unknown'

const formatRecipeSite = (recipe: Recipe) =>
  recipe.siteName?.trim() || recipe.site?.trim() || 'All sites'

const formatTimestamp = (value?: string) => {
  if (!value) return 'Unknown'
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return 'Unknown'
  return parsed.toLocaleString('en-GB')
}

const getRecipeKey = (recipe: Recipe) =>
  recipe.id ?? recipe._id ?? recipe.recipeCode ?? recipe.name

const UnitManagerRecipeDataPage = ({
  showExport = true,
  enableSiteSelection = false,
  description =
    'View approved, pending, and rejected recipes without leaving the Unit Manager workspace.',
}: {
  showExport?: boolean
  enableSiteSelection?: boolean
  description?: string
}) => {
  const { accessToken, user } = useAuth()
  const { sites: recipeSites, error: siteError } = useRecipeSiteOptions(accessToken)
  const [siteFilter, setSiteFilter] = useState('')
  const siteOptions = useMemo(
    () =>
      Array.from(
        new Set([...(user?.site ? [user.site] : []), ...(user?.sites ?? [])]),
      ).map((code) => ({
        code,
        name:
          user?.siteOptions?.find((site) => site.code === code)?.name ?? code,
      })),
    [user?.site, user?.siteOptions, user?.sites],
  )
  const [selectedSite, setSelectedSite] = useState('')
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [searchInput, setSearchInput] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilters, setStatusFilters] = useState<Array<'draft' | 'active'>>(
    [],
  )
  const [categoryFilters, setCategoryFilters] = useState<string[]>([])
  const [approvalFilter, setApprovalFilter] = useState<
    '' | 'pending' | 'approved' | 'rejected'
  >('')
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalItems, setTotalItems] = useState(0)
  const [loading, setLoading] = useState(false)
  const recipeExport = useRecipeExportSelection(accessToken, user?.id ?? user?.email, { loading, site: enableSiteSelection ? selectedSite : undefined, enabled: showExport && (!enableSiteSelection || Boolean(selectedSite)) })
  const [error, setError] = useState('')

  const fetchCategories = useCallback(async () => {
    if (!accessToken) return
    if (enableSiteSelection && !selectedSite) {
      setCategories([])
      return
    }

    try {
      const params = new URLSearchParams()
      if (enableSiteSelection) params.set('site', selectedSite)
      const query = params.toString()
      const data = await apiFetch<string[]>(
        `/recipes/categories${query ? `?${query}` : ''}`,
        undefined,
        accessToken,
      )
      setCategories(data ?? [])
    } catch {
      setCategories([])
    }
  }, [accessToken, enableSiteSelection, selectedSite])

  const fetchRecipes = useCallback(async () => {
    if (!accessToken) return
    if (enableSiteSelection && !selectedSite) {
      setRecipes([])
      setTotalItems(0)
      setTotalPages(1)
      return
    }

    setLoading(true)
    setError('')

    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('limit', String(ITEMS_PER_PAGE))
      if (enableSiteSelection) params.set('site', selectedSite)

      if (searchTerm.trim()) {
        params.set('search', searchTerm.trim())
      }
      if (enableSiteSelection) {
        params.set('siteFilter', selectedSite)
      } else if (siteFilter) {
        params.set('siteFilter', siteFilter)
      }

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
        totalPages?: number
      }>(`/recipes?${params.toString()}`, undefined, accessToken)

      setRecipes(data.items ?? [])
      setTotalItems(data.total ?? 0)
      setTotalPages(
        data.totalPages ?? Math.max(1, Math.ceil((data.total ?? 0) / ITEMS_PER_PAGE)),
      )
    } catch (fetchError) {
      const message =
        fetchError instanceof Error ? fetchError.message : 'Failed to load recipes.'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [
    accessToken,
    approvalFilter,
    categoryFilters,
    enableSiteSelection,
    page,
    searchTerm,
    selectedSite,
    siteFilter,
    statusFilters,
  ])

  useEffect(() => {
    if (!enableSiteSelection) return
    setSelectedSite((current) =>
      siteOptions.some((site) => site.code === current)
        ? current
        : siteOptions[0]?.code ?? '',
    )
  }, [enableSiteSelection, siteOptions])

  useEffect(() => {
    fetchCategories().catch(() => null)
  }, [fetchCategories])

  useEffect(() => {
    fetchRecipes().catch(() => null)
  }, [fetchRecipes])

  useEffect(() => {
    setPage(1)
  }, [searchTerm, statusFilters, categoryFilters, approvalFilter, selectedSite])

  useEffect(() => {
    setSelectedRecipeId(null)
  }, [selectedSite])

  const selectedRecipe = useMemo(
    () =>
      selectedRecipeId === null
        ? null
        : recipes.find((recipe) => getRecipeKey(recipe) === selectedRecipeId) ?? null,
    [recipes, selectedRecipeId],
  )

  const createdByLabel = selectedRecipe
    ? formatActorLabel(
        selectedRecipe.createdByName,
        selectedRecipe.createdByEmail,
        selectedRecipe.createdBy,
      )
    : 'Unknown'
  const updatedByLabel = selectedRecipe
    ? formatActorLabel(
        selectedRecipe.updatedByName ?? selectedRecipe.createdByName,
        selectedRecipe.updatedByEmail ?? selectedRecipe.createdByEmail,
        selectedRecipe.updatedBy ?? selectedRecipe.createdBy,
      )
    : 'Unknown'
  const selectedRecipeIngredients = selectedRecipe?.ingredients ?? []


  return (
    <div className="space-y-6">
      <RecipeExportDialog exportState={recipeExport} />
      <div className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <PageHeading className="text-2xl font-semibold">Recipe Data</PageHeading>
            <p className="mt-2 text-sm text-muted">
              {description}
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center justify-start gap-2 sm:w-auto sm:justify-end">
            {showExport ? <RecipeExportToolbar exportState={recipeExport} variant="primary" /> : null}
            {enableSiteSelection ? (
              <div className="w-full text-sm sm:w-[calc(11ch+3rem)]">
                <label
                  className="sr-only"
                  htmlFor="executive-recipe-site"
                >
                  Site
                </label>
                <select
                  id="executive-recipe-site"
                  value={selectedSite}
                  onChange={(event) => setSelectedSite(event.target.value)}
                  className="h-10 w-full rounded-xl border border-border bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                >
                  <option value="">Select site</option>
                  {siteOptions.map((site) => (
                    <option key={site.code} value={site.code}>
                      {site.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
        </div>

        <RecipeFilters
          sites={recipeSites}
          selectedSite={siteFilter}
          onSiteChange={enableSiteSelection ? undefined : (site) => {
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

        <div className="rounded-md border border-border bg-surface p-6 shadow-sm">
          <TablePagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            loading={loading}
            summary={`Showing ${recipes.length} of ${totalItems} recipes`}
          />
          <div className="mt-4 max-w-full overflow-x-auto rounded-md border border-border">
            <table className="dm-table min-w-full bg-white text-sm">
              <thead className="bg-background">
                <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                  {showExport ? <th className="w-12 px-5 py-4"><RecipeExportCheckbox exportState={recipeExport} /></th> : null}
                  <th className="w-16 px-5 py-4 font-semibold">No</th>
                  <th className="px-5 py-4 font-semibold">Recipe code</th>
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
                    <td colSpan={showExport ? 10 : 9} className="px-5 py-10 text-center text-muted">
                      Loading recipes...
                    </td>
                  </tr>
                ) : recipes.length === 0 ? (
                  <tr className="border-t border-border">
                    <td colSpan={showExport ? 10 : 9} className="px-5 py-10 text-center text-muted">
                      {error ? error : 'No recipes found.'}
                    </td>
                  </tr>
                ) : (
                  recipes.map((recipe, index) => {
                    const recipeKey = getRecipeKey(recipe)
                    const isSelected = selectedRecipeId === recipeKey

                    return (
                      <tr key={recipeKey} className="border-t border-border">
                        {showExport ? <td className="px-5 py-4"><RecipeExportCheckbox exportState={recipeExport} id={recipe.id ?? recipe._id ?? ''} name={recipe.name} /></td> : null}
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
                          <div className="flex flex-wrap gap-2">
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
                          </div>
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
            <div>
              <h2 className="text-lg font-semibold">Recipe Detail</h2>
              <p className="mt-1 text-xs text-muted">
                Code: {selectedRecipe.recipeCode ?? '-'}
              </p>
              <p className="mt-1 text-xs text-muted">
                {selectedRecipe.name} | {formatRecipeVersion(selectedRecipe.version)}
              </p>
              <p className="mt-2 text-sm text-muted">
                {selectedRecipe.description?.trim() || 'No description.'}
              </p>
            </div>
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

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md border border-border bg-background p-4">
              <p className="text-xs text-muted">Version</p>
              <p className="mt-2 text-sm font-semibold text-primary">
                {formatRecipeVersion(selectedRecipe.version)}
              </p>
            </div>
            <div className="rounded-md border border-border bg-background p-4">
              <p className="text-xs text-muted">Category</p>
              <p className="mt-2 text-sm font-medium">{selectedRecipe.category}</p>
            </div>
            <div className="rounded-md border border-border bg-background p-4">
              <p className="text-xs text-muted">Base pax</p>
              <p className="mt-2 text-sm font-medium">{selectedRecipe.portionSize}</p>
            </div>
            <div className="rounded-md border border-border bg-background p-4">
              <p className="text-xs text-muted">Approval status</p>
              <p className="mt-2">
                <RecipeApprovalStatusBadge status={selectedRecipe.approvalStatus} />
              </p>
            </div>
          </div>

          <RecipeSalesRecommendation recipe={selectedRecipe} />

          {selectedRecipe.approvalStatus !== 'approved' &&
          selectedRecipe.approvalHistory?.length ? (
            <div className="mt-6 rounded-md border border-border bg-background p-4">
              <h3 className="font-semibold text-foreground">
                Approval history
              </h3>
              <div className="mt-3 space-y-3">
                {selectedRecipe.approvalHistory.map((entry, index) => (
                  <div
                    key={`${entry.rejectedAt ?? 'rejection'}-${index}`}
                    className="rounded-md border border-border bg-white p-4 text-sm"
                  >
                    <p className="font-semibold text-danger">
                      Rejection {index + 1}
                    </p>
                    <p className="mt-2 text-foreground">
                      {entry.rejectionReason || 'No rejection note.'}
                    </p>
                    <p className="mt-2 text-xs text-muted">
                      By {formatActorLabel(entry.rejectedByName)} |{' '}
                      {formatTimestamp(entry.rejectedAt)}
                    </p>
                    {entry.resubmissionFeedback?.trim() ? (
                      <div className="mt-3 rounded-md border border-primary/20 bg-primary-soft p-3">
                        <p className="font-semibold text-primary">
                          Chef feedback
                        </p>
                        <p className="mt-1 text-foreground">
                          {entry.resubmissionFeedback}
                        </p>
                        <p className="mt-2 text-xs text-muted">
                          By {formatActorLabel(entry.resubmittedByName)} |{' '}
                          {formatTimestamp(entry.resubmittedAt)}
                        </p>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-6">
            <h3 className="font-semibold text-foreground">Ingredients</h3>
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
                      <th className="px-4 py-3 font-semibold">Product code</th>
                      <th className="px-4 py-3 font-semibold">Ingredient name</th>
                      <th className="px-4 py-3 font-semibold">Qty</th>
                      <th className="px-4 py-3 font-semibold">Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedRecipeIngredients.map((ingredient, index) => (
                      <tr
                        key={`${ingredient.productCode}-${ingredient.unitOfMeasures}-${index}`}
                        className="border-t border-border"
                      >
                        <td className="px-4 py-3 text-sm text-muted">{index + 1}</td>
                        <td className="px-4 py-3">{ingredient.productCode || '-'}</td>
                        <td className="px-4 py-3">{ingredient.name || '-'}</td>
                        <td className="px-4 py-3">{ingredient.qty ?? '-'}</td>
                        <td className="px-4 py-3">
                          {ingredient.unitOfMeasures
                            ? formatUnitLabel(ingredient.unitOfMeasures)
                            : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-4 text-xs text-muted">
              <p>
                <span className="font-medium text-foreground">Created by</span>{' '}
                {createdByLabel} | {formatTimestamp(selectedRecipe.createdAt)}
              </p>
              <p className="mt-1">
                <span className="font-medium text-foreground">Last updated by</span>{' '}
                {updatedByLabel} |{' '}
                {formatTimestamp(selectedRecipe.updatedAt ?? selectedRecipe.createdAt)}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default UnitManagerRecipeDataPage
