import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
} from 'react'
import TablePagination from '../components/TablePagination'
import ChefCreateMenu, { type BaseRecipe } from './ChefCreateMenu'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'
import { getApprovalStatusLabel } from '../lib/status-labels'
import { formatUnitLabel, unitOfMeasuresOptions } from '../lib/unit-of-measures'

type RecipeStatus = 'draft' | 'active'
type ApprovalStatus = 'pending' | 'approved' | 'rejected'
type CategoryStatusFilter = 'active' | 'disabled'
type MenuManagementTab = 'recipes' | 'raw-materials' | 'categories'

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

type RawMaterialApi = {
  id?: string
  _id?: string
  productCode?: string
  name?: string
  unitOfMeasures?: string
  createdAt?: string
}

type RawMaterial = {
  id: string
  productCode: string
  name: string
  unitOfMeasures: string
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

type RawMaterialForm = {
  productCode: string
  name: string
  unitOfMeasures: string
}

type NotificationItem = {
  id?: string
  _id?: string
  title?: string
  message?: string
  meta?: Record<string, unknown>
  createdAt?: string
}

type ImportResult = {
  status: 'success' | 'error'
  title: string
  message: string
}

const DEFAULT_LIMIT = 10

const menuManagementTabs: Array<{
  id: MenuManagementTab
  label: string
  icon: string
}> = [
  { id: 'recipes', label: 'Recipe Data', icon: 'bi-journal-text' },
  { id: 'raw-materials', label: 'Raw Material Data', icon: 'bi-box-seam' },
  { id: 'categories', label: 'Categories', icon: 'bi-tags' },
]

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

const emptyRawMaterialForm: RawMaterialForm = {
  productCode: '',
  name: '',
  unitOfMeasures: '',
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

const mapRawMaterial = (item: RawMaterialApi): RawMaterial => ({
  id: item.id ?? item._id ?? '',
  productCode: item.productCode ?? '',
  name: item.name ?? '',
  unitOfMeasures: item.unitOfMeasures ?? '',
  createdAt: item.createdAt ?? '',
})

const mapSite = (item: SiteApi): SiteOption => ({
  id: item.id ?? item._id ?? '',
  name: item.name ?? '',
  code: item.code ?? '',
})

const SuperadminMenuManagementPage = () => {
  const { accessToken } = useAuth()
  const [activeTab, setActiveTab] = useState<MenuManagementTab>('recipes')
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
  const [recipeImportOpen, setRecipeImportOpen] = useState(false)
  const [recipeImportFile, setRecipeImportFile] = useState<File | null>(null)
  const [recipeImportError, setRecipeImportError] = useState('')
  const [recipeImportMessage, setRecipeImportMessage] = useState('')
  const [recipeImporting, setRecipeImporting] = useState(false)

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

  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([])
  const [rawMaterialMeta, setRawMaterialMeta] = useState<TableMeta>(emptyMeta)
  const [rawMaterialSearchInput, setRawMaterialSearchInput] = useState('')
  const [rawMaterialSearch, setRawMaterialSearch] = useState('')
  const [rawMaterialModalOpen, setRawMaterialModalOpen] = useState(false)
  const [editingRawMaterialId, setEditingRawMaterialId] = useState<
    string | null
  >(null)
  const [rawMaterialForm, setRawMaterialForm] =
    useState<RawMaterialForm>(emptyRawMaterialForm)
  const [rawMaterialFormError, setRawMaterialFormError] = useState('')
  const [rawMaterialMessage, setRawMaterialMessage] = useState('')
  const [rawMaterialImportOpen, setRawMaterialImportOpen] = useState(false)
  const [rawMaterialImportFile, setRawMaterialImportFile] =
    useState<File | null>(null)
  const [rawMaterialImportError, setRawMaterialImportError] = useState('')
  const [rawMaterialImportMessage, setRawMaterialImportMessage] = useState('')
  const [rawMaterialImporting, setRawMaterialImporting] = useState(false)
  const [rawMaterialImportStartedAt, setRawMaterialImportStartedAt] =
    useState<number | null>(null)
  const [rawMaterialImportResult, setRawMaterialImportResult] =
    useState<ImportResult | null>(null)

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

  const fetchRawMaterials = useCallback(
    async (
      page = 1,
      limit = DEFAULT_LIMIT,
      searchValue = rawMaterialSearch,
    ) => {
      if (!accessToken) {
        setRawMaterialMeta((prev) => ({
          ...prev,
          loading: false,
          error: 'Please log in first to load raw material data.',
        }))
        return
      }

      setRawMaterialMeta((prev) => ({ ...prev, loading: true, error: '' }))
      try {
        const params = new URLSearchParams()
        params.set('page', String(page))
        params.set('limit', String(limit))
        if (searchValue.trim()) params.set('search', searchValue.trim())

        const data = await apiFetch<{
          items?: RawMaterialApi[]
          total?: number
          page?: number
          limit?: number
          totalPages?: number
        }>(`/raw-materials?${params.toString()}`, undefined, accessToken)

        const total = data.total ?? 0
        const nextLimit = data.limit ?? limit
        setRawMaterials(
          (data.items ?? [])
            .map(mapRawMaterial)
            .filter((rawMaterial) => rawMaterial.id),
        )
        setRawMaterialMeta({
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
          error instanceof Error
            ? error.message
            : 'Failed to load raw material data.'
        setRawMaterials([])
        setRawMaterialMeta((prev) => ({
          ...prev,
          loading: false,
          error: message,
        }))
      }
    },
    [accessToken, rawMaterialSearch],
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

  useEffect(() => {
    fetchRawMaterials(1, DEFAULT_LIMIT, rawMaterialSearch).catch(() => null)
  }, [fetchRawMaterials, rawMaterialSearch])

  const applyRecipeSearch = () => {
    setRecipeSearch(recipeSearchInput.trim())
    setRecipeMeta((prev) => ({ ...prev, page: 1 }))
  }

  const applyCategorySearch = () => {
    setCategorySearch(categorySearchInput.trim())
    setCategoryMeta((prev) => ({ ...prev, page: 1 }))
  }

  const applyRawMaterialSearch = () => {
    setRawMaterialSearch(rawMaterialSearchInput.trim())
    setRawMaterialMeta((prev) => ({ ...prev, page: 1 }))
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
      setRecipes((prev) =>
        prev.map((item) =>
          (item.id ?? item._id) === recipeId
            ? { ...item, isActive: nextActive }
            : item,
        ),
      )
      setRecipeMeta((prev) => ({ ...prev, error: '' }))
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

  const openRecipeImportModal = () => {
    setRecipeImportError('')
    setRecipeImportMessage('')
    setRecipeImportOpen(true)
  }

  const closeRecipeImportModal = () => {
    if (recipeImporting) return
    setRecipeImportOpen(false)
  }

  const handleRecipeImportFileChange = (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const nextFile = event.target.files?.[0] ?? null
    setRecipeImportMessage('')

    if (!nextFile) {
      setRecipeImportFile(null)
      setRecipeImportError('')
      return
    }

    const isExcelFile = /\.(xlsx|xls)$/i.test(nextFile.name)
    if (!isExcelFile) {
      setRecipeImportFile(null)
      setRecipeImportError('File must be .xlsx or .xls')
      return
    }

    setRecipeImportFile(nextFile)
    setRecipeImportError('')
  }

  const handleImportRecipes = async () => {
    if (!accessToken) return
    if (!recipeImportFile) {
      setRecipeImportError('Select an Excel file first.')
      setRecipeImportMessage('')
      return
    }

    setRecipeImporting(true)
    setRecipeImportError('')
    setRecipeImportMessage('')

    try {
      const formData = new FormData()
      formData.append('file', recipeImportFile)
      const result = await apiFetch<{ insertedCount?: number }>(
        '/recipes/import',
        {
          method: 'POST',
          body: formData,
        },
        accessToken,
      )
      const insertedCount = result.insertedCount ?? 0
      setRecipeImportMessage(
        `${insertedCount} recipes imported from ${recipeImportFile.name}`,
      )
      setRecipeImportFile(null)
      fetchRecipes(1, recipeMeta.limit, recipeSearch).catch(() => null)
      fetchRecipeCategories().catch(() => null)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to import recipes.'
      setRecipeImportError(message)
      setRecipeImportMessage('')
    } finally {
      setRecipeImporting(false)
    }
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
    const nextActive = !category.isActive
    try {
      await apiFetch(
        `/categories/${category.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ isActive: nextActive }),
        },
        accessToken,
      )
      setCategoryMessage(
        category.isActive ? 'Category disabled.' : 'Category activated.',
      )
      setCategories((prev) =>
        prev
          .map((item) =>
            item.id === category.id ? { ...item, isActive: nextActive } : item,
          )
          .filter((item) =>
            categoryStatus === 'active' ? item.isActive : !item.isActive,
          ),
      )
      setCategoryMeta((prev) => ({
        ...prev,
        total: Math.max(0, prev.total - 1),
        error: '',
      }))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to update category.'
      setCategoryMeta((prev) => ({ ...prev, error: message }))
    }
  }

  const openCreateRawMaterial = () => {
    setEditingRawMaterialId(null)
    setRawMaterialForm(emptyRawMaterialForm)
    setRawMaterialFormError('')
    setRawMaterialMessage('')
    setRawMaterialModalOpen(true)
  }

  const startEditRawMaterial = (rawMaterial: RawMaterial) => {
    setEditingRawMaterialId(rawMaterial.id)
    setRawMaterialForm({
      productCode: rawMaterial.productCode,
      name: rawMaterial.name,
      unitOfMeasures: rawMaterial.unitOfMeasures,
    })
    setRawMaterialFormError('')
    setRawMaterialMessage('')
    setRawMaterialModalOpen(true)
  }

  const closeRawMaterialModal = () => {
    setRawMaterialModalOpen(false)
    setEditingRawMaterialId(null)
    setRawMaterialFormError('')
  }

  const updateRawMaterialForm = (
    field: keyof RawMaterialForm,
    value: string,
  ) => {
    setRawMaterialForm((prev) => ({ ...prev, [field]: value }))
  }

  const saveRawMaterial = async () => {
    if (!accessToken) return
    const payload = {
      productCode: rawMaterialForm.productCode.trim(),
      name: rawMaterialForm.name.trim(),
      unitOfMeasures: rawMaterialForm.unitOfMeasures.trim(),
    }

    if (!payload.productCode || !payload.name || !payload.unitOfMeasures) {
      setRawMaterialFormError('Please complete all raw material fields first.')
      return
    }

    try {
      if (editingRawMaterialId) {
        await apiFetch(
          `/raw-materials/${editingRawMaterialId}`,
          {
            method: 'PATCH',
            body: JSON.stringify(payload),
          },
          accessToken,
        )
        setRawMaterialMessage('Raw material updated.')
      } else {
        await apiFetch(
          '/raw-materials',
          {
            method: 'POST',
            body: JSON.stringify(payload),
          },
          accessToken,
        )
        setRawMaterialMessage('Raw material created.')
      }

      closeRawMaterialModal()
      fetchRawMaterials(
        rawMaterialMeta.page,
        rawMaterialMeta.limit,
        rawMaterialSearch,
      ).catch(() => null)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to save raw material.'
      setRawMaterialFormError(message)
    }
  }

  const deleteRawMaterial = async (rawMaterial: RawMaterial) => {
    if (!accessToken) return
    const ok = window.confirm(
      `Delete ${rawMaterial.name}? This is only allowed when the material is not used by any recipe.`,
    )
    if (!ok) return

    try {
      await apiFetch(
        `/raw-materials/${rawMaterial.id}`,
        { method: 'DELETE' },
        accessToken,
      )
      setRawMaterialMessage('Raw material deleted.')
      fetchRawMaterials(
        rawMaterialMeta.page,
        rawMaterialMeta.limit,
        rawMaterialSearch,
      ).catch(() => null)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to delete raw material.'
      setRawMaterialMeta((prev) => ({ ...prev, error: message }))
    }
  }

  const openRawMaterialImportModal = () => {
    setRawMaterialImportError('')
    setRawMaterialImportMessage('')
    setRawMaterialImportResult(null)
    setRawMaterialImportOpen(true)
  }

  const closeRawMaterialImportModal = () => {
    if (rawMaterialImporting) return
    setRawMaterialImportOpen(false)
  }

  const closeRawMaterialImportResult = () => {
    setRawMaterialImportResult(null)
  }

  const handleRawMaterialImportFileChange = (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const nextFile = event.target.files?.[0] ?? null
    setRawMaterialImportMessage('')

    if (!nextFile) {
      setRawMaterialImportFile(null)
      setRawMaterialImportError('')
      return
    }

    const isValidFile = /\.(xlsx|xls|csv)$/i.test(nextFile.name)
    if (!isValidFile) {
      setRawMaterialImportFile(null)
      setRawMaterialImportError('File must be .xlsx, .xls, or .csv')
      return
    }

    setRawMaterialImportFile(nextFile)
    setRawMaterialImportError('')
  }

  const handleImportRawMaterials = async () => {
    if (!accessToken) return
    if (!rawMaterialImportFile) {
      setRawMaterialImportError('Select an Excel or CSV file first.')
      setRawMaterialImportMessage('')
      return
    }

    if (rawMaterialImporting) return

    setRawMaterialImporting(true)
    setRawMaterialImportError('')
    setRawMaterialImportMessage('Starting import...')
    setRawMaterialImportResult(null)

    try {
      const formData = new FormData()
      formData.append('file', rawMaterialImportFile)
      await apiFetch<{ jobId: string }>(
        '/imports/raw-materials/upload',
        {
          method: 'POST',
          body: formData,
        },
        accessToken,
      )
      setRawMaterialImportStartedAt(Date.now())
      setRawMaterialImportMessage('Import started. Waiting for completion...')
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to start raw material import.'
      setRawMaterialImportError(message)
      setRawMaterialImportMessage('')
      setRawMaterialImporting(false)
      setRawMaterialImportStartedAt(null)
    }
  }

  useEffect(() => {
    if (!rawMaterialImporting || !rawMaterialImportStartedAt || !accessToken) {
      return
    }

    let cancelled = false
    let timeoutId: number | undefined

    const pollStatus = async () => {
      try {
        const notifications = await apiFetch<NotificationItem[]>(
          '/notifications?page=1&limit=25',
          undefined,
          accessToken,
        )
        if (cancelled) return

        const match = notifications.find((item) => {
          if (!item?.title || !item.createdAt) return false
          if (
            item.title !== 'Raw material import completed' &&
            item.title !== 'Raw material import failed'
          ) {
            return false
          }
          const createdAt = new Date(item.createdAt).getTime()
          return (
            Number.isFinite(createdAt) &&
            createdAt >= rawMaterialImportStartedAt
          )
        })

        if (match) {
          const isSuccess = match.title === 'Raw material import completed'
          let message = match.message ?? ''
          if (!isSuccess) {
            const reason =
              match.meta && typeof match.meta.reason === 'string'
                ? match.meta.reason
                : ''
            if (reason) message = `${message} (${reason})`
          }

          setRawMaterialImportResult({
            status: isSuccess ? 'success' : 'error',
            title: match.title ?? 'Import finished',
            message: message || 'Import finished.',
          })
          setRawMaterialImporting(false)
          setRawMaterialImportOpen(false)
          setRawMaterialImportError('')
          setRawMaterialImportMessage('')
          setRawMaterialImportFile(null)
          setRawMaterialImportStartedAt(null)
          if (isSuccess) {
            fetchRawMaterials(1, rawMaterialMeta.limit, rawMaterialSearch).catch(
              () => null,
            )
          }
          return
        }
      } catch (error) {
        if (cancelled) return
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to check import status.'
        setRawMaterialImportResult({
          status: 'error',
          title: 'Import failed',
          message,
        })
        setRawMaterialImporting(false)
        setRawMaterialImportOpen(false)
        setRawMaterialImportMessage('')
        setRawMaterialImportStartedAt(null)
        return
      }

      if (!cancelled) {
        timeoutId = window.setTimeout(pollStatus, 2000)
      }
    }

    timeoutId = window.setTimeout(pollStatus, 2000)

    return () => {
      cancelled = true
      if (timeoutId) window.clearTimeout(timeoutId)
    }
  }, [
    accessToken,
    fetchRawMaterials,
    rawMaterialImporting,
    rawMaterialImportStartedAt,
    rawMaterialMeta.limit,
    rawMaterialSearch,
  ])

  return (
    <div className="w-full py-2">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Menu Management</h1>
          <p className="mt-1 text-sm text-muted">
            Manage recipe, raw material, and category data from one workspace.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-border">
          {menuManagementTabs.map((tab) => {
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition ${
                  active
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted hover:text-primary'
                }`}
              >
                <i className={`bi ${tab.icon} text-base`} aria-hidden="true" />
                <span>{tab.label}</span>
              </button>
            )
          })}
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

        {recipeImportOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div
              className="w-full max-w-xl rounded-md border border-border bg-surface p-6 shadow-xl"
              role="dialog"
              aria-modal="true"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-foreground">
                    Import Recipe
                  </h3>
                  <p className="mt-1 text-xs text-muted">
                    Import recipes from Excel
                  </p>
                  <p className="mt-2 text-sm text-muted">
                    Use .xlsx or .xls to import multiple recipes at once.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeRecipeImportModal}
                  disabled={recipeImporting}
                  className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Close
                </button>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto]">
                <div>
                  <label className="text-sm font-medium text-foreground">
                    File Excel
                  </label>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleRecipeImportFileChange}
                    disabled={recipeImporting}
                    className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-2 text-sm shadow-sm file:mr-4 file:rounded-xl file:border-0 file:bg-primary-soft file:px-3 file:py-2 file:text-xs file:font-semibold file:text-primary"
                  />
                  {recipeImportFile ? (
                    <p className="mt-2 text-xs text-muted">
                      Selected file: {recipeImportFile.name}
                    </p>
                  ) : null}
                  {recipeImportError ? (
                    <p className="mt-2 text-xs font-medium text-red-600">
                      {recipeImportError}
                    </p>
                  ) : null}
                  {recipeImportMessage ? (
                    <p className="mt-2 text-xs font-medium text-primary">
                      {recipeImportMessage}
                    </p>
                  ) : null}
                </div>

                <button
                  type="button"
                  onClick={handleImportRecipes}
                  disabled={recipeImporting}
                  className="h-fit self-end rounded-md border border-border bg-background px-4 py-3 text-sm font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {recipeImporting ? 'Importing...' : 'Import recipes'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {rawMaterialModalOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div
              className="w-full max-w-2xl rounded-md border border-border bg-surface p-6 shadow-xl"
              role="dialog"
              aria-modal="true"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-foreground">
                    {editingRawMaterialId
                      ? 'Edit raw material'
                      : 'Create raw material'}
                  </h3>
                  <p className="mt-1 text-xs text-muted">
                    Raw material data
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeRawMaterialModal}
                  className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-primary"
                >
                  Close
                </button>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="text-sm font-medium text-foreground">
                    Product name
                  </label>
                  <input
                    type="text"
                    value={rawMaterialForm.name}
                    onChange={(event) =>
                      updateRawMaterialForm('name', event.target.value)
                    }
                    placeholder="Example: Oat Milk"
                    className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">
                    Product code
                  </label>
                  <input
                    type="text"
                    value={rawMaterialForm.productCode}
                    onChange={(event) =>
                      updateRawMaterialForm('productCode', event.target.value)
                    }
                    placeholder="Example: RM-001"
                    className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">
                    Unit of Measures
                  </label>
                  <select
                    value={rawMaterialForm.unitOfMeasures}
                    onChange={(event) =>
                      updateRawMaterialForm(
                        'unitOfMeasures',
                        event.target.value,
                      )
                    }
                    className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                  >
                    <option value="">Select a unit</option>
                    {unitOfMeasuresOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {rawMaterialFormError ? (
                <p className="mt-4 text-xs font-medium text-red-600">
                  {rawMaterialFormError}
                </p>
              ) : null}

              <div className="mt-6 flex flex-wrap gap-2 border-t border-border pt-5">
                <button
                  type="button"
                  onClick={saveRawMaterial}
                  className="flex-1 rounded-md bg-primary px-4 py-3 text-sm font-semibold text-white"
                >
                  {editingRawMaterialId
                    ? 'Save raw material'
                    : 'Create raw material'}
                </button>
                <button
                  type="button"
                  onClick={closeRawMaterialModal}
                  className="rounded-md border border-border bg-background px-4 py-3 text-sm font-semibold text-primary"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {rawMaterialImportOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div
              className="w-full max-w-xl rounded-md border border-border bg-surface p-6 shadow-xl"
              role="dialog"
              aria-modal="true"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-foreground">
                    Import Raw Material
                  </h3>
                  <p className="mt-1 text-xs text-muted">
                    Upload Excel or CSV file
                  </p>
                  <p className="mt-2 text-sm text-muted">
                    Upload a file to add or update multiple raw materials.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeRawMaterialImportModal}
                  disabled={rawMaterialImporting}
                  className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Close
                </button>
              </div>

              <div className="mt-5 space-y-4">
                <div>
                  <label className="text-sm font-medium text-foreground">
                    File
                  </label>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleRawMaterialImportFileChange}
                    disabled={rawMaterialImporting}
                    className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-2 text-sm shadow-sm file:mr-4 file:rounded-xl file:border-0 file:bg-primary-soft file:px-3 file:py-2 file:text-xs file:font-semibold file:text-primary"
                  />
                  {rawMaterialImportFile ? (
                    <p className="mt-2 text-xs text-muted">
                      Selected file: {rawMaterialImportFile.name}
                    </p>
                  ) : null}
                  {rawMaterialImportError ? (
                    <p className="mt-2 text-xs font-medium text-red-600">
                      {rawMaterialImportError}
                    </p>
                  ) : null}
                  {rawMaterialImporting ? (
                    <div className="mt-3" aria-label="Import in progress">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-primary-soft">
                        <div className="h-full w-2/3 animate-pulse rounded-full bg-primary" />
                      </div>
                      <span className="sr-only">Import in progress</span>
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={handleImportRawMaterials}
                  disabled={rawMaterialImporting}
                  className="w-full rounded-md border border-border bg-background px-4 py-3 text-sm font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Import raw materials
                </button>
                {rawMaterialImportMessage ? (
                  <p className="text-xs font-medium text-primary">
                    {rawMaterialImportMessage}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {rawMaterialImportResult ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div
              className="w-full max-w-md rounded-md border border-border bg-surface p-6 shadow-xl"
              role="dialog"
              aria-modal="true"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-muted">Import Raw Material</p>
                  <h3
                    className={`mt-2 text-lg font-semibold ${
                      rawMaterialImportResult.status === 'success'
                        ? 'text-primary'
                        : 'text-red-600'
                    }`}
                  >
                    {rawMaterialImportResult.title}
                  </h3>
                  <p className="mt-2 text-sm text-muted">
                    {rawMaterialImportResult.message}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeRawMaterialImportResult}
                  className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-primary"
                >
                  Close
                </button>
              </div>
              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  onClick={closeRawMaterialImportResult}
                  className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white"
                >
                  Ok
                </button>
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

        {activeTab === 'recipes' ? (
          <>
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
                onClick={openRecipeImportModal}
                className="inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary-soft px-4 py-2 text-xs font-semibold text-primary"
              >
                <i className="bi bi-upload text-base" aria-hidden="true" />
                <span>Import recipes</span>
              </button>
              <button
                type="button"
                onClick={() => setCreateRecipeOpen(true)}
                className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white shadow-sm"
              >
                <span className="flex items-center gap-2">
                  <i className="bi bi-plus-circle text-base" aria-hidden="true" />
                  <span>Input</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() =>
                  fetchRecipes(recipeMeta.page, recipeMeta.limit, recipeSearch)
                }
                aria-label="Refresh recipe data"
                title="Refresh recipe data"
                className="rounded-md border border-primary/40 bg-primary-soft p-2 text-primary"
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
                              className="rounded-md border border-primary/40 bg-primary-soft p-2 text-primary transition hover:bg-primary-soft/80"
                              aria-label={isSelected ? 'Hide recipe details' : 'Show recipe details'}
                              title={isSelected ? 'Hide details' : 'Details'}
                            >
                              <i
                                className={`bi ${isSelected ? 'bi-info-circle-fill' : 'bi-info-circle'} text-base`}
                                aria-hidden="true"
                              />
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditRecipe(recipe)}
                              className="rounded-md border border-border bg-background p-2 text-muted transition hover:bg-primary-soft hover:text-primary"
                              aria-label="Edit recipe"
                              title="Edit recipe"
                            >
                              <i className="bi bi-pencil-square text-base" aria-hidden="true" />
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
                              className="rounded-md border border-primary/40 bg-background p-2 text-primary transition hover:bg-primary-soft"
                              aria-label={
                                isRecipeEnabled ? 'Disable recipe' : 'Enable recipe'
                              }
                              title={isRecipeEnabled ? 'Disable' : 'Enable'}
                            >
                              <i
                                className={`bi ${isRecipeEnabled ? 'bi-toggle-on' : 'bi-toggle-off'} text-base`}
                                aria-hidden="true"
                              />
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteRecipe(recipe)}
                              className="rounded-md border border-danger bg-background p-2 text-danger transition hover:bg-danger/10"
                              aria-label="Delete recipe"
                              title="Delete recipe"
                            >
                              <i className="bi bi-trash text-base" aria-hidden="true" />
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
          </>
        ) : null}

        {activeTab === 'raw-materials' ? (
        <section className="rounded-md border border-border bg-surface shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold">Raw Material Data</h2>
              <p className="mt-1 text-xs text-muted">
                Master data used by recipe ingredients.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={openRawMaterialImportModal}
                className="inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary-soft px-4 py-2 text-xs font-semibold text-primary"
              >
                <i className="bi bi-upload text-base" aria-hidden="true" />
                <span>Import materials</span>
              </button>
              <button
                type="button"
                onClick={openCreateRawMaterial}
                className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white shadow-sm"
              >
                <span className="flex items-center gap-2">
                  <i className="bi bi-plus-circle text-base" aria-hidden="true" />
                  <span>Input</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() =>
                  fetchRawMaterials(
                    rawMaterialMeta.page,
                    rawMaterialMeta.limit,
                    rawMaterialSearch,
                  )
                }
                aria-label="Refresh raw material data"
                title="Refresh raw material data"
                className="rounded-md border border-primary/40 bg-primary-soft p-2 text-primary"
              >
                <i className="bi bi-arrow-clockwise text-base" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-4">
            <input
              type="search"
              value={rawMaterialSearchInput}
              onChange={(event) => setRawMaterialSearchInput(event.target.value)}
              placeholder="Search raw material"
              className="w-56 rounded-2xl border border-border bg-white px-4 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
            />
            <button
              type="button"
              onClick={applyRawMaterialSearch}
              className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white"
            >
              Search
            </button>
          </div>

          <TablePagination
            page={rawMaterialMeta.page}
            totalPages={rawMaterialMeta.totalPages}
            loading={rawMaterialMeta.loading}
            summary={`Showing ${rawMaterials.length} of ${rawMaterialMeta.total} items`}
            onPageChange={(page) =>
              fetchRawMaterials(page, rawMaterialMeta.limit, rawMaterialSearch)
            }
            className="border-b border-border bg-white px-5 py-4"
          />

          <div className="max-w-full overflow-x-auto">
            <table className="dm-table min-w-full text-sm">
              <thead className="bg-background">
                <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                  <th className="w-16 px-5 py-4 font-semibold">No</th>
                  <th className="px-5 py-4 font-semibold">Product Code</th>
                  <th className="px-5 py-4 font-semibold">Name</th>
                  <th className="px-5 py-4 font-semibold">Unit of Measures</th>
                  <th className="px-5 py-4 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {rawMaterialMeta.loading ? (
                  <tr className="border-t border-border">
                    <td colSpan={5} className="px-5 py-10 text-center text-muted">
                      Loading raw materials...
                    </td>
                  </tr>
                ) : rawMaterials.length === 0 ? (
                  <tr className="border-t border-border">
                    <td colSpan={5} className="px-5 py-10 text-center text-muted">
                      {rawMaterialMeta.error
                        ? rawMaterialMeta.error
                        : 'No raw materials yet.'}
                    </td>
                  </tr>
                ) : (
                  rawMaterials.map((rawMaterial, index) => (
                    <tr key={rawMaterial.id} className="border-t border-border">
                      <td className="px-5 py-4 text-sm text-muted">
                        {(rawMaterialMeta.page - 1) * rawMaterialMeta.limit +
                          index +
                          1}
                      </td>
                      <td className="px-5 py-4">{rawMaterial.productCode}</td>
                      <td className="px-5 py-4">{rawMaterial.name}</td>
                      <td className="px-5 py-4">
                        {formatUnitLabel(rawMaterial.unitOfMeasures)}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => startEditRawMaterial(rawMaterial)}
                            className="rounded-md border border-border bg-background p-2 text-muted transition hover:bg-primary-soft hover:text-primary"
                            aria-label="Edit raw material"
                            title="Edit raw material"
                          >
                            <i className="bi bi-pencil-square text-base" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteRawMaterial(rawMaterial)}
                            className="rounded-md border border-danger bg-background p-2 text-danger transition hover:bg-danger/10"
                            aria-label="Delete raw material"
                            title="Delete raw material"
                          >
                            <i className="bi bi-trash text-base" aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {rawMaterialMessage ? (
            <p className="px-5 pb-2 text-xs font-medium text-primary">
              {rawMaterialMessage}
            </p>
          ) : null}
          {rawMaterialMeta.error && rawMaterials.length > 0 ? (
            <p className="px-5 pb-2 text-xs font-medium text-red-600">
              {rawMaterialMeta.error}
            </p>
          ) : null}
        </section>
        ) : null}

        {activeTab === 'categories' ? (
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
              className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white shadow-sm"
            >
              <span className="flex items-center gap-2">
                <i className="bi bi-tags text-base" aria-hidden="true" />
                <span>Input</span>
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
              className="rounded-md border border-primary/40 bg-primary-soft p-2 text-primary"
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
                            className="rounded-md border border-primary/40 bg-background p-2 text-primary transition hover:bg-primary-soft"
                            aria-label={
                              category.isActive
                                ? 'Disable category'
                                : 'Activate category'
                            }
                            title={category.isActive ? 'Disable' : 'Activate'}
                          >
                            <i
                              className={`bi ${category.isActive ? 'bi-toggle-on' : 'bi-toggle-off'} text-base`}
                              aria-hidden="true"
                            />
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
        ) : null}
      </div>
    </div>
  )
}

export default SuperadminMenuManagementPage
