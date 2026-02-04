import { useEffect, useMemo, useState } from 'react'
import { useChefData } from '../lib/chef-data'
import { formatUnitLabel } from '../lib/unit-of-measures'

const ITEMS_PER_PAGE = 10

const statusLabel = (status: 'draft' | 'active') =>
  status === 'active' ? 'Active' : 'Draft'

const ChefMenuBank = () => {
  const { recipes } = useChefData()
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilters, setStatusFilters] = useState<Array<'draft' | 'active'>>(
    [],
  )
  const [categoryFilters, setCategoryFilters] = useState<string[]>([])
  const [filterOpen, setFilterOpen] = useState(false)
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null)
  const [page, setPage] = useState(1)

  const categoryOptions = useMemo(() => {
    const unique = Array.from(
      new Set(
        recipes
          .map((recipe) => recipe.category.trim())
          .filter((value) => value.length > 0),
      ),
    )
    return unique.sort((a, b) => a.localeCompare(b))
  }, [recipes])

  const activeFilterCount = statusFilters.length + categoryFilters.length

  const filteredRecipes = useMemo(() => {
    const normalized = searchTerm.trim().toLowerCase()
    return recipes.filter((recipe) => {
      const byStatus =
        statusFilters.length === 0 ? true : statusFilters.includes(recipe.status)
      const byCategory =
        categoryFilters.length === 0
          ? true
          : categoryFilters.includes(recipe.category)
      const bySearch =
        !normalized ||
        recipe.name.toLowerCase().includes(normalized) ||
        recipe.category.toLowerCase().includes(normalized)
      return byStatus && byCategory && bySearch
    })
  }, [recipes, searchTerm, statusFilters, categoryFilters])

  const totalPages = Math.max(1, Math.ceil(filteredRecipes.length / ITEMS_PER_PAGE))
  const pageStart = (page - 1) * ITEMS_PER_PAGE
  const pagedRecipes = filteredRecipes.slice(pageStart, pageStart + ITEMS_PER_PAGE)

  useEffect(() => {
    setPage(1)
  }, [searchTerm, statusFilters, categoryFilters])

  useEffect(() => {
    setPage((prev) => Math.min(prev, totalPages))
  }, [totalPages])

  const selectedRecipe =
    selectedRecipeId === null
      ? null
      : recipes.find((item) => item.id === selectedRecipeId) ?? null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-muted">
            Recipe Data
          </p>
          <h2 className="mt-2 text-2xl font-semibold">Curated recipe collection</h2>
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
                <svg
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className={`h-4 w-4 transition-transform ${
                    filterOpen ? 'rotate-180' : ''
                  }`}
                  aria-hidden="true"
                >
                  <path d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.25a.75.75 0 0 1-1.06 0L5.21 8.29a.75.75 0 0 1 .02-1.08z" />
                </svg>
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
                  {categoryOptions.length === 0 ? (
                    <p className="text-xs text-muted">
                      No categories yet.
                    </p>
                  ) : (
                    categoryOptions.map((category) => (
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
                <th className="px-5 py-4 font-semibold">Name</th>
                <th className="px-5 py-4 font-semibold">Category</th>
                <th className="px-5 py-4 font-semibold">Recipe status</th>
                <th className="px-5 py-4 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecipes.length === 0 ? (
                <tr className="border-t border-border">
                  <td colSpan={4} className="px-5 py-10 text-center text-muted">
                    No recipes yet.
                  </td>
                </tr>
              ) : (
                pagedRecipes.map((recipe) => (
                  <tr key={recipe.id} className="border-t border-border">
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
                            prev === recipe.id ? null : recipe.id,
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
            Showing {pagedRecipes.length} of {filteredRecipes.length} recipes
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={page === 1}
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
              disabled={page === totalPages}
              className="rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {selectedRecipe ? (
        <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-muted">
            Recipe Detail
          </p>
          <h3 className="mt-2 text-lg font-semibold">{selectedRecipe.name}</h3>
          <p className="mt-2 text-sm text-muted">{selectedRecipe.description}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-border bg-background p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted">
                Category
              </p>
              <p className="mt-2 text-sm font-medium">{selectedRecipe.category}</p>
            </div>
            <div className="rounded-2xl border border-border bg-background p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted">
                Price
              </p>
              <p className="mt-2 text-sm font-medium">
                IDR {selectedRecipe.price}
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-background p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted">
                Base servings
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
