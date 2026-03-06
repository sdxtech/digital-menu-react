import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
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
  imageUrl?: string
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
  approvalStatus: 'pending' | 'approved' | 'rejected'
  ingredients: RecipeIngredient[]
}

type PresignResponse = {
  key: string
  url: string
  publicUrl: string
}

const statusLabel = (status: 'draft' | 'active') =>
  status === 'active' ? 'Active' : 'Draft'

const formatActorLabel = (name?: string) => {
  if (name) return name
  return 'Unknown'
}

const formatTimestamp = (value?: string) => {
  if (!value) return 'Unknown'
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return 'Unknown'
  return parsed.toLocaleString('en-GB')
}

const getRecipeId = (recipe: Recipe) => recipe.id ?? recipe._id ?? ''

type MenuPhotoFrameProps = {
  size?: 'sm' | 'lg'
  photoUrl?: string | null
  onClick?: () => void
  label?: string
}

const MenuPhotoFrame = ({
  size = 'sm',
  photoUrl,
  onClick,
  label = 'recipe photo',
}: MenuPhotoFrameProps) => {
  const isLarge = size === 'lg'
  const frameClasses = isLarge ? 'h-24 w-24' : 'h-12 w-12'
  const iconClasses = isLarge ? 'text-2xl' : 'text-base'
  const borderStyle = photoUrl ? 'border-solid' : 'border-dashed'
  const interactiveClasses = onClick
    ? 'cursor-pointer transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30'
    : 'cursor-default'
  const actionLabel = onClick
    ? `${photoUrl ? 'Edit' : 'Add'} ${label}`
    : undefined

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      aria-label={actionLabel}
      className={`flex items-center justify-center rounded-md border-2 ${borderStyle} border-border bg-background ${frameClasses} ${interactiveClasses} ${photoUrl ? 'overflow-hidden' : ''}`}
    >
      {photoUrl ? (
        <img src={photoUrl} alt={label} className="h-full w-full object-cover" />
      ) : (
        <i
          className={`bi bi-plus-lg ${iconClasses} text-muted`}
          aria-hidden="true"
        />
      )}
    </button>
  )
}

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
  const [photoModalOpen, setPhotoModalOpen] = useState(false)
  const [photoModalRecipeId, setPhotoModalRecipeId] = useState<string | null>(null)
  const [photoDraftFile, setPhotoDraftFile] = useState<File | null>(null)
  const [photoDraftUrl, setPhotoDraftUrl] = useState<string | null>(null)
  const [photoError, setPhotoError] = useState('')
  const [photoSaving, setPhotoSaving] = useState(false)
  const [photoDeleting, setPhotoDeleting] = useState(false)
  const [photoInputKey, setPhotoInputKey] = useState(0)

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
  const selectedRecipeKey = selectedRecipe ? getRecipeId(selectedRecipe) : ''
  const selectedRecipePhoto = selectedRecipe?.imageUrl ?? null
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
  const photoModalRecipe = photoModalRecipeId
    ? recipes.find((item) => getRecipeId(item) === photoModalRecipeId) ?? null
    : null
  const activePhotoUrl = photoModalRecipe?.imageUrl ?? null
  const selectedRecipeIngredients = selectedRecipe?.ingredients ?? []
  const previewPhotoUrl = photoDraftUrl ?? activePhotoUrl

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

  const handleEditRecipe = (recipe: Recipe) => {
    const recipeId = getRecipeId(recipe)
    if (!recipeId) return

    navigate('/chef/menu-create', {
      state: {
        baseRecipe: {
          id: recipeId,
          name: recipe.name,
          category: recipe.category,
          description: recipe.description ?? '',
          portionSize: recipe.portionSize,
          ingredients: recipe.ingredients ?? [],
        },
      },
    })
  }

  const openPhotoModal = (recipeId: string) => {
    if (photoDraftUrl) {
      URL.revokeObjectURL(photoDraftUrl)
    }
    setPhotoModalRecipeId(recipeId)
    setPhotoModalOpen(true)
    setPhotoDraftFile(null)
    setPhotoDraftUrl(null)
    setPhotoError('')
    setPhotoInputKey((prev) => prev + 1)
  }

  const closePhotoModal = () => {
    if (photoDraftUrl) {
      URL.revokeObjectURL(photoDraftUrl)
    }
    setPhotoModalOpen(false)
    setPhotoModalRecipeId(null)
    setPhotoDraftFile(null)
    setPhotoDraftUrl(null)
    setPhotoError('')
    setPhotoSaving(false)
    setPhotoDeleting(false)
    setPhotoInputKey((prev) => prev + 1)
  }

  const handlePhotoFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] ?? null
    setPhotoError('')

    if (!nextFile) {
      setPhotoDraftFile(null)
      if (photoDraftUrl) {
        URL.revokeObjectURL(photoDraftUrl)
      }
      setPhotoDraftUrl(null)
      return
    }

    if (!nextFile.type.startsWith('image/')) {
      setPhotoDraftFile(null)
      if (photoDraftUrl) {
        URL.revokeObjectURL(photoDraftUrl)
      }
      setPhotoDraftUrl(null)
      setPhotoError('File must be an image.')
      return
    }

    const nextUrl = URL.createObjectURL(nextFile)
    setPhotoDraftFile(nextFile)
    setPhotoDraftUrl((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev)
      }
      return nextUrl
    })
  }

  const applyRecipeUpdate = (updated: Recipe) => {
    const updatedId = getRecipeId(updated)
    if (!updatedId) return
    setRecipes((prev) =>
      prev.map((item) => {
        const itemId = getRecipeId(item)
        if (itemId && itemId === updatedId) {
          return { ...item, ...updated, imageUrl: updated.imageUrl }
        }
        return item
      }),
    )
  }

  const handleSavePhoto = async () => {
    if (!photoModalRecipeId || !photoDraftFile) return
    if (!accessToken) {
      setPhotoError('Please log in first to upload a photo.')
      return
    }
    if (photoSaving || photoDeleting) return

    setPhotoSaving(true)
    setPhotoError('')
    try {
      const contentType = photoDraftFile.type || 'application/octet-stream'
      const presign = await apiFetch<PresignResponse>(
        '/files/presign',
        {
          method: 'POST',
          body: JSON.stringify({
            contentType,
            prefix: `recipes/${photoModalRecipeId}`,
            fileSize: photoDraftFile.size,
          }),
        },
        accessToken,
      )

      const uploadResponse = await fetch(presign.url, {
        method: 'PUT',
        headers: {
          'Content-Type': contentType,
        },
        body: photoDraftFile,
      })

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload photo to storage.')
      }

      const updated = await apiFetch<Recipe>(
        `/recipes/${photoModalRecipeId}/photo`,
        {
          method: 'PATCH',
          body: JSON.stringify({ imageUrl: presign.publicUrl }),
        },
        accessToken,
      )

      applyRecipeUpdate(updated)

      closePhotoModal()
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to upload photo.'
      setPhotoError(message)
    } finally {
      setPhotoSaving(false)
    }
  }

  const handleDeletePhoto = async () => {
    if (!photoModalRecipeId || !activePhotoUrl) return
    if (!accessToken) {
      setPhotoError('Please log in first to delete a photo.')
      return
    }
    if (photoSaving || photoDeleting) return

    setPhotoDeleting(true)
    setPhotoError('')
    try {
      const updated = await apiFetch<Recipe>(
        `/recipes/${photoModalRecipeId}/photo`,
        { method: 'DELETE' },
        accessToken,
      )
      applyRecipeUpdate(updated)
      setPhotoDraftFile(null)
      if (photoDraftUrl) {
        URL.revokeObjectURL(photoDraftUrl)
      }
      setPhotoDraftUrl(null)
      setPhotoInputKey((prev) => prev + 1)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to delete photo.'
      setPhotoError(message)
    } finally {
      setPhotoDeleting(false)
    }
  }

  return (
    <div className="space-y-6">
      {photoModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            className="w-full max-w-lg rounded-md border border-border bg-surface p-6 shadow-xl"
            role="dialog"
            aria-modal="true"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-foreground">
                  Recipe Photo
                </h3>
                <p className="mt-1 text-xs text-muted">
                  {activePhotoUrl ? 'Edit photo' : 'Add photo'}
                </p>
                <p className="mt-2 text-sm text-muted">
                  {activePhotoUrl
                    ? 'Replace the current photo with a new one.'
                    : 'Upload a photo for this recipe.'}
                </p>
              </div>
              <button
                type="button"
                onClick={closePhotoModal}
                className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-primary"
              >
                Close
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <div className="rounded-md border border-border bg-background p-4">
                {previewPhotoUrl ? (
                  <img
                    src={previewPhotoUrl}
                    alt="Recipe photo preview"
                    className="h-40 w-full rounded-xl object-cover"
                  />
                ) : (
                  <div className="flex h-40 w-full items-center justify-center rounded-xl border-2 border-dashed border-border text-muted">
                    <i className="bi bi-plus-lg text-2xl" aria-hidden="true" />
                  </div>
                )}
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">
                  Photo file
                </label>
                <input
                  key={photoInputKey}
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoFileChange}
                  disabled={photoSaving || photoDeleting}
                  className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-2 text-sm shadow-sm file:mr-4 file:rounded-xl file:border-0 file:bg-primary-soft file:px-3 file:py-2 file:text-xs file:font-semibold file:text-primary"
                />
                {photoDraftFile ? (
                  <p className="mt-2 text-xs text-muted">
                    Selected file: {photoDraftFile.name}
                  </p>
                ) : null}
                {photoError ? (
                  <p className="mt-2 text-xs font-medium text-red-600">
                    {photoError}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={handleDeletePhoto}
                  disabled={!activePhotoUrl || photoSaving || photoDeleting}
                  className="rounded-md border border-danger/40 bg-background px-4 py-2 text-xs font-semibold text-danger disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {photoDeleting ? 'Deleting...' : 'Delete photo'}
                </button>
                <button
                  type="button"
                  onClick={closePhotoModal}
                  className="rounded-md border border-border bg-background px-4 py-2 text-xs font-semibold text-primary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSavePhoto}
                  disabled={!photoDraftFile || photoSaving || photoDeleting}
                  className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {photoSaving ? 'Uploading...' : 'Save photo'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
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
                <div className="absolute right-0 z-20 mt-2 w-72 rounded-md border border-border bg-white p-4 text-sm shadow-xl">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted">
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
                    <p className="text-xs text-muted">
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

        <div className="rounded-md border border-border bg-surface shadow-sm">
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
          <div className="overflow-x-auto">
            <table className="dm-table min-w-full text-sm">
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
                  recipes.map((recipe, index) => {
                    const recipeKey = recipe.id ?? recipe._id ?? null
                    const isSelected = selectedRecipeId === recipeKey

                    return (
                      <tr
                        key={recipe.id ?? recipe._id}
                        className="border-t border-border"
                      >
                        <td className="px-5 py-4 text-sm text-muted">
                          {(page - 1) * ITEMS_PER_PAGE + index + 1}
                        </td>
                        <td className="px-5 py-4">{recipe.name}</td>
                        <td className="px-5 py-4">{recipe.category}</td>
                        <td className="px-5 py-4">
                          <span>{statusLabel(recipe.status)}</span>
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
              <h3 className="font-semibold text-foreground">
                Recipe Detail
              </h3>
              <p className="mt-1 text-xs text-muted">
                {selectedRecipe.name}
              </p>
              <p className="mt-2 text-sm text-muted">
                {selectedRecipe.description}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleCreateFromRecipe(selectedRecipe)}
                className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white shadow-sm"
              >
                Create menu from this recipe
              </button>
              <button
                type="button"
                onClick={() => handleEditRecipe(selectedRecipe)}
                className="rounded-md border border-border bg-background px-4 py-2 text-xs font-semibold text-primary"
              >
                Edit recipe
              </button>
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
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <MenuPhotoFrame
              size="lg"
              photoUrl={selectedRecipePhoto}
              onClick={
                selectedRecipeKey
                  ? () => openPhotoModal(selectedRecipeKey)
                  : undefined
              }
            />
            <div className="rounded-md border border-border bg-background p-4">
              <p className="text-xs text-muted">
                Category
              </p>
              <p className="mt-2 text-sm font-medium">
                {selectedRecipe.category}
              </p>
            </div>
            {/* TODO: Re-enable price card when pricing is finalized. */}
            {/* <div className="rounded-md border border-border bg-background p-4">
              <p className="text-xs text-muted">
                Price
              </p>
              <p className="mt-2 text-sm font-medium">
                IDR {selectedRecipe.price}
              </p>
            </div> */}
            <div className="rounded-md border border-border bg-background p-4">
              <p className="text-xs text-muted">
                Base pax
              </p>
              <p className="mt-2 text-sm font-medium">
                {selectedRecipe.portionSize}
              </p>
            </div>
          </div>

          <div className="mt-6">
            <h3 className="font-semibold text-foreground">
              Ingredients
            </h3>

            {selectedRecipeIngredients.length === 0 ? (
              <div className="mt-3 rounded-md border border-border bg-background p-4 text-sm text-muted">
                No ingredients for this recipe yet.
              </div>
            ) : (
              <div className="mt-3 overflow-x-auto rounded-md border border-border bg-white">
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
                    {selectedRecipeIngredients.map((ingredient, idx) => (
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

