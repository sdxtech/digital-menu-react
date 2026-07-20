import { useCallback, useEffect, useMemo, useState } from 'react'
import TablePagination from '../components/TablePagination'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'
import { formatRecipeVersion } from '../lib/recipe-version'
import { getApprovalStatusLabel } from '../lib/status-labels'
import { formatUnitLabel } from '../lib/unit-of-measures'

const ITEMS_PER_PAGE = 10

type RecipeIngredient = {
  productCode: string
  name: string
  unitOfMeasures: string
  qty: number
}

type Recipe = {
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
  approvalStatus: 'pending' | 'approved' | 'rejected'
  ingredients?: RecipeIngredient[]
}

const statusLabel = (status: 'draft' | 'active') =>
  status === 'active' ? 'Active' : 'Draft'

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

const UnitManagerRecipeDataPage = () => {
  const { accessToken } = useAuth()
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilters, setStatusFilters] = useState<Array<'draft' | 'active'>>(
    [],
  )
  const [categoryFilters, setCategoryFilters] = useState<string[]>([])
  const [approvalFilter, setApprovalFilter] = useState<
    '' | 'pending' | 'approved' | 'rejected'
  >('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalItems, setTotalItems] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const activeFilterCount =
    statusFilters.length + categoryFilters.length + (approvalFilter ? 1 : 0)

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
      setCategories([])
    }
  }, [accessToken])

  const fetchRecipes = useCallback(async () => {
    if (!accessToken) return

    setLoading(true)
    setError('')

    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('limit', String(ITEMS_PER_PAGE))

      if (searchTerm.trim()) {
        params.set('search', searchTerm.trim())
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
    page,
    searchTerm,
    statusFilters,
  ])

  useEffect(() => {
    fetchCategories().catch(() => null)
  }, [fetchCategories])

  useEffect(() => {
    fetchRecipes().catch(() => null)
  }, [fetchRecipes])

  useEffect(() => {
    setPage(1)
  }, [searchTerm, statusFilters, categoryFilters, approvalFilter])

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
      <div className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Recipe Data</h1>
            <p className="mt-2 text-sm text-muted">
              View approved, pending, and rejected recipes without leaving the
              Unit Manager workspace.
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center justify-start gap-2 sm:w-auto sm:flex-nowrap sm:justify-end">
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search recipes..."
              className="w-full min-w-[200px] rounded-2xl border border-border bg-white px-4 py-2 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20 sm:w-64 md:w-72"
            />
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setFilterOpen((prev) => !prev)}
                className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white shadow-sm"
              >
                <span className="flex items-center gap-2">
                  <span>
                    Filter{activeFilterCount ? ` (${activeFilterCount})` : ''}
                  </span>
                  <i
                    className={`bi bi-chevron-down text-base transition-transform ${
                      filterOpen ? 'rotate-180' : ''
                    }`}
                    aria-hidden="true"
                  />
                </span>
              </button>

              {filterOpen ? (
                <>
                  <button
                    type="button"
                    aria-label="Close filter panel"
                    className="fixed inset-0 z-30 cursor-default bg-transparent md:hidden"
                    onClick={() => setFilterOpen(false)}
                  />
                  <div className="fixed left-3 right-3 top-56 z-40 mt-0 max-h-[calc(100vh-15rem)] overflow-y-auto rounded-md border border-border bg-white p-4 text-sm shadow-xl md:absolute md:left-auto md:right-0 md:top-full md:mt-2 md:w-72 md:max-h-none md:overflow-visible">
                    <div className="mb-3 flex items-center justify-between border-b border-border pb-2 md:hidden">
                      <p className="text-xs font-semibold text-primary">Filter</p>
                      <button
                        type="button"
                        onClick={() => setFilterOpen(false)}
                        className="flex h-7 w-7 items-center justify-center rounded-md bg-primary-soft text-primary transition hover:bg-primary hover:text-white"
                        aria-label="Close filter"
                      >
                        <i className="bi bi-x-lg text-[10px]" aria-hidden="true" />
                      </button>
                    </div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted">Recipe status</p>
                    {statusFilters.length ? (
                      <button
                        type="button"
                        onClick={() => setStatusFilters([])}
                        className="text-xs font-semibold text-primary"
                      >
                        Reset
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-3 space-y-2">
                    {(['draft', 'active'] as const).map((status) => (
                      <label key={status} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={statusFilters.includes(status)}
                          onChange={() =>
                            setStatusFilters((prev) =>
                              prev.includes(status)
                                ? prev.filter((item) => item !== status)
                                : [...prev, status],
                            )
                          }
                          className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-primary/30"
                        />
                        <span>{statusLabel(status)}</span>
                      </label>
                    ))}
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <p className="text-xs text-muted">Approval status</p>
                    {approvalFilter ? (
                      <button
                        type="button"
                        onClick={() => setApprovalFilter('')}
                        className="text-xs font-semibold text-primary"
                      >
                        Reset
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-3 space-y-2">
                    {(['pending', 'approved', 'rejected'] as const).map((status) => (
                      <label key={status} className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name="recipe-approval-status"
                          checked={approvalFilter === status}
                          onChange={() => setApprovalFilter(status)}
                          className="h-4 w-4 border-border text-primary focus:ring-2 focus:ring-primary/30"
                        />
                        <span>{getApprovalStatusLabel(status)}</span>
                      </label>
                    ))}
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <p className="text-xs text-muted">Category</p>
                    {categoryFilters.length ? (
                      <button
                        type="button"
                        onClick={() => setCategoryFilters([])}
                        className="text-xs font-semibold text-primary"
                      >
                        Reset
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-3 max-h-48 space-y-2 overflow-y-auto pr-1">
                    {categories.length === 0 ? (
                      <p className="text-xs text-muted">No categories yet.</p>
                    ) : (
                      categories.map((category) => (
                        <label key={category} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={categoryFilters.includes(category)}
                            onChange={() =>
                              setCategoryFilters((prev) =>
                                prev.includes(category)
                                  ? prev.filter((item) => item !== category)
                                  : [...prev, category],
                              )
                            }
                            className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-primary/30"
                          />
                          <span>{category}</span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
                </>
              ) : null}
            </div>
          </div>
        </div>

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
                    <td colSpan={9} className="px-5 py-10 text-center text-muted">
                      Loading recipes...
                    </td>
                  </tr>
                ) : recipes.length === 0 ? (
                  <tr className="border-t border-border">
                    <td colSpan={9} className="px-5 py-10 text-center text-muted">
                      {error ? error : 'No recipes found.'}
                    </td>
                  </tr>
                ) : (
                  recipes.map((recipe, index) => {
                    const recipeKey = getRecipeKey(recipe)
                    const isSelected = selectedRecipeId === recipeKey

                    return (
                      <tr key={recipeKey} className="border-t border-border">
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
                        <td className="px-5 py-4">{statusLabel(recipe.status)}</td>
                        <td className="px-5 py-4">
                          {getApprovalStatusLabel(recipe.approvalStatus)}
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
              <p className="mt-2 text-sm font-medium">
                {getApprovalStatusLabel(selectedRecipe.approvalStatus)}
              </p>
            </div>
          </div>

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
