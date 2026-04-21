import { useCallback, useEffect, useMemo, useState } from 'react'
import TablePagination from '../components/TablePagination'
import ChefCreateMenu, { type BaseRecipe } from './ChefCreateMenu'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'
import { getApprovalStatusLabel } from '../lib/status-labels'
import { formatUnitLabel } from '../lib/unit-of-measures'

type RecipeStatus = 'draft' | 'active'
type ApprovalStatus = 'pending' | 'approved' | 'rejected'
type CategoryStatusFilter = 'active' | 'disabled'

type RecipeIngredient = {
  productCode?: string
  name?: string
  unitOfMeasures?: string
  qty?: number
}

type Recipe = {
  id?: string
  _id?: string
  recipeCode?: string
  name: string
  category: string
  site?: string
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
  status: RecipeStatus
  approvalStatus: ApprovalStatus
  isActive?: boolean
  ingredients?: RecipeIngredient[]
}

type CategoryApi = {
  id?: string
  _id?: string
  name?: string
  isActive?: boolean
  createdAt?: string
}

type Category = {
  id: string
  name: string
  isActive: boolean
  createdAt: string
}

type SiteApi = {
  id?: string
  _id?: string
  name?: string
  code?: string
}

type SiteOption = {
  id: string
  name: string
  code: string
}

type TableMeta = {
  page: number
  limit: number
  total: number
  totalPages: number
  loading: boolean
  error: string
}

type CategoryForm = {
  name: string
  isActive: boolean
}

const DEFAULT_LIMIT = 10

const emptyMeta: TableMeta = {
  page: 1,
  limit: DEFAULT_LIMIT,
  total: 0,
  totalPages: 1,
  loading: false,
  error: '',
}

const emptyCategoryForm: CategoryForm = {
  name: '',
  isActive: true,
}

const recipeStatusLabel = (status: RecipeStatus) =>
  status === 'active' ? 'Active' : 'Draft'

const approvalStatusClass = (status: ApprovalStatus) => {
  if (status === 'approved') return 'text-primary'
  if (status === 'rejected') return 'text-danger'
  return 'text-muted'
}

const formatActorLabel = (name?: string, email?: string, fallback?: string) =>
  name?.trim() || email?.trim() || fallback?.trim() || 'Unknown'

const formatTimestamp = (value?: string) => {
  if (!value) return 'Unknown'
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return 'Unknown'
  return parsed.toLocaleString('en-GB')
}

const getRecipeKey = (recipe: Recipe) =>
  recipe.id ?? recipe._id ?? recipe.recipeCode ?? recipe.name

const mapCategory = (item: CategoryApi): Category => ({
  id: item.id ?? item._id ?? '',
  name: item.name ?? '',
  isActive: item.isActive ?? true,
  createdAt: item.createdAt ?? '',
})

const mapSite = (item: SiteApi): SiteOption => ({
  id: item.id ?? item._id ?? '',
  name: item.name ?? '',
  code: item.code ?? '',
})

const SuperadminMenuManagementPage = () => {
  const { accessToken } = useAuth()
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [recipeCategories, setRecipeCategories] = useState<string[]>([])
  const [siteOptions, setSiteOptions] = useState<SiteOption[]>([])
  const [recipeMeta, setRecipeMeta] = useState<TableMeta>(emptyMeta)
  const [recipeSearchInput, setRecipeSearchInput] = useState('')
  const [recipeSearch, setRecipeSearch] = useState('')
  const [recipeStatus, setRecipeStatus] = useState<'' | RecipeStatus>('')
  const [approvalStatus, setApprovalStatus] = useState<'' | ApprovalStatus>('')
  const [recipeCategory, setRecipeCategory] = useState('')
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null)
  const [recipeMessage, setRecipeMessage] = useState('')
  const [createRecipeOpen, setCreateRecipeOpen] = useState(false)
  const [editingRecipe, setEditingRecipe] = useState<BaseRecipe | null>(null)

  const [categories, setCategories] = useState<Category[]>([])
  const [categoryMeta, setCategoryMeta] = useState<TableMeta>(emptyMeta)
  const [categorySearchInput, setCategorySearchInput] = useState('')
  const [categorySearch, setCategorySearch] = useState('')
  const [categoryStatus, setCategoryStatus] =
    useState<CategoryStatusFilter>('active')
  const [categoryModalOpen, setCategoryModalOpen] = useState(false)
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(
    null,
  )
  const [categoryForm, setCategoryForm] =
    useState<CategoryForm>(emptyCategoryForm)
  const [categoryFormError, setCategoryFormError] = useState('')
  const [categoryMessage, setCategoryMessage] = useState('')

  const selectedRecipe = useMemo(
    () =>
      selectedRecipeId === null
        ? null
        : recipes.find((recipe) => getRecipeKey(recipe) === selectedRecipeId) ??
          null,
    [recipes, selectedRecipeId],
  )

  const selectedRecipeIngredients = selectedRecipe?.ingredients ?? []
  const siteNameByCode = useMemo(() => {
    const map = new Map<string, string>()
    siteOptions.forEach((site) => {
      if (site.code) map.set(site.code, site.name || site.code)
    })
    return map
  }, [siteOptions])
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

  const getRecipeSiteLabel = (recipe: Recipe) => {
    const siteCode = recipe.site?.trim()
    if (!siteCode) return 'All sites'
    return siteNameByCode.get(siteCode) ?? siteCode
  }

  const fetchSiteOptions = useCallback(async () => {
    if (!accessToken) {
      setSiteOptions([])
      return
    }

    try {
      const data = await apiFetch<{ items?: SiteApi[] }>(
        '/superadmin/sites?limit=100',
        undefined,
        accessToken,
      )
      setSiteOptions(
        (data.items ?? []).map(mapSite).filter((site) => site.id && site.code),
      )
    } catch {
      setSiteOptions([])
    }
  }, [accessToken])

  const fetchRecipeCategories = useCallback(async () => {
    if (!accessToken) {
      setRecipeCategories([])
      return
    }

    try {
      const data = await apiFetch<string[]>(
        '/recipes/categories',
        undefined,
        accessToken,
      )
      setRecipeCategories(data ?? [])
    } catch {
      setRecipeCategories([])
    }
  }, [accessToken])

  const fetchRecipes = useCallback(
    async (page = 1, limit = DEFAULT_LIMIT, searchValue = recipeSearch) => {
      if (!accessToken) {
        setRecipeMeta((prev) => ({
          ...prev,
          loading: false,
          error: 'Please log in first to load recipe data.',
        }))
        return
      }

      setRecipeMeta((prev) => ({ ...prev, loading: true, error: '' }))
      try {
        const params = new URLSearchParams()
        params.set('page', String(page))
        params.set('limit', String(limit))
        if (searchValue.trim()) params.set('search', searchValue.trim())
        if (recipeStatus) params.set('status', recipeStatus)
        if (approvalStatus) params.set('approvalStatus', approvalStatus)
        if (recipeCategory) params.set('category', recipeCategory)

        const data = await apiFetch<{
          items?: Recipe[]
          total?: number
          page?: number
          limit?: number
          totalPages?: number
        }>(`/recipes?${params.toString()}`, undefined, accessToken)

        const total = data.total ?? 0
        const nextLimit = data.limit ?? limit
        setRecipes(data.items ?? [])
        setRecipeMeta({
          page: data.page ?? page,
          limit: nextLimit,
          total,
          totalPages:
            data.totalPages ?? Math.max(1, Math.ceil(total / nextLimit)),
          loading: false,
          error: '',
        })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to load recipe data.'
        setRecipes([])
        setRecipeMeta((prev) => ({
          ...prev,
          loading: false,
          error: message,
        }))
      }
    },
    [accessToken, approvalStatus, recipeCategory, recipeSearch, recipeStatus],
  )

  const fetchCategories = useCallback(
    async (page = 1, limit = DEFAULT_LIMIT, searchValue = categorySearch) => {
      if (!accessToken) {
        setCategoryMeta((prev) => ({
          ...prev,
          loading: false,
          error: 'Please log in first to load categories.',
        }))
        return
      }

      setCategoryMeta((prev) => ({ ...prev, loading: true, error: '' }))
      try {
        const params = new URLSearchParams()
        params.set('page', String(page))
        params.set('limit', String(limit))
        params.set('isActive', categoryStatus === 'active' ? 'true' : 'false')
        if (searchValue.trim()) params.set('search', searchValue.trim())

        const data = await apiFetch<{
          items?: CategoryApi[]
          total?: number
          page?: number
          limit?: number
          totalPages?: number
        }>(`/categories?${params.toString()}`, undefined, accessToken)

        const total = data.total ?? 0
        const nextLimit = data.limit ?? limit
        setCategories(
          (data.items ?? []).map(mapCategory).filter((category) => category.id),
        )
        setCategoryMeta({
          page: data.page ?? page,
          limit: nextLimit,
          total,
          totalPages:
            data.totalPages ?? Math.max(1, Math.ceil(total / nextLimit)),
          loading: false,
          error: '',
        })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to load categories.'
        setCategories([])
        setCategoryMeta((prev) => ({
          ...prev,
          loading: false,
          error: message,
        }))
      }
    },
    [accessToken, categorySearch, categoryStatus],
  )

  useEffect(() => {
    fetchSiteOptions().catch(() => null)
  }, [fetchSiteOptions])

  useEffect(() => {
    fetchRecipeCategories().catch(() => null)
  }, [fetchRecipeCategories])

  useEffect(() => {
    fetchRecipes(1, DEFAULT_LIMIT, recipeSearch).catch(() => null)
  }, [fetchRecipes, recipeSearch])

  useEffect(() => {
    fetchCategories(1, DEFAULT_LIMIT, categorySearch).catch(() => null)
  }, [fetchCategories, categorySearch])

  const applyRecipeSearch = () => {
    setRecipeSearch(recipeSearchInput.trim())
    setRecipeMeta((prev) => ({ ...prev, page: 1 }))
  }

  const applyCategorySearch = () => {
    setCategorySearch(categorySearchInput.trim())
    setCategoryMeta((prev) => ({ ...prev, page: 1 }))
  }

  const toggleRecipeActive = async (recipe: Recipe) => {
    if (!accessToken) return
    const recipeId = recipe.id ?? recipe._id
    if (!recipeId) return

    const nextActive = !(recipe.isActive ?? true)
    try {
      await apiFetch(
        `/recipes/${recipeId}/active`,
        {
          method: 'PATCH',
          body: JSON.stringify({ isActive: nextActive }),
        },
        accessToken,
      )
      setRecipeMessage(nextActive ? 'Recipe enabled.' : 'Recipe disabled.')
      fetchRecipes(recipeMeta.page, recipeMeta.limit, recipeSearch).catch(
        () => null,
      )
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to update recipe.'
      setRecipeMeta((prev) => ({ ...prev, error: message }))
    }
  }

  const deleteRecipe = async (recipe: Recipe) => {
    if (!accessToken) return
    const recipeId = recipe.id ?? recipe._id
    if (!recipeId) return

    const ok = window.confirm(`Delete ${recipe.name}?`)
    if (!ok) return

    try {
      await apiFetch(`/recipes/${recipeId}`, { method: 'DELETE' }, accessToken)
      setRecipeMessage('Recipe deleted.')
      setSelectedRecipeId((current) =>
        current === getRecipeKey(recipe) ? null : current,
      )
      fetchRecipes(recipeMeta.page, recipeMeta.limit, recipeSearch).catch(
        () => null,
      )
      fetchRecipeCategories().catch(() => null)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to delete recipe.'
      setRecipeMeta((prev) => ({ ...prev, error: message }))
    }
  }

  const openEditRecipe = (recipe: Recipe) => {
    const recipeId = recipe.id ?? recipe._id
    if (!recipeId) return

    setEditingRecipe({
      id: recipeId,
      name: recipe.name,
      category: recipe.category,
      description: recipe.description ?? '',
      portionSize: recipe.portionSize,
      approvalStatus: recipe.approvalStatus,
      ingredients: (recipe.ingredients ?? []).map((ingredient) => ({
        productCode: ingredient.productCode ?? '',
        name: ingredient.name ?? '',
        unitOfMeasures: ingredient.unitOfMeasures ?? '',
        qty: Number.isFinite(Number(ingredient.qty))
          ? Number(ingredient.qty)
          : 0,
      })),
    })
  }

  const closeEditRecipe = () => {
    setEditingRecipe(null)
  }

  const handleRecipeSaved = (message: string) => {
    setRecipeMessage(message)
    fetchRecipes(recipeMeta.page, recipeMeta.limit, recipeSearch).catch(
      () => null,
    )
    fetchRecipeCategories().catch(() => null)
  }

  const approveRecipe = async (recipe: Recipe) => {
    if (!accessToken) return
    const recipeId = recipe.id ?? recipe._id
    if (!recipeId) return

    try {
      await apiFetch(`/recipes/${recipeId}/approve`, { method: 'PATCH' }, accessToken)
      handleRecipeSaved('Recipe approved.')
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to approve recipe.'
      setRecipeMeta((prev) => ({ ...prev, error: message }))
    }
  }

  const rejectRecipe = async (recipe: Recipe) => {
    if (!accessToken) return
    const recipeId = recipe.id ?? recipe._id
    if (!recipeId) return

    const reason = window.prompt(`Reject ${recipe.name}. Reason:`)?.trim()
    if (!reason) return

    try {
      await apiFetch(
        `/recipes/${recipeId}/reject`,
        {
          method: 'PATCH',
          body: JSON.stringify({ reason }),
        },
        accessToken,
      )
      handleRecipeSaved('Recipe rejected.')
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to reject recipe.'
      setRecipeMeta((prev) => ({ ...prev, error: message }))
    }
  }

  const openCreateCategory = () => {
    setEditingCategoryId(null)
    setCategoryForm(emptyCategoryForm)
    setCategoryFormError('')
    setCategoryMessage('')
    setCategoryModalOpen(true)
  }

  const startEditCategory = (category: Category) => {
    setEditingCategoryId(category.id)
    setCategoryForm({
      name: category.name,
      isActive: category.isActive,
    })
    setCategoryFormError('')
    setCategoryMessage('')
    setCategoryModalOpen(true)
  }

  const closeCategoryModal = () => {
    setCategoryModalOpen(false)
    setEditingCategoryId(null)
    setCategoryFormError('')
  }

  const updateCategoryForm = (
    field: keyof CategoryForm,
    value: string | boolean,
  ) => {
    setCategoryForm((prev) => ({ ...prev, [field]: value }))
  }

  const saveCategory = async () => {
    if (!accessToken) return
    const name = categoryForm.name.trim()
    if (!name) {
      setCategoryFormError('Category name is required.')
      return
    }

    try {
      if (editingCategoryId) {
        await apiFetch(
          `/categories/${editingCategoryId}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              name,
              isActive: categoryForm.isActive,
            }),
          },
          accessToken,
        )
        setCategoryMessage('Category updated.')
      } else {
        await apiFetch(
          '/categories',
          {
            method: 'POST',
            body: JSON.stringify({
              name,
              isActive: categoryForm.isActive,
            }),
          },
          accessToken,
        )
        setCategoryMessage('Category created.')
      }

      closeCategoryModal()
      fetchCategories(categoryMeta.page, categoryMeta.limit, categorySearch).catch(
        () => null,
      )
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to save category.'
      setCategoryFormError(message)
    }
  }

  const toggleCategoryStatus = async (category: Category) => {
    if (!accessToken) return
    try {
      await apiFetch(
        `/categories/${category.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ isActive: !category.isActive }),
        },
        accessToken,
      )
      setCategoryMessage(
        category.isActive ? 'Category disabled.' : 'Category activated.',
      )
      fetchCategories(categoryMeta.page, categoryMeta.limit, categorySearch).catch(
        () => null,
      )
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to update category.'
      setCategoryMeta((prev) => ({ ...prev, error: message }))
    }
  }

  return (
    <div className="w-full py-2">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Menu Management</h1>
          <p className="mt-1 text-sm text-muted">
            View recipe data and manage menu categories from one workspace.
          </p>
        </div>

        {categoryModalOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div
              className="w-full max-w-lg rounded-md border border-border bg-surface p-6 shadow-xl"
              role="dialog"
              aria-modal="true"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-foreground">
                    {editingCategoryId ? 'Edit category' : 'Create category'}
                  </h3>
                  <p className="mt-1 text-xs text-muted">Category data</p>
                </div>
                <button
                  type="button"
                  onClick={closeCategoryModal}
                  className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-primary"
                >
                  Close
                </button>
              </div>

              <div className="mt-5 space-y-4">
                <div>
                  <label className="text-sm font-medium text-foreground">
                    Category name
                  </label>
                  <input
                    type="text"
                    value={categoryForm.name}
                    onChange={(event) =>
                      updateCategoryForm('name', event.target.value)
                    }
                    className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-2 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                  />
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={categoryForm.isActive}
                    onChange={(event) =>
                      updateCategoryForm('isActive', event.target.checked)
                    }
                    className="h-4 w-4 rounded border-border text-primary focus:ring-accent-blue"
                  />
                  Active
                </label>
                {categoryFormError ? (
                  <p className="text-xs font-medium text-red-600">
                    {categoryFormError}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={saveCategory}
                    className="flex-1 rounded-md bg-primary px-4 py-3 text-sm font-semibold text-white"
                  >
                    {editingCategoryId ? 'Save category' : 'Create category'}
                  </button>
                  <button
                    type="button"
                    onClick={closeCategoryModal}
                    className="rounded-md border border-border bg-background px-4 py-3 text-sm font-semibold text-primary"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {createRecipeOpen ? (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
            <div
              className="my-6 w-full max-w-6xl rounded-md border border-border bg-surface p-6 shadow-xl"
              role="dialog"
              aria-modal="true"
            >
              <ChefCreateMenu
                embedded
                onClose={() => setCreateRecipeOpen(false)}
                onSaved={() => {
                  handleRecipeSaved('Recipe created.')
                }}
              />
            </div>
          </div>
        ) : null}

        {editingRecipe ? (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
            <div
              className="my-6 w-full max-w-6xl rounded-md border border-border bg-surface p-6 shadow-xl"
              role="dialog"
              aria-modal="true"
            >
              <ChefCreateMenu
                embedded
                baseRecipe={editingRecipe}
                onClose={closeEditRecipe}
                onSaved={() => {
                  handleRecipeSaved('Recipe updated.')
                }}
              />
            </div>
          </div>
        ) : null}

        <section className="rounded-md border border-border bg-surface shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold">Recipe Data</h2>
              <p className="mt-1 text-xs text-muted">
                Recipes created by chef and reviewed through the approval flow.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setCreateRecipeOpen(true)}
                className="rounded-md border border-border bg-background px-4 py-2 text-xs font-semibold text-primary"
              >
                <span className="flex items-center gap-2">
                  <i className="bi bi-plus-circle text-base" aria-hidden="true" />
                  <span>Create recipe</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() =>
                  fetchRecipes(recipeMeta.page, recipeMeta.limit, recipeSearch)
                }
                aria-label="Refresh recipe data"
                title="Refresh recipe data"
                className="rounded-md border border-border bg-background p-2 text-primary"
              >
                <i className="bi bi-arrow-clockwise text-base" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-4">
            <input
              type="search"
              value={recipeSearchInput}
              onChange={(event) => setRecipeSearchInput(event.target.value)}
              placeholder="Search recipe"
              className="w-56 rounded-2xl border border-border bg-white px-4 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
            />
            <button
              type="button"
              onClick={applyRecipeSearch}
              className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white"
            >
              Search
            </button>
            <select
              value={recipeCategory}
              onChange={(event) => {
                setRecipeCategory(event.target.value)
                setRecipeMeta((prev) => ({ ...prev, page: 1 }))
              }}
              className="rounded-2xl border border-border bg-white px-4 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
            >
              <option value="">All categories</option>
              {recipeCategories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
            <select
              value={recipeStatus}
              onChange={(event) => {
                setRecipeStatus(event.target.value as '' | RecipeStatus)
                setRecipeMeta((prev) => ({ ...prev, page: 1 }))
              }}
              className="rounded-2xl border border-border bg-white px-4 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
            >
              <option value="">All recipe status</option>
              <option value="draft">Draft</option>
              <option value="active">Active</option>
            </select>
            <select
              value={approvalStatus}
              onChange={(event) => {
                setApprovalStatus(event.target.value as '' | ApprovalStatus)
                setRecipeMeta((prev) => ({ ...prev, page: 1 }))
              }}
              className="rounded-2xl border border-border bg-white px-4 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
            >
              <option value="">All approval status</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>

          <TablePagination
            page={recipeMeta.page}
            totalPages={recipeMeta.totalPages}
            loading={recipeMeta.loading}
            summary={`Showing ${recipes.length} of ${recipeMeta.total} recipes`}
            onPageChange={(page) =>
              fetchRecipes(page, recipeMeta.limit, recipeSearch)
            }
            className="border-b border-border bg-white px-5 py-4"
          />

          <div className="max-w-full overflow-x-auto">
            <table className="dm-table min-w-full text-sm">
              <thead className="bg-background">
                <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                  <th className="w-16 px-5 py-4 font-semibold">No</th>
                  <th className="px-5 py-4 font-semibold">Recipe Code</th>
                  <th className="px-5 py-4 font-semibold">Name</th>
                  <th className="px-5 py-4 font-semibold">Category</th>
                  <th className="px-5 py-4 font-semibold">Sites</th>
                  <th className="px-5 py-4 font-semibold">Recipe Status</th>
                  <th className="px-5 py-4 font-semibold">Approval Status</th>
                  <th className="px-5 py-4 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {recipeMeta.loading ? (
                  <tr className="border-t border-border">
                    <td colSpan={8} className="px-5 py-10 text-center text-muted">
                      Loading recipe data...
                    </td>
                  </tr>
                ) : recipes.length === 0 ? (
                  <tr className="border-t border-border">
                    <td colSpan={8} className="px-5 py-10 text-center text-muted">
                      {recipeMeta.error ? recipeMeta.error : 'No recipes found.'}
                    </td>
                  </tr>
                ) : (
                  recipes.map((recipe, index) => {
                    const recipeKey = getRecipeKey(recipe)
                    const isSelected = selectedRecipeId === recipeKey
                    const isRecipeEnabled = recipe.isActive ?? true

                    return (
                      <tr key={recipeKey} className="border-t border-border">
                        <td className="px-5 py-4 text-sm text-muted">
                          {(recipeMeta.page - 1) * recipeMeta.limit + index + 1}
                        </td>
                        <td className="px-5 py-4 font-medium">
                          {recipe.recipeCode ?? '-'}
                        </td>
                        <td className="px-5 py-4">{recipe.name}</td>
                        <td className="px-5 py-4">{recipe.category || '-'}</td>
                        <td className="px-5 py-4">{getRecipeSiteLabel(recipe)}</td>
                        <td className="px-5 py-4">
                          {isRecipeEnabled
                            ? recipeStatusLabel(recipe.status)
                            : 'Disabled'}
                        </td>
                        <td className="px-5 py-4">
                          <span
                            className={`font-medium ${approvalStatusClass(
                              recipe.approvalStatus,
                            )}`}
                          >
                            {getApprovalStatusLabel(recipe.approvalStatus)}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setSelectedRecipeId((prev) =>
                                  prev === recipeKey ? null : recipeKey,
                                )
                              }
                              className="rounded-md border border-primary bg-primary-soft px-3 py-1 text-xs font-semibold text-primary hover:bg-primary-soft/80"
                            >
                              <span className="flex items-center gap-1.5">
                                <i
                                  className={`bi ${isSelected ? 'bi-eye-slash' : 'bi-eye'} text-sm`}
                                  aria-hidden="true"
                                />
                                <span>{isSelected ? 'Hide' : 'Details'}</span>
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditRecipe(recipe)}
                              className="rounded-md border border-border bg-background px-3 py-1 text-xs font-semibold text-primary"
                            >
                              <span className="flex items-center gap-1.5">
                                <i className="bi bi-pencil-square text-sm" aria-hidden="true" />
                                <span>Edit</span>
                              </span>
                            </button>
                            {recipe.approvalStatus === 'pending' ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => approveRecipe(recipe)}
                                  className="rounded-md border border-success bg-background px-3 py-1 text-xs font-semibold text-success"
                                >
                                  <span className="flex items-center gap-1.5">
                                    <i className="bi bi-check2-circle text-sm" aria-hidden="true" />
                                    <span>Approve</span>
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => rejectRecipe(recipe)}
                                  className="rounded-md border border-warning bg-background px-3 py-1 text-xs font-semibold text-warning"
                                >
                                  <span className="flex items-center gap-1.5">
                                    <i className="bi bi-x-circle text-sm" aria-hidden="true" />
                                    <span>Reject</span>
                                  </span>
                                </button>
                              </>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => toggleRecipeActive(recipe)}
                              className="rounded-md border border-primary/60 bg-background px-3 py-1 text-xs font-semibold text-primary"
                            >
                              {isRecipeEnabled ? 'Disable' : 'Enable'}
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteRecipe(recipe)}
                              className="rounded-md border border-danger bg-background px-3 py-1 text-xs font-semibold text-danger"
                            >
                              <span className="flex items-center gap-1.5">
                                <i className="bi bi-trash text-sm" aria-hidden="true" />
                                <span>Delete</span>
                              </span>
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
          {recipeMessage ? (
            <p className="px-5 pb-2 text-xs font-medium text-primary">
              {recipeMessage}
            </p>
          ) : null}
          {recipeMeta.error && recipes.length > 0 ? (
            <p className="px-5 pb-2 text-xs font-medium text-red-600">
              {recipeMeta.error}
            </p>
          ) : null}
        </section>

        {selectedRecipe ? (
          <section className="rounded-md border border-border bg-surface p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Recipe Detail</h2>
                <p className="mt-1 text-xs text-muted">
                  Code: {selectedRecipe.recipeCode ?? '-'}
                </p>
                <p className="mt-1 text-xs text-muted">{selectedRecipe.name}</p>
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

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-border bg-background p-4">
                <p className="text-xs text-muted">Category</p>
                <p className="mt-2 text-sm font-medium">
                  {selectedRecipe.category || '-'}
                </p>
              </div>
              <div className="rounded-md border border-border bg-background p-4">
                <p className="text-xs text-muted">Created from site</p>
                <p className="mt-2 text-sm font-medium">
                  {getRecipeSiteLabel(selectedRecipe)}
                </p>
              </div>
              <div className="rounded-md border border-border bg-background p-4">
                <p className="text-xs text-muted">Base pax</p>
                <p className="mt-2 text-sm font-medium">
                  {selectedRecipe.portionSize}
                </p>
              </div>
              <div className="rounded-md border border-border bg-background p-4">
                <p className="text-xs text-muted">Approval status</p>
                <p
                  className={`mt-2 text-sm font-medium ${approvalStatusClass(
                    selectedRecipe.approvalStatus,
                  )}`}
                >
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
                          <td className="px-4 py-3 text-sm text-muted">
                            {index + 1}
                          </td>
                          <td className="px-4 py-3">
                            {ingredient.productCode || '-'}
                          </td>
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
                  <span className="font-medium text-foreground">
                    Last updated by
                  </span>{' '}
                  {updatedByLabel} |{' '}
                  {formatTimestamp(
                    selectedRecipe.updatedAt ?? selectedRecipe.createdAt,
                  )}
                </p>
              </div>
            </div>
          </section>
        ) : null}

        <section className="rounded-md border border-border bg-surface shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold">Categories</h2>
              <p className="mt-1 text-xs text-muted">
                Categories used to group menu data.
              </p>
            </div>
            <button
              type="button"
              onClick={openCreateCategory}
              className="rounded-md border border-border bg-background px-4 py-2 text-xs font-semibold text-primary"
            >
              <span className="flex items-center gap-2">
                <i className="bi bi-tags text-base" aria-hidden="true" />
                <span>Create category</span>
              </span>
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={categorySearchInput}
                onChange={(event) => setCategorySearchInput(event.target.value)}
                placeholder="Search category"
                className="w-56 rounded-2xl border border-border bg-white px-4 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
              />
              <button
                type="button"
                onClick={applyCategorySearch}
                className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white"
              >
                Search
              </button>
              <select
                value={categoryStatus}
                onChange={(event) => {
                  setCategoryStatus(event.target.value as CategoryStatusFilter)
                  setCategoryMeta((prev) => ({ ...prev, page: 1 }))
                }}
                className="rounded-2xl border border-border bg-white px-4 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
              >
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>
            </div>
            <button
              type="button"
              onClick={() =>
                fetchCategories(categoryMeta.page, categoryMeta.limit, categorySearch)
              }
              aria-label="Refresh categories"
              title="Refresh categories"
              className="rounded-md border border-border bg-background p-2 text-primary"
            >
              <i className="bi bi-arrow-clockwise text-base" aria-hidden="true" />
            </button>
          </div>

          <TablePagination
            page={categoryMeta.page}
            totalPages={categoryMeta.totalPages}
            loading={categoryMeta.loading}
            summary={`Showing ${categories.length} of ${categoryMeta.total} categories`}
            onPageChange={(page) =>
              fetchCategories(page, categoryMeta.limit, categorySearch)
            }
            className="border-b border-border bg-white px-5 py-4"
          />

          <div className="max-w-full overflow-x-auto">
            <table className="dm-table min-w-full text-sm">
              <thead className="bg-background">
                <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                  <th className="w-16 px-5 py-4 font-semibold">No</th>
                  <th className="px-5 py-4 font-semibold">Category Name</th>
                  <th className="px-5 py-4 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {categoryMeta.loading ? (
                  <tr className="border-t border-border">
                    <td colSpan={3} className="px-5 py-10 text-center text-muted">
                      Loading categories...
                    </td>
                  </tr>
                ) : categories.length === 0 ? (
                  <tr className="border-t border-border">
                    <td colSpan={3} className="px-5 py-10 text-center text-muted">
                      {categoryMeta.error
                        ? categoryMeta.error
                        : 'No categories found.'}
                    </td>
                  </tr>
                ) : (
                  categories.map((category, index) => (
                    <tr key={category.id} className="border-t border-border">
                      <td className="px-5 py-4 text-sm text-muted">
                        {(categoryMeta.page - 1) * categoryMeta.limit +
                          index +
                          1}
                      </td>
                      <td className="px-5 py-4 font-medium text-foreground">
                        {category.name}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => startEditCategory(category)}
                            className="rounded-md border border-border bg-background p-2 text-muted transition hover:bg-primary-soft hover:text-primary"
                            aria-label="Edit category"
                            title="Edit category"
                          >
                            <i className="bi bi-pencil-square text-base" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleCategoryStatus(category)}
                            className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-primary"
                          >
                            {category.isActive ? 'Disable' : 'Activate'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {categoryMessage ? (
            <p className="px-5 pb-2 text-xs font-medium text-primary">
              {categoryMessage}
            </p>
          ) : null}
          {categoryMeta.error && categories.length > 0 ? (
            <p className="px-5 pb-2 text-xs font-medium text-red-600">
              {categoryMeta.error}
            </p>
          ) : null}
        </section>
      </div>
    </div>
  )
}

export default SuperadminMenuManagementPage
