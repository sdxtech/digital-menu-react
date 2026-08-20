import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
} from 'react'
import TablePagination from '../components/TablePagination'
import ActionButton from '../components/ActionButton'
import ChefMenuCycle from './ChefMenuCycle'
import ChefCreateMenu, { type BaseRecipe } from './ChefCreateMenu'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'
import { formatQuantity } from '../lib/quantity'
import {
  formatRecipeVersion,
  formatVersionedRecipeName,
} from '../lib/recipe-version'
import { getApprovalStatusLabel } from '../lib/status-labels'
import { formatUnitLabel, unitOfMeasuresOptions } from '../lib/unit-of-measures'

type RecipeStatus = 'draft' | 'active'
type ApprovalStatus = 'pending' | 'approved' | 'rejected'
type CategoryStatusFilter = 'active' | 'disabled'
type MenuManagementTab =
  | 'menu-production'
  | 'recipe-calculator'
  | 'create-recipe'
  | 'recipes'
  | 'raw-materials'
  | 'categories'

type RecipeIngredient = {
  ingredientType?: 'IT' | 'NMP'
  productCode?: string
  name?: string
  unitOfMeasures?: string
  qty?: number
  priceUom?: number
  foodCost?: number
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
  price?: number
  portionSize: number
  foodCostRecipe?: number
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
  vendor?: string
  price?: number
  createdAt?: string
}

type RawMaterial = {
  id: string
  productCode: string
  name: string
  unitOfMeasures: string
  vendor: string
  price?: number
  createdAt: string
}

type RawMaterialVendorPriceApi = {
  id?: string
  _id?: string
  productCode?: string
  unitOfMeasures?: string
  site?: string
  vendor?: string
  currency?: string
  minimumQuantity?: number
  priceQuantity?: number
  price?: number
}

type RawMaterialVendorPriceOption = {
  key: string
  vendor: string
  site?: string
  minimumQuantity?: number
  priceQuantity?: number
  price?: number
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
  status: 'success' | 'error' | 'cancelled'
  title: string
  message: string
}

type RawMaterialPriceUploadResult = {
  mode: 'master' | 'vendor' | 'mixed'
  requestedCount: number
  matchedCount: number
  modifiedCount: number
  matchedProductCount: number
  notFoundCount: number
  notFoundRowCount: number
  notFoundProductCodes: string[]
  vendorPriceRequestedCount: number
  vendorPriceUniqueCount: number
  vendorPriceMatchedCount: number
  vendorPriceModifiedCount: number
  vendorPriceUpsertedCount: number
  vendorPriceDuplicateRemovedCount: number
  duplicateVendorPriceRowCount: number
  conflictingVendorPriceCount: number
  priceQuantityAdjustedCount: number
}

type IngredientCostBackfillResult = {
  scannedRecipes: number
  updatedRecipes: number
  updatedIngredients: number
  skippedNoRawMaterial: number
  skippedMissingPrice: number
}

const DEFAULT_LIMIT = 10
const CALCULATOR_ROWS_PER_PAGE = 8
const USE_OTHER_SITE_VENDOR_OPTION = '__use_other_site_vendor__'

const menuManagementTabs: Array<{
  id: MenuManagementTab
  label: string
  icon: string
}> = [
  { id: 'menu-production', label: 'Menu Production', icon: 'bi-calendar2-week' },
  { id: 'recipe-calculator', label: 'Calculator Recipe', icon: 'bi-calculator' },
  { id: 'create-recipe', label: 'Create New Recipe', icon: 'bi-plus-circle' },
  { id: 'recipes', label: 'Recipe Data', icon: 'bi-journal-text' },
  { id: 'raw-materials', label: 'Raw Material Data', icon: 'bi-box-seam' },
  { id: 'categories', label: 'Categories', icon: 'bi-tags' },
]

const isMenuManagementTab = (value: string | null): value is MenuManagementTab =>
  menuManagementTabs.some((tab) => tab.id === value)

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

const formatPrice = (value?: number) => {
  if (value === undefined || value === null || !Number.isFinite(value)) return '-'
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(value)
}

const normalizeTextKey = (value?: string) => value?.trim().toLowerCase() ?? ''

const getRawMaterialVendorProductKey = (productCode: string) =>
  normalizeTextKey(productCode)

const getRecipeCalculatorVendorProductKey = (
  productCode?: string,
  site?: string,
) => `${normalizeTextKey(site)}::${normalizeTextKey(productCode)}`

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
  vendor: item.vendor ?? '',
  price: Number.isFinite(Number(item.price)) ? Number(item.price) : undefined,
  createdAt: item.createdAt ?? '',
})

const mapRawMaterialVendorPriceOption = (
  item: RawMaterialVendorPriceApi,
): RawMaterialVendorPriceOption | null => {
  const vendor = item.vendor?.trim() ?? ''
  if (!vendor) return null

  const site = item.site?.trim() || undefined
  const minimumQuantity = Number.isFinite(Number(item.minimumQuantity))
    ? Number(item.minimumQuantity)
    : undefined
  const priceQuantity =
    Number.isFinite(Number(item.priceQuantity)) &&
    Number(item.priceQuantity) > 0
      ? Number(item.priceQuantity)
      : undefined
  const price = Number.isFinite(Number(item.price))
    ? Number(item.price)
    : undefined
  const key = [
    normalizeTextKey(vendor),
    price ?? '',
    priceQuantity ?? '',
  ].join('|')

  return {
    key,
    vendor,
    site,
    minimumQuantity,
    priceQuantity,
    price,
  }
}

const getVendorUnitPrice = (option?: RawMaterialVendorPriceOption) => {
  if (!Number.isFinite(Number(option?.price))) return undefined
  return Number(option?.price)
}

const formatVendorOptionLabel = (option: RawMaterialVendorPriceOption) =>
  option.vendor

const pickDefaultVendorOption = (
  rawMaterial: RawMaterial,
  options: RawMaterialVendorPriceOption[],
) => {
  if (options.length === 0) return undefined

  const currentVendor = normalizeTextKey(rawMaterial.vendor)
  if (currentVendor) {
    const byVendor = options.find(
      (option) => normalizeTextKey(option.vendor) === currentVendor,
    )
    if (byVendor) return byVendor
  }

  if (rawMaterial.price !== undefined) {
    const byPrice = options.find(
      (option) => getVendorUnitPrice(option) === rawMaterial.price,
    )
    if (byPrice) return byPrice
  }

  return options[0]
}

const mapSite = (item: SiteApi): SiteOption => ({
  id: item.id ?? item._id ?? '',
  name: item.name ?? '',
  code: item.code ?? '',
})

type RecipeCalculatorRow = {
  id: string
  recipeId: string
  recipeQuery: string
  portion: number | ''
}

const createRecipeCalculatorRow = (): RecipeCalculatorRow => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  recipeId: '',
  recipeQuery: '',
  portion: '',
})

const getRecipeOptionLabel = (recipe: Recipe) =>
  formatVersionedRecipeName(recipe)

const getRecipeSiteText = (recipe: Recipe) =>
  recipe.siteName?.trim() || recipe.site?.trim() || 'All sites'

const getIngredientUnitPrice = (
  ingredient: RecipeIngredient,
  vendorPrice?: RawMaterialVendorPriceOption,
) => {
  const vendorUnitPrice = getVendorUnitPrice(vendorPrice)
  if (Number.isFinite(vendorUnitPrice)) {
    return vendorUnitPrice
  }
  if (Number.isFinite(Number(ingredient.priceUom))) {
    return Number(ingredient.priceUom)
  }
  if (
    Number.isFinite(Number(ingredient.foodCost)) &&
    Number.isFinite(Number(ingredient.qty)) &&
    Number(ingredient.qty) > 0
  ) {
    return Number(ingredient.foodCost) / Number(ingredient.qty)
  }
  return undefined
}

const getRecipeBasePax = (recipe: Recipe) =>
  Number.isFinite(Number(recipe.portionSize)) && Number(recipe.portionSize) > 0
    ? Number(recipe.portionSize)
    : 1

const getRecipeTargetPortion = (recipe: Recipe, portion: number | '') =>
  typeof portion === 'number' && portion > 0 ? portion : getRecipeBasePax(recipe)

const sortVendorPriceOptions = (options: RawMaterialVendorPriceOption[]) =>
  options.sort((a, b) =>
    [a.vendor, a.site, String(a.minimumQuantity ?? '')]
      .join(' ')
      .localeCompare(
        [b.vendor, b.site, String(b.minimumQuantity ?? '')].join(' '),
        undefined,
        { sensitivity: 'base' },
      ),
  )

const pickHighestVendorPriceOption = (
  options: RawMaterialVendorPriceOption[],
) => {
  if (options.length === 0) return undefined

  return options.reduce((selected, option) => {
    const selectedPrice = Number(getVendorUnitPrice(selected))
    const optionPrice = Number(getVendorUnitPrice(option))
    const selectedHasPrice = Number.isFinite(selectedPrice)
    const optionHasPrice = Number.isFinite(optionPrice)

    if (optionHasPrice && !selectedHasPrice) return option
    if (optionHasPrice && selectedHasPrice && optionPrice > selectedPrice) {
      return option
    }
    return selected
  }, options[0])
}

const dedupeVendorPricesByVendor = (
  options: RawMaterialVendorPriceOption[],
) => {
  const byVendor = new Map<string, RawMaterialVendorPriceOption>()
  options.forEach((option) => {
    const vendorKey = normalizeTextKey(option.vendor)
    if (!vendorKey) return

    const existing = byVendor.get(vendorKey)
    if (!existing) {
      byVendor.set(vendorKey, option)
      return
    }

    const existingPrice = Number(getVendorUnitPrice(existing))
    const optionPrice = Number(getVendorUnitPrice(option))
    const existingHasPrice = Number.isFinite(existingPrice)
    const optionHasPrice = Number.isFinite(optionPrice)
    if (optionHasPrice && (!existingHasPrice || optionPrice > existingPrice)) {
      byVendor.set(vendorKey, option)
    }
  })
  return sortVendorPriceOptions(Array.from(byVendor.values()))
}

export const RecipeCalculator = () => {
  const { accessToken } = useAuth()
  const [calculatorRecipes, setCalculatorRecipes] = useState<Recipe[]>([])
  const [calculatorRows, setCalculatorRows] = useState<RecipeCalculatorRow[]>([
    createRecipeCalculatorRow(),
  ])
  const [expandedRows, setExpandedRows] = useState<string[]>([])
  const [calculatorPage, setCalculatorPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [vendorPricesByProductKey, setVendorPricesByProductKey] = useState<
    Record<string, RawMaterialVendorPriceOption[]>
  >({})
  const [vendorPriceLoadingByProductKey, setVendorPriceLoadingByProductKey] =
    useState<Record<string, boolean>>({})
  const [vendorPriceErrorByProductKey, setVendorPriceErrorByProductKey] =
    useState<Record<string, string>>({})
  const [otherSiteVendorPricesByProductKey, setOtherSiteVendorPricesByProductKey] =
    useState<Record<string, RawMaterialVendorPriceOption[]>>({})
  const [otherSiteVendorPriceLoadedByProductKey, setOtherSiteVendorPriceLoadedByProductKey] =
    useState<Record<string, boolean>>({})
  const [
    otherSiteVendorPriceLoadingByProductKey,
    setOtherSiteVendorPriceLoadingByProductKey,
  ] = useState<Record<string, boolean>>({})
  const [otherSiteVendorPriceErrorByProductKey, setOtherSiteVendorPriceErrorByProductKey] =
    useState<Record<string, string>>({})
  const [selectedVendorPriceByIngredientKey, setSelectedVendorPriceByIngredientKey] =
    useState<Record<string, string>>({})
  const [useOtherSiteVendorByIngredientKey, setUseOtherSiteVendorByIngredientKey] =
    useState<Record<string, boolean>>({})

  const sortedCalculatorRecipes = useMemo(
    () =>
      calculatorRecipes
        .filter((recipe) => recipe.isActive ?? true)
        .slice()
        .sort((a, b) =>
          (a.name || '').localeCompare(b.name || '', undefined, {
            sensitivity: 'base',
          }),
        ),
    [calculatorRecipes],
  )

  const recipeById = useMemo(() => {
    const map = new Map<string, Recipe>()
    sortedCalculatorRecipes.forEach((recipe) => {
      const key = getRecipeKey(recipe)
      if (key) map.set(key, recipe)
    })
    return map
  }, [sortedCalculatorRecipes])

  const getIngredientVendorSelectionKey = useCallback(
    (rowId: string, index: number, productCode?: string) =>
      `${rowId}::${index}::${normalizeTextKey(productCode)}`,
    [],
  )

  const getSelectedSiteVendorPriceKey = (
    selectionKey: string,
    options: RawMaterialVendorPriceOption[],
  ) => {
    const selectedKey = selectedVendorPriceByIngredientKey[selectionKey]
    if (selectedKey && options.some((option) => option.key === selectedKey)) {
      return selectedKey
    }
    return pickHighestVendorPriceOption(options)?.key ?? ''
  }

  const getSelectedOtherSiteVendorPriceKey = (
    selectionKey: string,
    options: RawMaterialVendorPriceOption[],
  ) => {
    const selectedKey = selectedVendorPriceByIngredientKey[selectionKey]
    if (selectedKey && options.some((option) => option.key === selectedKey)) {
      return selectedKey
    }
    return ''
  }

  const fetchVendorPrices = useCallback(
    async (productCode: string, site?: string) => {
      if (!accessToken) return []
      const params = new URLSearchParams()
      if (site?.trim()) params.set('site', site.trim())
      const query = params.toString()
      return apiFetch<RawMaterialVendorPriceApi[]>(
        `/raw-materials/${encodeURIComponent(productCode)}/vendor-prices${
          query ? `?${query}` : ''
        }`,
        undefined,
        accessToken,
      )
    },
    [accessToken],
  )

  const fetchCalculatorRecipes = useCallback(async () => {
    if (!accessToken) {
      setCalculatorRecipes([])
      setError('Please log in first to load recipes.')
      return
    }

    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      params.set('page', '1')
      params.set('limit', '500')
      params.set('status', 'active')
      params.set('approvalStatus', 'approved')

      const data = await apiFetch<{
        items?: Recipe[]
      }>(`/recipes?${params.toString()}`, undefined, accessToken)

      setCalculatorRecipes(data.items ?? [])
    } catch (fetchError) {
      const message =
        fetchError instanceof Error
          ? fetchError.message
          : 'Failed to load recipes.'
      setCalculatorRecipes([])
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  const loadRecipeSiteVendorPrices = useCallback(
    async (productCode?: string, site?: string) => {
      const trimmedProductCode = productCode?.trim()
      const vendorSite = site?.trim()
      if (!trimmedProductCode || !vendorSite || !accessToken) return

      const productKey = getRecipeCalculatorVendorProductKey(
        trimmedProductCode,
        vendorSite,
      )
      if (
        vendorPricesByProductKey[productKey] ||
        vendorPriceLoadingByProductKey[productKey]
      ) {
        return
      }

      setVendorPriceLoadingByProductKey((prev) => ({
        ...prev,
        [productKey]: true,
      }))
      setVendorPriceErrorByProductKey((prev) => ({
        ...prev,
        [productKey]: '',
      }))

      try {
        const items = await fetchVendorPrices(trimmedProductCode, vendorSite)
        const optionsByKey = new Map<string, RawMaterialVendorPriceOption>()
        items.forEach((item) => {
          const option = mapRawMaterialVendorPriceOption(item)
          if (option) optionsByKey.set(option.key, option)
        })
        setVendorPricesByProductKey((prev) => ({
          ...prev,
          [productKey]: sortVendorPriceOptions(Array.from(optionsByKey.values())),
        }))
      } catch (loadError) {
        setVendorPriceErrorByProductKey((prev) => ({
          ...prev,
          [productKey]:
            loadError instanceof Error
              ? loadError.message
              : 'Failed to load vendors.',
        }))
      } finally {
        setVendorPriceLoadingByProductKey((prev) => ({
          ...prev,
          [productKey]: false,
        }))
      }
    },
    [
      accessToken,
      fetchVendorPrices,
      vendorPriceLoadingByProductKey,
      vendorPricesByProductKey,
    ],
  )

  const loadOtherSiteVendorPrices = useCallback(
    async (productCode?: string, site?: string) => {
      const trimmedProductCode = productCode?.trim()
      const vendorSite = site?.trim()
      if (!trimmedProductCode || !vendorSite || !accessToken) return

      const productKey = getRecipeCalculatorVendorProductKey(
        trimmedProductCode,
        vendorSite,
      )
      if (
        otherSiteVendorPriceLoadedByProductKey[productKey] ||
        otherSiteVendorPriceLoadingByProductKey[productKey]
      ) {
        return
      }

      setOtherSiteVendorPriceLoadingByProductKey((prev) => ({
        ...prev,
        [productKey]: true,
      }))
      setOtherSiteVendorPriceErrorByProductKey((prev) => ({
        ...prev,
        [productKey]: '',
      }))

      try {
        const items = await fetchVendorPrices(trimmedProductCode)
        const options = dedupeVendorPricesByVendor(
          items
            .map(mapRawMaterialVendorPriceOption)
            .filter(
              (option): option is RawMaterialVendorPriceOption =>
                Boolean(option),
            ),
        )
        setOtherSiteVendorPricesByProductKey((prev) => ({
          ...prev,
          [productKey]: options,
        }))
        setOtherSiteVendorPriceLoadedByProductKey((prev) => ({
          ...prev,
          [productKey]: true,
        }))
      } catch (loadError) {
        setOtherSiteVendorPriceErrorByProductKey((prev) => ({
          ...prev,
          [productKey]:
            loadError instanceof Error
              ? loadError.message
              : 'Failed to load other site vendors.',
        }))
      } finally {
        setOtherSiteVendorPriceLoadingByProductKey((prev) => ({
          ...prev,
          [productKey]: false,
        }))
      }
    },
    [
      accessToken,
      fetchVendorPrices,
      otherSiteVendorPriceLoadedByProductKey,
      otherSiteVendorPriceLoadingByProductKey,
    ],
  )

  useEffect(() => {
    fetchCalculatorRecipes().catch(() => null)
  }, [fetchCalculatorRecipes])

  useEffect(() => {
    calculatorRows.forEach((row) => {
      const recipe = recipeById.get(row.recipeId)
      const site = recipe ? getRecipeSiteText(recipe) : ''
      ;(recipe?.ingredients ?? []).forEach((ingredient) => {
        loadRecipeSiteVendorPrices(ingredient.productCode, site).catch(
          () => null,
        )
      })
    })
  }, [calculatorRows, loadRecipeSiteVendorPrices, recipeById])

  useEffect(() => {
    expandedRows.forEach((rowId) => {
      const row = calculatorRows.find((item) => item.id === rowId)
      const recipe = row ? recipeById.get(row.recipeId) : undefined
      const site = recipe ? getRecipeSiteText(recipe) : ''
      ;(recipe?.ingredients ?? []).forEach((ingredient, idx) => {
        const vendorSelectionKey = getIngredientVendorSelectionKey(
          rowId,
          idx,
          ingredient.productCode,
        )
        if (!useOtherSiteVendorByIngredientKey[vendorSelectionKey]) return
        loadOtherSiteVendorPrices(ingredient.productCode, site).catch(() => null)
      })
    })
  }, [
    calculatorRows,
    expandedRows,
    getIngredientVendorSelectionKey,
    loadOtherSiteVendorPrices,
    recipeById,
    useOtherSiteVendorByIngredientKey,
  ])

  const totalPages = Math.max(
    1,
    Math.ceil(calculatorRows.length / CALCULATOR_ROWS_PER_PAGE),
  )
  const paginatedRows = calculatorRows.slice(
    (calculatorPage - 1) * CALCULATOR_ROWS_PER_PAGE,
    calculatorPage * CALCULATOR_ROWS_PER_PAGE,
  )

  useEffect(() => {
    if (calculatorPage > totalPages) {
      setCalculatorPage(totalPages)
    }
  }, [calculatorPage, totalPages])

  const getRecipeSuggestions = (query: string) => {
    const normalizedQuery = query.trim().toLowerCase()
    const matches = normalizedQuery
      ? sortedCalculatorRecipes.filter((recipe) => {
          const searchable = [
            recipe.recipeCode,
            recipe.name,
            getRecipeOptionLabel(recipe),
            recipe.category,
            getRecipeSiteText(recipe),
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
          return searchable.includes(normalizedQuery)
        })
      : sortedCalculatorRecipes

    return matches.slice(0, 20)
  }

  const updateRowRecipe = (rowId: string, value: string) => {
    const normalizedValue = value.trim().toLowerCase()
    const matchedRecipe = sortedCalculatorRecipes.find((recipe) => {
      const optionLabel = getRecipeOptionLabel(recipe).toLowerCase()
      return (
        optionLabel === normalizedValue ||
        recipe.name.toLowerCase() === normalizedValue ||
        recipe.recipeCode?.toLowerCase() === normalizedValue
      )
    })

    setCalculatorRows((prev) =>
      prev.map((row) =>
        row.id === rowId
          ? {
              ...row,
              recipeQuery: value,
              recipeId: matchedRecipe ? getRecipeKey(matchedRecipe) : '',
            }
          : row,
      ),
    )
  }

  const updateRowPortion = (rowId: string, value: string) => {
    const digitsOnly = value.replace(/\D/g, '')
    setCalculatorRows((prev) =>
      prev.map((row) =>
        row.id === rowId
          ? {
              ...row,
              portion:
                digitsOnly === '' ? '' : Number.parseInt(digitsOnly, 10),
            }
          : row,
      ),
    )
  }

  const handleAddRow = () => {
    setCalculatorRows((prev) => {
      const nextRows = [...prev, createRecipeCalculatorRow()]
      setCalculatorPage(
        Math.max(1, Math.ceil(nextRows.length / CALCULATOR_ROWS_PER_PAGE)),
      )
      return nextRows
    })
  }

  const handleRemoveRow = (rowId: string) => {
    setCalculatorRows((prev) =>
      prev.length === 1
        ? [createRecipeCalculatorRow()]
        : prev.filter((row) => row.id !== rowId),
    )
    setExpandedRows((prev) => prev.filter((id) => id !== rowId))
  }

  const toggleRowDetails = (rowId: string) => {
    setExpandedRows((prev) =>
      prev.includes(rowId)
        ? prev.filter((id) => id !== rowId)
        : [...prev, rowId],
    )
  }

  const getSelectedIngredientVendorPrice = (
    rowId: string,
    ingredientIndex: number,
    ingredient: RecipeIngredient,
    recipe: Recipe,
  ) => {
    const site = getRecipeSiteText(recipe)
    const productKey = getRecipeCalculatorVendorProductKey(
      ingredient.productCode,
      site,
    )
    const vendorSelectionKey = getIngredientVendorSelectionKey(
      rowId,
      ingredientIndex,
      ingredient.productCode,
    )
    const useOtherSiteVendor =
      useOtherSiteVendorByIngredientKey[vendorSelectionKey] ?? false
    const siteVendorOptions = vendorPricesByProductKey[productKey] ?? []
    const otherSiteVendorOptions =
      otherSiteVendorPricesByProductKey[productKey] ?? []
    const vendorOptions = useOtherSiteVendor
      ? otherSiteVendorOptions
      : siteVendorOptions
    const selectedVendorKey = useOtherSiteVendor
      ? getSelectedOtherSiteVendorPriceKey(vendorSelectionKey, vendorOptions)
      : getSelectedSiteVendorPriceKey(vendorSelectionKey, vendorOptions)

    return vendorOptions.find((option) => option.key === selectedVendorKey)
  }

  const hasLoadedSiteVendorPrices = (productKey: string) =>
    Object.prototype.hasOwnProperty.call(vendorPricesByProductKey, productKey)

  const isSiteVendorPricePending = (productKey: string) =>
    !hasLoadedSiteVendorPrices(productKey) &&
    !vendorPriceErrorByProductKey[productKey]

  const hasPendingRecipeSiteVendorPrices = (recipe: Recipe) => {
    const site = getRecipeSiteText(recipe)
    return (recipe.ingredients ?? []).some((ingredient) => {
      const productCode = ingredient.productCode?.trim()
      if (!productCode || !site.trim()) return false

      return isSiteVendorPricePending(
        getRecipeCalculatorVendorProductKey(productCode, site),
      )
    })
  }

  const getCalculatorEstimatedCost = (
    rowId: string,
    recipe: Recipe,
    portion: number | '',
  ) => {
    const ingredients = recipe.ingredients ?? []
    if (!ingredients.length) return undefined
    if (hasPendingRecipeSiteVendorPrices(recipe)) return undefined

    const basePax = getRecipeBasePax(recipe)
    const targetPortion = getRecipeTargetPortion(recipe, portion)
    let total = 0
    let hasCost = false

    ingredients.forEach((ingredient, ingredientIndex) => {
      const ingredientQty = Number(ingredient.qty)
      if (!Number.isFinite(ingredientQty)) return

      const vendorPrice = getSelectedIngredientVendorPrice(
        rowId,
        ingredientIndex,
        ingredient,
        recipe,
      )
      const unitPrice = getIngredientUnitPrice(ingredient, vendorPrice)
      if (unitPrice === undefined) return

      total += ((ingredientQty * targetPortion) / basePax) * unitPrice
      hasCost = true
    })

    return hasCost ? total : undefined
  }

  return (
    <section className="rounded-md border border-border bg-surface shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold">Calculator Recipe</h2>
          <p className="mt-1 text-xs text-muted">
            Select saved recipes and preview price with estimated ingredient cost.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fetchCalculatorRecipes().catch(() => null)}
            disabled={loading}
            aria-label="Refresh calculator recipes"
            title="Refresh calculator recipes"
            className="rounded-md border border-primary/40 bg-primary-soft p-2 text-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            <i className="bi bi-arrow-clockwise text-base" aria-hidden="true" />
          </button>
        </div>
      </div>

      {error ? (
        <p className="border-b border-border px-5 py-3 text-xs font-medium text-red-600">
          {error}
        </p>
      ) : null}
      {!error && loading ? (
        <p className="border-b border-border px-5 py-3 text-xs text-muted">
          Loading recipes...
        </p>
      ) : null}
      {!error && !loading && sortedCalculatorRecipes.length === 0 ? (
        <p className="border-b border-border px-5 py-3 text-xs text-muted">
          No approved active recipes available for calculation.
        </p>
      ) : null}

      <TablePagination
        page={calculatorPage}
        totalPages={totalPages}
        onPageChange={setCalculatorPage}
        summary={`Showing ${paginatedRows.length} of ${calculatorRows.length} calculator rows`}
        className="border-b border-border bg-white px-5 py-4"
      />

      <div className="max-w-full overflow-x-auto">
        <table className="dm-table min-w-full text-sm">
          <thead className="bg-background">
            <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
              <th className="w-20 px-2 py-3 font-semibold" />
              <th className="w-14 px-2 py-3 text-center font-semibold">No</th>
              <th className="px-4 py-3 font-semibold">Recipe ID</th>
              <th className="px-4 py-3 font-semibold">Recipe</th>
              <th className="px-4 py-3 font-semibold">Category</th>
              <th className="px-4 py-3 font-semibold">Site</th>
              <th className="px-4 py-3 font-semibold">Base pax</th>
              <th className="px-4 py-3 font-semibold">Portion</th>
              <th className="px-4 py-3 font-semibold">Estimated Cost</th>
              <th className="px-4 py-3 font-semibold">Cost/Pax</th>
              <th className="px-4 py-3 font-semibold">Recipe details</th>
            </tr>
          </thead>
          <tbody>
            {paginatedRows.map((row, index) => {
              const selectedRecipe = recipeById.get(row.recipeId)
              const isDetailsOpen = expandedRows.includes(row.id)
              const basePax = selectedRecipe
                ? getRecipeBasePax(selectedRecipe)
                : 1
              const targetPortion = selectedRecipe
                ? getRecipeTargetPortion(selectedRecipe, row.portion)
                : 1
              const ingredients = selectedRecipe?.ingredients ?? []
              const estimatedTotalCost = selectedRecipe
                ? getCalculatorEstimatedCost(
                    row.id,
                    selectedRecipe,
                    row.portion,
                  )
                : undefined
              const estimatedCostPerPax =
                estimatedTotalCost !== undefined && targetPortion > 0
                  ? estimatedTotalCost / targetPortion
                  : undefined
              const recipeSuggestions = getRecipeSuggestions(row.recipeQuery)
              const rowNumber =
                (calculatorPage - 1) * CALCULATOR_ROWS_PER_PAGE + index + 1

              return (
                <Fragment key={row.id}>
                  <tr className="border-t border-border">
                    <td className="px-2 py-3">
                      <div className="flex justify-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveRow(row.id)}
                          className="dm-x-button text-sm font-semibold leading-none"
                          aria-label="Remove calculator row"
                          title="Remove row"
                        >
                          X
                        </button>
                      </div>
                    </td>
                    <td className="px-2 py-3 text-center text-sm text-muted">
                      {rowNumber}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted">
                      {selectedRecipe?.recipeCode ?? '-'}
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        list={`calculator-recipe-options-${row.id}`}
                        value={row.recipeQuery}
                        onChange={(event) =>
                          updateRowRecipe(row.id, event.target.value)
                        }
                        placeholder={
                          sortedCalculatorRecipes.length === 0
                            ? 'No approved recipe available'
                            : 'Search recipe'
                        }
                        className="w-full min-w-[220px] rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                      />
                      <datalist id={`calculator-recipe-options-${row.id}`}>
                        {recipeSuggestions.map((recipe) => (
                          <option
                            key={getRecipeKey(recipe)}
                            value={getRecipeOptionLabel(recipe)}
                            label={`${recipe.category || '-'} | ${getRecipeSiteText(recipe)}`}
                          />
                        ))}
                      </datalist>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted">
                      {selectedRecipe?.category || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted">
                      {selectedRecipe ? getRecipeSiteText(selectedRecipe) : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted">
                      {selectedRecipe ? basePax : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={row.portion === '' ? '' : String(row.portion)}
                        onChange={(event) =>
                          updateRowPortion(row.id, event.target.value)
                        }
                        placeholder={selectedRecipe ? String(basePax) : '0'}
                        className="w-full min-w-[120px] rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                      />
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {formatPrice(estimatedTotalCost)}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {formatPrice(estimatedCostPerPax)}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        disabled={!selectedRecipe}
                        onClick={() => toggleRowDetails(row.id)}
                        className="rounded-md border border-primary bg-primary-soft px-3 py-2 text-xs font-semibold text-primary hover:bg-primary-soft/80 disabled:cursor-not-allowed disabled:opacity-60"
                        aria-expanded={isDetailsOpen}
                      >
                        {isDetailsOpen ? 'Hide details' : 'View details'}
                      </button>
                    </td>
                  </tr>

                  {isDetailsOpen ? (
                    <tr className="border-t border-border bg-background">
                      <td colSpan={11} className="px-4 py-4">
                        {!selectedRecipe ? (
                          <div className="rounded-md border border-border bg-surface p-4 text-sm text-muted">
                            Select a recipe to view calculation details.
                          </div>
                        ) : (
                          <div className="rounded-md border border-border bg-surface p-4">
                            <h3 className="font-semibold text-foreground">
                              Ingredients
                            </h3>
                            <p className="mt-1 text-xs text-muted">
                              Qty calculated from base pax ({basePax}) for{' '}
                              {targetPortion} portions.
                            </p>

                            {ingredients.length === 0 ? (
                              <div className="mt-3 rounded-md border border-border bg-background p-4 text-sm text-muted">
                                No ingredients for this recipe yet.
                              </div>
                            ) : (
                              <div className="mt-3 max-w-full overflow-x-auto rounded-md border border-border bg-white">
                                <table className="dm-table min-w-full text-sm">
                                  <thead className="bg-background">
                                    <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                                      <th className="w-12 px-4 py-3 font-semibold">
                                        No
                                      </th>
                                      <th className="px-4 py-3 font-semibold">
                                        Product code
                                      </th>
                                      <th className="px-4 py-3 font-semibold">
                                        Ingredient name
                                      </th>
                                      <th className="px-4 py-3 font-semibold">
                                        Qty
                                      </th>
                                      <th className="px-4 py-3 font-semibold">
                                        Unit
                                      </th>
                                      <th className="px-4 py-3 font-semibold">
                                        Vendor
                                      </th>
                                      <th className="px-4 py-3 font-semibold">
                                        Price
                                      </th>
                                      <th className="px-4 py-3 font-semibold">
                                        Ingredient Cost
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {ingredients.map((ingredient, idx) => {
                                      const ingredientQty = Number(ingredient.qty)
                                      const scaledQty = Number.isFinite(
                                        ingredientQty,
                                      )
                                        ? (ingredientQty * targetPortion) /
                                          basePax
                                        : 0
                                      const site = getRecipeSiteText(selectedRecipe)
                                      const productKey =
                                        getRecipeCalculatorVendorProductKey(
                                          ingredient.productCode,
                                          site,
                                        )
                                      const siteVendorOptions =
                                        vendorPricesByProductKey[productKey] ??
                                        []
                                      const siteVendorPending =
                                        !hasLoadedSiteVendorPrices(productKey) &&
                                        !vendorPriceErrorByProductKey[
                                          productKey
                                        ]
                                      const vendorLoading =
                                        vendorPriceLoadingByProductKey[
                                          productKey
                                        ] ?? false
                                      const vendorError =
                                        vendorPriceErrorByProductKey[
                                          productKey
                                        ] ?? ''
                                      const vendorSelectionKey =
                                        getIngredientVendorSelectionKey(
                                          row.id,
                                          idx,
                                          ingredient.productCode,
                                        )
                                      const useOtherSiteVendor =
                                        useOtherSiteVendorByIngredientKey[
                                          vendorSelectionKey
                                        ] ?? false
                                      const otherSiteVendorOptions =
                                        otherSiteVendorPricesByProductKey[
                                          productKey
                                        ] ?? []
                                      const otherSiteVendorLoading =
                                        otherSiteVendorPriceLoadingByProductKey[
                                          productKey
                                        ] ?? false
                                      const otherSiteVendorError =
                                        otherSiteVendorPriceErrorByProductKey[
                                          productKey
                                        ] ?? ''
                                      const vendorOptions = useOtherSiteVendor
                                        ? otherSiteVendorOptions
                                        : siteVendorOptions
                                      const selectedVendorKey =
                                        useOtherSiteVendor
                                          ? getSelectedOtherSiteVendorPriceKey(
                                              vendorSelectionKey,
                                              vendorOptions,
                                            )
                                          : getSelectedSiteVendorPriceKey(
                                              vendorSelectionKey,
                                              vendorOptions,
                                            )
                                      const selectedVendorPrice =
                                        vendorOptions.find(
                                          (option) =>
                                            option.key === selectedVendorKey,
                                        )
                                      const unitPrice = siteVendorPending
                                        ? undefined
                                        : getIngredientUnitPrice(
                                            ingredient,
                                            selectedVendorPrice,
                                          )
                                      const totalCost =
                                        unitPrice === undefined
                                          ? undefined
                                          : scaledQty * unitPrice

                                      return (
                                        <tr
                                          key={`${ingredient.productCode}-${idx}`}
                                          className="border-t border-border"
                                        >
                                          <td className="px-4 py-3 text-sm text-muted">
                                            {idx + 1}
                                          </td>
                                          <td className="px-4 py-3">
                                            {ingredient.productCode || '-'}
                                          </td>
                                          <td className="px-4 py-3">
                                            {ingredient.name || '-'}
                                          </td>
                                          <td className="px-4 py-3">
                                            {formatQuantity(scaledQty)}
                                          </td>
                                          <td className="px-4 py-3">
                                            {ingredient.unitOfMeasures
                                              ? formatUnitLabel(
                                                  ingredient.unitOfMeasures,
                                                )
                                              : '-'}
                                          </td>
                                          <td className="min-w-56 px-4 py-3">
                                            <select
                                              value={selectedVendorKey}
                                              onChange={(event) => {
                                                const nextValue =
                                                  event.target.value
                                                if (
                                                  nextValue ===
                                                  USE_OTHER_SITE_VENDOR_OPTION
                                                ) {
                                                  setUseOtherSiteVendorByIngredientKey(
                                                    (prev) => ({
                                                      ...prev,
                                                      [vendorSelectionKey]:
                                                        true,
                                                    }),
                                                  )
                                                  setSelectedVendorPriceByIngredientKey(
                                                    (prev) => ({
                                                      ...prev,
                                                      [vendorSelectionKey]: '',
                                                    }),
                                                  )
                                                  loadOtherSiteVendorPrices(
                                                    ingredient.productCode,
                                                    site,
                                                  ).catch(() => null)
                                                  return
                                                }
                                                setSelectedVendorPriceByIngredientKey(
                                                  (prev) => ({
                                                    ...prev,
                                                    [vendorSelectionKey]:
                                                      nextValue,
                                                  }),
                                                )
                                              }}
                                              disabled={
                                                vendorLoading ||
                                                otherSiteVendorLoading
                                              }
                                              className="w-56 rounded-xl border border-border bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20 disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                              {vendorLoading ? (
                                                <option value="">
                                                  Loading vendors...
                                                </option>
                                              ) : siteVendorOptions.length ===
                                                  0 && !useOtherSiteVendor ? (
                                                <>
                                                  <option value="">
                                                    {vendorError ||
                                                      'No vendor for this site'}
                                                  </option>
                                                  <option
                                                    value={
                                                      USE_OTHER_SITE_VENDOR_OPTION
                                                    }
                                                  >
                                                    Use vendor from other site
                                                  </option>
                                                </>
                                              ) : otherSiteVendorLoading ? (
                                                <option value="">
                                                  Loading vendors...
                                                </option>
                                              ) : useOtherSiteVendor &&
                                                vendorOptions.length === 0 ? (
                                                <option value="">
                                                  {otherSiteVendorError ||
                                                    'No vendor from other site'}
                                                </option>
                                              ) : useOtherSiteVendor ? (
                                                <option value="">
                                                  Select vendor
                                                </option>
                                              ) : vendorOptions.length === 0 ? (
                                                <option value="">
                                                  {vendorError || 'No vendor'}
                                                </option>
                                              ) : null}
                                              {vendorOptions.map((option) => (
                                                <option
                                                  key={option.key}
                                                  value={option.key}
                                                >
                                                  {formatVendorOptionLabel(
                                                    option,
                                                  )}
                                                </option>
                                              ))}
                                            </select>
                                          </td>
                                          <td className="px-4 py-3 font-medium">
                                            {formatPrice(unitPrice)}
                                          </td>
                                          <td className="px-4 py-3 font-medium">
                                            {formatPrice(totalCost)}
                                          </td>
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                  <tfoot className="bg-background">
                                    <tr className="border-t border-border">
                                      <td
                                        colSpan={7}
                                        className="px-4 py-3 text-center text-xs font-bold uppercase tracking-[0.18em] text-foreground"
                                      >
                                        Estimated Total Cost
                                      </td>
                                      <td className="px-4 py-3 font-semibold">
                                        {formatPrice(estimatedTotalCost)}
                                      </td>
                                    </tr>
                                    <tr className="border-t border-border">
                                      <td
                                        colSpan={7}
                                        className="px-4 py-3 text-center text-xs font-bold uppercase tracking-[0.18em] text-foreground"
                                      >
                                        Estimated Cost/Pax
                                      </td>
                                      <td className="px-4 py-3 font-semibold">
                                        {formatPrice(estimatedCostPerPax)}
                                      </td>
                                    </tr>
                                  </tfoot>
                                </table>
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="border-t border-border bg-white px-5 py-4 text-center">
        <button
          type="button"
          onClick={handleAddRow}
          className="inline-flex items-center gap-2 rounded-md border border-primary bg-primary px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-primary-hover"
        >
          <i className="bi bi-plus-circle text-base" aria-hidden="true" />
          <span>Add row</span>
        </button>
      </div>
    </section>
  )
}

const SuperadminMenuManagementPage = () => {
  const { accessToken } = useAuth()
  const [searchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const [activeTab, setActiveTab] = useState<MenuManagementTab>(() =>
    isMenuManagementTab(tabParam) ? tabParam : 'recipes',
  )
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
  const [recipeRejectTarget, setRecipeRejectTarget] = useState<Recipe | null>(
    null,
  )
  const [recipeRejectReason, setRecipeRejectReason] = useState('')
  const [recipeRejectError, setRecipeRejectError] = useState('')
  const [recipeRejectSubmitting, setRecipeRejectSubmitting] = useState(false)
  const [editingRecipe, setEditingRecipe] = useState<BaseRecipe | null>(null)
  const [recipeImportOpen, setRecipeImportOpen] = useState(false)
  const [recipeImportFile, setRecipeImportFile] = useState<File | null>(null)
  const [recipeImportError, setRecipeImportError] = useState('')
  const [recipeImportMessage, setRecipeImportMessage] = useState('')
  const [recipeImporting, setRecipeImporting] = useState(false)
  const [recipeCostSyncing, setRecipeCostSyncing] = useState(false)

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
  const [rawMaterialImportJobId, setRawMaterialImportJobId] =
    useState<string | null>(null)
  const [rawMaterialImportCancelling, setRawMaterialImportCancelling] =
    useState(false)
  const [rawMaterialImportResult, setRawMaterialImportResult] =
    useState<ImportResult | null>(null)
  const [rawMaterialPriceUploadOpen, setRawMaterialPriceUploadOpen] =
    useState(false)
  const [rawMaterialPriceUploadFile, setRawMaterialPriceUploadFile] =
    useState<File | null>(null)
  const [rawMaterialPriceUploadError, setRawMaterialPriceUploadError] =
    useState('')
  const [rawMaterialPriceUploadMessage, setRawMaterialPriceUploadMessage] =
    useState('')
  const [rawMaterialPriceUploading, setRawMaterialPriceUploading] =
    useState(false)
  const [rawMaterialVendorOptionsByCode, setRawMaterialVendorOptionsByCode] =
    useState<Record<string, RawMaterialVendorPriceOption[]>>({})
  const [rawMaterialVendorLoadingByCode, setRawMaterialVendorLoadingByCode] =
    useState<Record<string, boolean>>({})
  const [rawMaterialVendorErrorByCode, setRawMaterialVendorErrorByCode] =
    useState<Record<string, string>>({})
  const [selectedRawMaterialVendorByCode, setSelectedRawMaterialVendorByCode] =
    useState<Record<string, string>>({})

  useEffect(() => {
    const nextTab = isMenuManagementTab(tabParam) ? tabParam : 'recipes'
    setActiveTab((current) => (current === nextTab ? current : nextTab))
  }, [tabParam])

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
    const siteName = recipe.siteName?.trim()
    if (siteName) return siteName
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
        '/superadmin/sites?limit=200',
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
        const nextRawMaterials = (data.items ?? [])
          .map(mapRawMaterial)
          .filter((rawMaterial) => rawMaterial.id)
        setRawMaterials(nextRawMaterials)
        setRawMaterialVendorOptionsByCode({})
        setRawMaterialVendorLoadingByCode({})
        setRawMaterialVendorErrorByCode({})
        setSelectedRawMaterialVendorByCode({})
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
        setRawMaterialVendorOptionsByCode({})
        setRawMaterialVendorLoadingByCode({})
        setRawMaterialVendorErrorByCode({})
        setSelectedRawMaterialVendorByCode({})
        setRawMaterialMeta((prev) => ({
          ...prev,
          loading: false,
          error: message,
        }))
      }
    },
    [accessToken, rawMaterialSearch],
  )

  const loadRawMaterialVendorPrices = useCallback(
    async (rawMaterial: RawMaterial) => {
      if (!accessToken) return

      const productCode = rawMaterial.productCode.trim()
      const productKey = getRawMaterialVendorProductKey(productCode)
      if (!productCode || !productKey) return
      if (
        Object.prototype.hasOwnProperty.call(
          rawMaterialVendorOptionsByCode,
          productKey,
        ) ||
        rawMaterialVendorLoadingByCode[productKey]
      ) {
        return
      }

      setRawMaterialVendorLoadingByCode((prev) => ({
        ...prev,
        [productKey]: true,
      }))
      setRawMaterialVendorErrorByCode((prev) => ({
        ...prev,
        [productKey]: '',
      }))

      try {
        const data = await apiFetch<RawMaterialVendorPriceApi[]>(
          `/raw-materials/${encodeURIComponent(productCode)}/vendor-prices`,
          undefined,
          accessToken,
        )
        const optionsByKey = new Map<string, RawMaterialVendorPriceOption>()
        const mappedOptions = (data ?? [])
          .map(mapRawMaterialVendorPriceOption)
          .filter(
            (option): option is RawMaterialVendorPriceOption =>
              option !== null,
          )
        mappedOptions.forEach((option) => {
          optionsByKey.set(option.key, option)
        })

        const options = Array.from(optionsByKey.values()).sort((a, b) =>
          [
            a.vendor,
            String(a.price ?? ''),
          ]
            .join(' ')
            .localeCompare(
              [b.vendor, String(b.price ?? '')].join(' '),
            ),
        )

        setRawMaterialVendorOptionsByCode((prev) => ({
          ...prev,
          [productKey]: options,
        }))
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to load vendors.'
        setRawMaterialVendorOptionsByCode((prev) => ({
          ...prev,
          [productKey]: [],
        }))
        setRawMaterialVendorErrorByCode((prev) => ({
          ...prev,
          [productKey]: message,
        }))
      } finally {
        setRawMaterialVendorLoadingByCode((prev) => ({
          ...prev,
          [productKey]: false,
        }))
      }
    },
    [
      accessToken,
      rawMaterialVendorLoadingByCode,
      rawMaterialVendorOptionsByCode,
    ],
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

  useEffect(() => {
    if (activeTab !== 'raw-materials') return

    const seenProductKeys = new Set<string>()
    rawMaterials.forEach((rawMaterial) => {
      const productKey = getRawMaterialVendorProductKey(
        rawMaterial.productCode,
      )
      if (!productKey || seenProductKeys.has(productKey)) return
      seenProductKeys.add(productKey)
      loadRawMaterialVendorPrices(rawMaterial).catch(() => null)
    })
  }, [activeTab, loadRawMaterialVendorPrices, rawMaterials])

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
      recipeCode: recipe.recipeCode,
      version: recipe.version,
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

  const syncRecipeCosts = async () => {
    if (!accessToken || recipeCostSyncing) return

    setRecipeCostSyncing(true)
    setRecipeMessage('')
    setRecipeMeta((prev) => ({ ...prev, error: '' }))
    try {
      const result = await apiFetch<IngredientCostBackfillResult>(
        '/recipes/ingredient-costs/backfill',
        { method: 'PATCH' },
        accessToken,
      )
      setRecipeMessage(
        `Synced ${result.updatedRecipes} recipes and ${result.updatedIngredients} ingredient costs.`,
      )
      fetchRecipes(recipeMeta.page, recipeMeta.limit, recipeSearch).catch(
        () => null,
      )
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to sync recipe costs.'
      setRecipeMeta((prev) => ({ ...prev, error: message }))
    } finally {
      setRecipeCostSyncing(false)
    }
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

  const openRecipeRejectModal = (recipe: Recipe) => {
    setRecipeRejectTarget(recipe)
    setRecipeRejectReason('')
    setRecipeRejectError('')
  }

  const closeRecipeRejectModal = () => {
    if (recipeRejectSubmitting) return
    setRecipeRejectTarget(null)
    setRecipeRejectReason('')
    setRecipeRejectError('')
  }

  const rejectRecipe = async () => {
    if (!accessToken || !recipeRejectTarget) return
    const recipeId = recipeRejectTarget.id ?? recipeRejectTarget._id
    const reason = recipeRejectReason.trim()
    if (!recipeId) return
    if (!reason) {
      setRecipeRejectError('Notes wajib diisi.')
      return
    }

    setRecipeRejectSubmitting(true)
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
      setRecipeRejectTarget(null)
      setRecipeRejectReason('')
      setRecipeRejectError('')
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to reject recipe.'
      setRecipeRejectError(message)
    } finally {
      setRecipeRejectSubmitting(false)
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
    setRawMaterialImportJobId(null)
    setRawMaterialImportCancelling(false)
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

  const openRawMaterialPriceUploadModal = () => {
    setRawMaterialPriceUploadFile(null)
    setRawMaterialPriceUploadError('')
    setRawMaterialPriceUploadMessage('')
    setRawMaterialPriceUploadOpen(true)
  }

  const closeRawMaterialPriceUploadModal = () => {
    if (rawMaterialPriceUploading) return
    setRawMaterialPriceUploadOpen(false)
  }

  const handleRawMaterialPriceUploadFileChange = (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const nextFile = event.target.files?.[0] ?? null
    setRawMaterialPriceUploadMessage('')

    if (!nextFile) {
      setRawMaterialPriceUploadFile(null)
      setRawMaterialPriceUploadError('')
      return
    }

    const isValidFile = /\.(xlsx|csv)$/i.test(nextFile.name)
    if (!isValidFile) {
      setRawMaterialPriceUploadFile(null)
      setRawMaterialPriceUploadError('File must be .xlsx or .csv')
      return
    }

    setRawMaterialPriceUploadFile(nextFile)
    setRawMaterialPriceUploadError('')
  }

  const handleUploadRawMaterialPrices = async () => {
    if (!accessToken) return
    if (!rawMaterialPriceUploadFile) {
      setRawMaterialPriceUploadError('Select an Excel or CSV file first.')
      setRawMaterialPriceUploadMessage('')
      return
    }
    if (rawMaterialPriceUploading) return

    setRawMaterialPriceUploading(true)
    setRawMaterialPriceUploadError('')
    setRawMaterialPriceUploadMessage('Updating prices...')

    try {
      const formData = new FormData()
      formData.append('file', rawMaterialPriceUploadFile)
      const result = await apiFetch<RawMaterialPriceUploadResult>(
        '/raw-materials/prices/upload',
        {
          method: 'POST',
          body: formData,
        },
        accessToken,
      )
      const costSyncResult =
        result.mode === 'vendor'
          ? null
          : await apiFetch<IngredientCostBackfillResult>(
              '/recipes/ingredient-costs/backfill',
              { method: 'PATCH' },
              accessToken,
            )
      const notFoundText = result.notFoundCount
        ? ` Skipped ${result.notFoundRowCount} rows for ${result.notFoundCount} product codes that were not found${
            result.notFoundProductCodes.length
              ? `: ${result.notFoundProductCodes.join(', ')}`
              : '.'
          }`
        : ''
      const duplicateText = result.vendorPriceDuplicateRemovedCount
        ? ` Removed ${result.vendorPriceDuplicateRemovedCount} stale duplicate vendor records.`
        : ''
      const quantityText = result.priceQuantityAdjustedCount
        ? ` Read price quantities on ${result.priceQuantityAdjustedCount} rows without changing the imported prices.`
        : ''
      const conflictText = result.conflictingVendorPriceCount
        ? ` Resolved ${result.conflictingVendorPriceCount} repeated vendor prices using the closest non-future Start Date; ties use the highest unit price.`
        : ''

      if (result.mode === 'vendor') {
        setRawMaterialPriceUploadMessage(
          `Updated ${result.vendorPriceModifiedCount} vendor prices and added ${result.vendorPriceUpsertedCount} vendor prices for ${result.matchedProductCount} existing raw materials.${duplicateText}${quantityText}${conflictText}${notFoundText}`,
        )
      } else {
        const vendorText = result.vendorPriceRequestedCount
          ? ` Updated ${result.vendorPriceModifiedCount} vendor prices and added ${result.vendorPriceUpsertedCount} vendor prices.${duplicateText}${quantityText}${conflictText}`
          : ''
        setRawMaterialPriceUploadMessage(
          `Updated ${result.modifiedCount} master prices from ${result.matchedCount} matched raw materials. Synced ${costSyncResult?.updatedIngredients ?? 0} approved recipe ingredient costs.${vendorText}${notFoundText}`,
        )
      }
      setRawMaterialPriceUploadFile(null)
      setRawMaterialVendorOptionsByCode({})
      setSelectedRawMaterialVendorByCode({})
      fetchRawMaterials(
        rawMaterialMeta.page,
        rawMaterialMeta.limit,
        rawMaterialSearch,
      ).catch(() => null)
    } catch (error) {
      setRawMaterialPriceUploadError(
        error instanceof Error
          ? error.message
          : 'Failed to update raw material prices.',
      )
      setRawMaterialPriceUploadMessage('')
    } finally {
      setRawMaterialPriceUploading(false)
    }
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
    setRawMaterialImportJobId(null)
    setRawMaterialImportCancelling(false)

    try {
      const formData = new FormData()
      formData.append('file', rawMaterialImportFile)
      const job = await apiFetch<{ jobId: string }>(
        '/imports/raw-materials/upload',
        {
          method: 'POST',
          body: formData,
        },
        accessToken,
      )
      setRawMaterialImportJobId(job.jobId)
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
      setRawMaterialImportJobId(null)
      setRawMaterialImportCancelling(false)
    }
  }

  const handleCancelRawMaterialImport = async () => {
    if (!accessToken || !rawMaterialImportJobId || rawMaterialImportCancelling) {
      return
    }

    setRawMaterialImportCancelling(true)
    setRawMaterialImportError('')
    setRawMaterialImportMessage('Cancelling import...')

    try {
      const result = await apiFetch<{ status: string }>(
        `/imports/jobs/${encodeURIComponent(rawMaterialImportJobId)}/cancel`,
        { method: 'POST' },
        accessToken,
      )
      if (result.status === 'completed' || result.status === 'failed') {
        setRawMaterialImportResult({
          status: result.status === 'completed' ? 'success' : 'error',
          title:
            result.status === 'completed'
              ? 'Import already completed'
              : 'Import already failed',
          message:
            result.status === 'completed'
              ? 'The import finished before the cancellation request was applied.'
              : 'The import failed before the cancellation request was applied.',
        })
        setRawMaterialImporting(false)
        setRawMaterialImportOpen(false)
        setRawMaterialImportMessage('')
        setRawMaterialImportFile(null)
        setRawMaterialImportStartedAt(null)
        setRawMaterialImportJobId(null)
        return
      }

      const isRequested = result.status === 'cancel_requested'
      setRawMaterialImportResult({
        status: 'cancelled',
        title: isRequested ? 'Import cancellation requested' : 'Import cancelled',
        message: isRequested
          ? 'The import is active and will stop at the next safe checkpoint.'
          : 'The import job was cancelled before it completed.',
      })
      setRawMaterialImporting(false)
      setRawMaterialImportOpen(false)
      setRawMaterialImportMessage('')
      setRawMaterialImportFile(null)
      setRawMaterialImportStartedAt(null)
      setRawMaterialImportJobId(null)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to cancel import.'
      setRawMaterialImportError(message)
      setRawMaterialImportMessage('')
    } finally {
      setRawMaterialImportCancelling(false)
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
            item.title !== 'Raw material import failed' &&
            item.title !== 'Raw material import cancelled'
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
          const isCancelled = match.title === 'Raw material import cancelled'
          let message = match.message ?? ''
          if (!isSuccess && !isCancelled) {
            const reason =
              match.meta && typeof match.meta.reason === 'string'
                ? match.meta.reason
                : ''
            if (reason) message = `${message} (${reason})`
          }

          setRawMaterialImportResult({
            status: isSuccess ? 'success' : isCancelled ? 'cancelled' : 'error',
            title: match.title ?? 'Import finished',
            message: message || 'Import finished.',
          })
          setRawMaterialImporting(false)
          setRawMaterialImportOpen(false)
          setRawMaterialImportError('')
          setRawMaterialImportMessage('')
          setRawMaterialImportFile(null)
          setRawMaterialImportStartedAt(null)
          setRawMaterialImportJobId(null)
          setRawMaterialImportCancelling(false)
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
        setRawMaterialImportJobId(null)
        setRawMaterialImportCancelling(false)
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
                  {editingCategoryId ? (
                    <ActionButton
                      action="save"
                      onClick={saveCategory}
                      className="flex-1"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={saveCategory}
                      className="flex-1 rounded-md bg-primary px-4 py-3 text-sm font-semibold text-white"
                    >
                      Create category
                    </button>
                  )}
                  <ActionButton action="cancel" onClick={closeCategoryModal} />
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {recipeRejectTarget ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div
              className="w-full max-w-xl rounded-md border border-border bg-surface p-6 shadow-xl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="recipe-reject-title"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-muted">Force rejection</p>
                  <h3
                    id="recipe-reject-title"
                    className="mt-1 text-lg font-semibold text-foreground"
                  >
                    Reject recipe
                  </h3>
                  <p className="mt-2 text-sm text-muted">
                    {recipeRejectTarget.name}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeRecipeRejectModal}
                  disabled={recipeRejectSubmitting}
                  className="dm-x-button disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label="Close recipe rejection form"
                  title="Close"
                >
                  <i
                    className="bi bi-x-lg text-sm leading-none"
                    aria-hidden="true"
                  />
                </button>
              </div>

              <div className="mt-5">
                <label
                  htmlFor="recipe-reject-reason"
                  className="text-sm font-medium text-foreground"
                >
                  Notes / rejection reason
                </label>
                <textarea
                  id="recipe-reject-reason"
                  value={recipeRejectReason}
                  onChange={(event) => {
                    setRecipeRejectReason(event.target.value)
                    if (recipeRejectError) setRecipeRejectError('')
                  }}
                  rows={5}
                  maxLength={500}
                  autoFocus
                  placeholder="Explain why this recipe is being rejected."
                  className="mt-2 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                />
                <div className="mt-2 flex items-center justify-between text-xs text-muted">
                  <span>Notes ini akan disimpan di approval history.</span>
                  <span>{recipeRejectReason.length}/500</span>
                </div>
                {recipeRejectError ? (
                  <p className="mt-3 text-xs font-medium text-red-600">
                    {recipeRejectError}
                  </p>
                ) : null}
              </div>

              <div className="mt-6 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={closeRecipeRejectModal}
                  disabled={recipeRejectSubmitting}
                  className="rounded-md border border-border bg-background px-4 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void rejectRecipe()}
                  disabled={recipeRejectSubmitting}
                  className="rounded-md bg-danger px-4 py-2 text-xs font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {recipeRejectSubmitting ? 'Rejecting...' : 'Confirm reject'}
                </button>
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

                <ActionButton
                  action="import"
                  onClick={handleImportRecipes}
                  disabled={recipeImporting}
                  className="h-fit self-end"
                />
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
                {editingRawMaterialId ? (
                  <ActionButton
                    action="save"
                    onClick={saveRawMaterial}
                    className="flex-1"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={saveRawMaterial}
                    className="flex-1 rounded-md bg-primary px-4 py-3 text-sm font-semibold text-white"
                  >
                    Create raw material
                  </button>
                )}
                <ActionButton action="cancel" onClick={closeRawMaterialModal} />
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
                    Upload a file to add new raw materials. Existing product
                    codes are skipped; use Update Prices for price or vendor
                    changes.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeRawMaterialImportModal}
                  disabled={rawMaterialImporting || rawMaterialImportCancelling}
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
                    disabled={rawMaterialImporting || rawMaterialImportCancelling}
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
                {rawMaterialImporting ? (
                  <ActionButton
                    action="cancel"
                    onClick={handleCancelRawMaterialImport}
                    disabled={!rawMaterialImportJobId || rawMaterialImportCancelling}
                    fullWidth
                  />
                ) : (
                  <ActionButton
                    action="import"
                    onClick={handleImportRawMaterials}
                    disabled={rawMaterialImporting}
                    fullWidth
                  />
                )}
                {rawMaterialImportMessage ? (
                  <p className="text-xs font-medium text-primary">
                    {rawMaterialImportMessage}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {rawMaterialPriceUploadOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div
              className="w-full max-w-xl rounded-md border border-border bg-surface p-6 shadow-xl"
              role="dialog"
              aria-modal="true"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-foreground">
                    Update Raw Material Prices
                  </h3>
                  <p className="mt-1 text-xs text-muted">
                    Use Product Code + Price to update master prices, or upload
                    the full pricelist with Site, Vendor, Quantity, UOM, and
                    Price to update or add vendor prices for existing raw
                    materials. Unknown product codes will not be created.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeRawMaterialPriceUploadModal}
                  disabled={rawMaterialPriceUploading}
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
                    accept=".xlsx,.csv"
                    onChange={handleRawMaterialPriceUploadFileChange}
                    disabled={rawMaterialPriceUploading}
                    className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-2 text-sm shadow-sm file:mr-4 file:rounded-xl file:border-0 file:bg-primary-soft file:px-3 file:py-2 file:text-xs file:font-semibold file:text-primary"
                  />
                  {rawMaterialPriceUploadFile ? (
                    <p className="mt-2 text-xs text-muted">
                      Selected file: {rawMaterialPriceUploadFile.name}
                    </p>
                  ) : null}
                  {rawMaterialPriceUploadError ? (
                    <p className="mt-2 text-xs font-medium text-danger">
                      {rawMaterialPriceUploadError}
                    </p>
                  ) : null}
                  {rawMaterialPriceUploading ? (
                    <div className="mt-3" aria-label="Price update in progress">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-primary-soft">
                        <div className="h-full w-2/3 animate-pulse rounded-full bg-primary" />
                      </div>
                      <span className="sr-only">Price update in progress</span>
                    </div>
                  ) : null}
                </div>
                <ActionButton
                  action="update"
                  onClick={handleUploadRawMaterialPrices}
                  disabled={rawMaterialPriceUploading}
                  fullWidth
                />
                {rawMaterialPriceUploadMessage ? (
                  <p className="text-xs font-medium text-primary">
                    {rawMaterialPriceUploadMessage}
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
                        : rawMaterialImportResult.status === 'cancelled'
                          ? 'text-amber-700'
                        : 'text-red-600'
                    }`}
                  >
                    {rawMaterialImportResult.title}
                  </h3>
                  <p className="mt-2 text-sm text-muted">
                    {rawMaterialImportResult.message}
                  </p>
                </div>
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

        {activeTab === 'menu-production' ? (
          <ChefMenuCycle
            embedded
            title="Menu Production"
            description="Create production menus for any site before they move into the approval and store request flow."
            requireProductionSite
            requireProductionActors
            productionSiteOptions={siteOptions}
            submitLabel="Submit"
            emptySiteMessage="Select a production site first."
            showEstimatedCostColumns
            showIngredientCostColumns
            showIngredientVendorColumn
          />
        ) : null}

        {activeTab === 'recipe-calculator' ? <RecipeCalculator /> : null}

        {activeTab === 'create-recipe' ? (
          <ChefCreateMenu
            embedded
            enableIngredientUomConversion
            lockSrUomToRawMaterial
            onSaved={() => {
              handleRecipeSaved('Recipe created.')
            }}
          />
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
                onClick={syncRecipeCosts}
                disabled={!accessToken || recipeCostSyncing}
                className="inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary-soft px-4 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                <i className="bi bi-arrow-repeat text-base" aria-hidden="true" />
                <span>{recipeCostSyncing ? 'Syncing...' : 'Sync costs'}</span>
              </button>
              <ActionButton
                action="import"
                onClick={openRecipeImportModal}
                iconClassName="bi bi-upload text-base"
                size="sm"
              />
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
                  <th className="px-5 py-4 font-semibold">Version</th>
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
                    <td colSpan={9} className="px-5 py-10 text-center text-muted">
                      Loading recipe data...
                    </td>
                  </tr>
                ) : recipes.length === 0 ? (
                  <tr className="border-t border-border">
                    <td colSpan={9} className="px-5 py-10 text-center text-muted">
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
                        <td className="px-5 py-4 font-semibold text-foreground">
                          {formatRecipeVersion(recipe.version)}
                        </td>
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
                                  onClick={() => openRecipeRejectModal(recipe)}
                                  className="rounded-md border border-warning bg-background px-3 py-1 text-xs font-semibold text-warning"
                                >
                                  <span className="flex items-center gap-1.5">
                                    <i className="bi bi-x-circle text-sm" aria-hidden="true" />
                                    <span>Reject</span>
                                  </span>
                                </button>
                              </>
                            ) : recipe.approvalStatus === 'approved' ? (
                              <button
                                type="button"
                                onClick={() => openRecipeRejectModal(recipe)}
                                className="rounded-md border border-danger bg-background px-3 py-1 text-xs font-semibold text-danger"
                              >
                                <span className="flex items-center gap-1.5">
                                  <i className="bi bi-x-circle text-sm" aria-hidden="true" />
                                  <span>Force reject</span>
                                </span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => approveRecipe(recipe)}
                                className="rounded-md border border-success bg-background px-3 py-1 text-xs font-semibold text-success"
                              >
                                <span className="flex items-center gap-1.5">
                                  <i className="bi bi-check2-circle text-sm" aria-hidden="true" />
                                  <span>Force approve</span>
                                </span>
                              </button>
                            )}
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

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div className="rounded-md border border-border bg-background p-4">
                <p className="text-xs text-muted">Version</p>
                <p className="mt-2 text-sm font-semibold text-primary">
                  {formatRecipeVersion(selectedRecipe.version)}
                </p>
              </div>
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
                        <th className="px-4 py-3 font-semibold">Type</th>
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
                            {ingredient.ingredientType || '-'}
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
              <ActionButton
                action="update"
                onClick={openRawMaterialPriceUploadModal}
                iconClassName="bi bi-cash-coin text-base"
                size="sm"
              />
              <ActionButton
                action="import"
                onClick={openRawMaterialImportModal}
                iconClassName="bi bi-upload text-base"
                size="sm"
              />
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
                  <th className="px-5 py-4 font-semibold">Vendor</th>
                  <th className="px-5 py-4 font-semibold">Unit of Measures</th>
                  <th className="px-5 py-4 font-semibold">Price</th>
                  <th className="px-5 py-4 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {rawMaterialMeta.loading ? (
                  <tr className="border-t border-border">
                    <td colSpan={7} className="px-5 py-10 text-center text-muted">
                      Loading raw materials...
                    </td>
                  </tr>
                ) : rawMaterials.length === 0 ? (
                  <tr className="border-t border-border">
                    <td colSpan={7} className="px-5 py-10 text-center text-muted">
                      {rawMaterialMeta.error
                        ? rawMaterialMeta.error
                        : 'No raw materials yet.'}
                    </td>
                  </tr>
                ) : (
                  rawMaterials.map((rawMaterial, index) => {
                    const productKey = getRawMaterialVendorProductKey(
                      rawMaterial.productCode,
                    )
                    const vendorOptions =
                      rawMaterialVendorOptionsByCode[productKey] ?? []
                    const vendorLoading =
                      rawMaterialVendorLoadingByCode[productKey] ?? false
                    const vendorError =
                      rawMaterialVendorErrorByCode[productKey] ?? ''
                    const selectedVendorKey =
                      selectedRawMaterialVendorByCode[productKey] ??
                      pickDefaultVendorOption(rawMaterial, vendorOptions)?.key ??
                      ''
                    const selectedVendorOption = vendorOptions.find(
                      (option) => option.key === selectedVendorKey,
                    )
                    const displayPrice = selectedVendorOption
                      ? getVendorUnitPrice(selectedVendorOption)
                      : rawMaterial.price

                    return (
                      <tr
                        key={rawMaterial.id}
                        className="border-t border-border"
                      >
                        <td className="px-5 py-4 text-sm text-muted">
                          {(rawMaterialMeta.page - 1) * rawMaterialMeta.limit +
                            index +
                            1}
                        </td>
                        <td className="px-5 py-4">
                          {rawMaterial.productCode}
                        </td>
                        <td className="px-5 py-4">{rawMaterial.name}</td>
                        <td className="px-5 py-4 align-top">
                          {vendorOptions.length > 0 ? (
                            <select
                              value={selectedVendorKey}
                              onChange={(event) =>
                                setSelectedRawMaterialVendorByCode((prev) => ({
                                  ...prev,
                                  [productKey]: event.target.value,
                                }))
                              }
                              className="w-56 rounded-xl border border-border bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                            >
                              {vendorOptions.length > 1 ? (
                                <option value="">Select vendor</option>
                              ) : null}
                              {vendorOptions.map((option) => (
                                <option key={option.key} value={option.key}>
                                  {formatVendorOptionLabel(option)}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span
                              title={vendorError || undefined}
                              className="block w-56 whitespace-normal break-words"
                            >
                              {vendorLoading
                                ? 'Loading vendors...'
                                : rawMaterial.vendor || '-'}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          {formatUnitLabel(rawMaterial.unitOfMeasures)}
                        </td>
                        <td className="px-5 py-4 font-medium">
                          {formatPrice(displayPrice)}
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
                    )
                  })
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
