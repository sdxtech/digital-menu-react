import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'
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
  name: string
  category: string
  description?: string
  price: number
  portionSize: number
  status: 'draft' | 'active'
  approvalStatus: 'pending' | 'approved' | 'rejected'
  ingredients: RecipeIngredient[]
}

const statusLabel = (status: 'draft' | 'active') =>
  status === 'active' ? 'Active' : 'Draft'

const ChefMenuBank = () => {
  const { accessToken } = useAuth()
  const navigate = useNavigate()
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilters, setStatusFilters] = useState<Array<'draft' | 'active'>>(
    [],
  )
  const [categoryFilters, setCategoryFilters] = useState<string[]>([])
  const [filterOpen, setFilterOpen] = useState(false)
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalItems, setTotalItems] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const activeFilterCount = statusFilters.length + categoryFilters.length

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
      if (searchTerm.trim()) params.set('search', searchTerm.trim())
      if (statusFilters.length) {
        params.set('statuses', statusFilters.join(','))
      }
      if (categoryFilters.length) {
        params.set('categories', categoryFilters.join(','))
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
  }, [accessToken, page, searchTerm, statusFilters, categoryFilters])

  useEffect(() => {
    fetchCategories().catch(() => null)
  }, [fetchCategories])

  useEffect(() => {
    fetchRecipes().catch(() => null)
  }, [fetchRecipes])

  useEffect(() => {
    setPage(1)
  }, [searchTerm, statusFilters, categoryFilters])

  const selectedRecipe =
    selectedRecipeId === null
      ? null
      : recipes.find((item) => (item.id ?? item._id) === selectedRecipeId) ?? null

  const handleCreateFromRecipe = (recipe: Recipe) => {
    navigate('/chef/menu-create', {
      state: {
        baseRecipe: {
          name: recipe.name,
          category: recipe.category,
          description: recipe.description ?? '',
          portionSize: recipe.portionSize,
          ingredients: recipe.ingredients ?? [],
        },
      },
    })
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Recipe Data</h1>
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
                className="rounded-2xl bg-primary px-4 py-2 text-xs font-semibold text-white shadow-sm"
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
                <div className="absolute right-0 z-20 mt-2 w-72 rounded-2xl border border-border bg-white p-4 text-sm shadow-xl">
                  <div className="flex items-center justify-between">
                    <p className="text-xs uppercase tracking-[0.3em] text-muted">
                      Status
                    </p>
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
                      <label
                        key={status}
                        className="flex items-center gap-2 text-sm"
                      >
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
                    <p className="text-xs uppercase tracking-[0.3em] text-muted">
                      Category
                    </p>
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
                        <label
                          key={category}
                          className="flex items-center gap-2 text-sm"
                        >
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
              ) : null}
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-border bg-surface shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-background">
                <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                  <th className="w-16 px-5 py-4 font-semibold">No</th>
                  <th className="px-5 py-4 font-semibold">Name</th>
                  <th className="px-5 py-4 font-semibold">Category</th>
                  <th className="px-5 py-4 font-semibold">Recipe status</th>
                  <th className="px-5 py-4 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr className="border-t border-border">
                    <td colSpan={5} className="px-5 py-10 text-center text-muted">
                      Loading recipes...
                    </td>
                  </tr>
                ) : recipes.length === 0 ? (
                  <tr className="border-t border-border">
                    <td colSpan={5} className="px-5 py-10 text-center text-muted">
                      {error ? error : 'No recipes yet.'}
                    </td>
                  </tr>
                ) : (
                  recipes.map((recipe, index) => (
                    <tr
                      key={recipe.id ?? recipe._id}
                      className="border-t border-border"
                    >
                      <td className="px-5 py-4 text-sm text-muted">
                        {(page - 1) * ITEMS_PER_PAGE + index + 1}
                      </td>
                      <td className="px-5 py-4 font-medium">{recipe.name}</td>
                      <td className="px-5 py-4">{recipe.category}</td>
                      <td className="px-5 py-4">
                        <span>{statusLabel(recipe.status)}</span>
                      </td>
                      <td className="px-5 py-4">
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedRecipeId((prev) =>
                              prev === (recipe.id ?? recipe._id)
                                ? null
                                : (recipe.id ?? recipe._id ?? null),
                            )
                          }
                          className="text-xs font-semibold text-primary"
                        >
                          View recipe details
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-white px-5 py-4 text-xs">
            <span className="text-muted">
              Showing {recipes.length} of {totalItems} recipes
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={page === 1 || loading}
                className="rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
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
                className="rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>

      {selectedRecipe ? (
        <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted">
                Recipe Detail
              </p>
              <h3 className="mt-2 text-lg font-semibold">
                {selectedRecipe.name}
              </h3>
              <p className="mt-2 text-sm text-muted">
                {selectedRecipe.description}
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleCreateFromRecipe(selectedRecipe)}
              className="rounded-2xl bg-primary px-4 py-2 text-xs font-semibold text-white shadow-sm"
            >
              Create menu from this recipe
            </button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-border bg-background p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted">
                Category
              </p>
              <p className="mt-2 text-sm font-medium">
                {selectedRecipe.category}
              </p>
            </div>
            {/* TODO: Re-enable price card when pricing is finalized. */}
            {/* <div className="rounded-2xl border border-border bg-background p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted">
                Price
              </p>
              <p className="mt-2 text-sm font-medium">
                IDR {selectedRecipe.price}
              </p>
            </div> */}
            <div className="rounded-2xl border border-border bg-background p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted">
                Base pax
              </p>
              <p className="mt-2 text-sm font-medium">
                {selectedRecipe.portionSize}
              </p>
            </div>
          </div>

          <div className="mt-6">
            <p className="text-xs uppercase tracking-[0.2em] text-muted">
              Ingredients
            </p>
            <h4 className="mt-2 text-base font-semibold">
              Ingredient requirements
            </h4>

            {selectedRecipe.ingredients.length === 0 ? (
              <div className="mt-3 rounded-2xl border border-border bg-background p-4 text-sm text-muted">
                No ingredients for this recipe yet.
              </div>
            ) : (
              <div className="mt-3 overflow-x-auto rounded-2xl border border-border bg-white">
                <table className="min-w-full text-sm">
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
                    {selectedRecipe.ingredients.map((ingredient, idx) => (
                      <tr
                        key={`${ingredient.productCode}-${idx}`}
                        className="border-t border-border"
                      >
                        <td className="px-4 py-3 text-sm text-muted">
                          {idx + 1}
                        </td>
                        <td className="px-4 py-3">{ingredient.productCode}</td>
                        <td className="px-4 py-3">{ingredient.name}</td>
                        <td className="px-4 py-3">{ingredient.qty}</td>
                        <td className="px-4 py-3">
                          {formatUnitLabel(ingredient.unitOfMeasures)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default ChefMenuBank
