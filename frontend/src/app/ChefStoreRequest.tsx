import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import ActionButton from '../components/ActionButton'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useChefData, type Recipe } from '../lib/chef-data'
import { formatQuantity, formatSignedQuantity, quantitiesDiffer } from '../lib/quantity'
import { formatRecipeVersion } from '../lib/recipe-version'
import {
  aggregateStoreRequestSummary,
  aggregateStoreRequestSummaryByVendor,
} from '../lib/store-request-summary'
import { getApprovalStatusLabel, getStoreRequestStatusLabel } from '../lib/status-labels'
import { formatUnitLabel } from '../lib/unit-of-measures'
import {
  downloadSpreadsheet,
  toSpreadsheetDate,
  toSpreadsheetDecimal,
  toSpreadsheetInteger,
  type SpreadsheetCell,
} from '../lib/spreadsheet-export'

type StoreRequestIngredient = {
  ingredientType?: 'IT' | 'NMP'
  productCode: string
  name: string
  unitOfMeasures: string
  qty: number
  vendor?: string
  vendorSite?: string
  price?: number
  ingredientCost?: number
}

type RawMaterialVendorPriceApi = {
  productCode?: string
  site?: string
  vendor?: string
  currency?: string
  unitOfMeasures?: string
  minimumQuantity?: number
  price?: number
}

type ReplacementVendorOption = {
  key: string
  productCode: string
  site: string
  vendor: string
  currency?: string
  unitOfMeasures: string
  minimumQuantity?: number
  price?: number
}

type ReplacementIngredientVendorInput = {
  ingredientIndex: number
  productCode?: string
  name?: string
  unitOfMeasures?: string
  vendor?: string
  site?: string
  currency?: string
  minimumQuantity?: number
  price?: number
}

type ChangeMenuScope = 'all' | 'group' | 'menu' | 'portion'

type StoreRequestFulfillment = {
  status?: 'fulfilled' | 'cancelled'
  completedBy?: string
  completedAt?: string
  note?: string
  items: Array<{
    productCode: string
    name: string
    unitOfMeasures: string
    plannedQty: number
    actualQty: number
    varianceQty: number
    reason?: string
  }>
}

type StoreRequestMenu = {
  id: string
  productionCode?: string
  submittedAt?: string
  recipeId?: string
  recipeCode?: string
  recipeVersion?: number
  menuName: string
  clientName?: string
  category: string
  group?: string
  portion: number
  estimatedCost?: number
  estimatedCostPerPax?: number
  approvalStatus: 'pending' | 'approved' | 'rejected'
  rejectionReason?: string
  reviewedBy?: string
  storeRequestStatus: 'not-requested' | 'requested' | 'fulfilled' | 'cancelled'
  fulfilledBy?: string
  fulfilledAt?: string
  cancelledBy?: string
  cancelledAt?: string
  cancellationReason?: string
  portionSize: number
  ingredients: StoreRequestIngredient[]
  missingRecipe: boolean
}

type StoreRequestGroup = {
  site?: string
  date: string
  productionCode?: string
  items: StoreRequestMenu[]
  summary: StoreRequestIngredient[]
  missingRecipes: string[]
  fulfillment?: StoreRequestFulfillment
}

const getGroupSubmittedAt = (group: StoreRequestGroup) =>
  group.items.find((item) => item.submittedAt)?.submittedAt

const formatCreatedDate = (value?: string) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

type ReconciliationRow = {
  id: string
  productCode: string
  name: string
  unitOfMeasures: string
  plannedQty: number
  actualQty: string
  reason: string
  isAdditional: boolean
}

const ITEMS_PER_PAGE = 10

const formatPrice = (value?: number) => {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return '-'
  }
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(value)
}

const getMenuCostSummary = (menu: StoreRequestMenu) => {
  const estimatedCost = Number.isFinite(Number(menu.estimatedCost))
    ? Number(menu.estimatedCost)
    : undefined
  const estimatedCostPerPax = Number.isFinite(
    Number(menu.estimatedCostPerPax),
  )
    ? Number(menu.estimatedCostPerPax)
    : estimatedCost !== undefined && menu.portion > 0
      ? estimatedCost / menu.portion
      : undefined

  return { estimatedCost, estimatedCostPerPax }
}

const getReplacementVendorUnitPrice = (option?: ReplacementVendorOption) => {
  const price = Number(option?.price)
  return Number.isFinite(price) ? price : undefined
}

const getReplacementIngredientFallbackPrice = (ingredient: {
  qty: number
  priceUom?: number
  foodCost?: number
}) => {
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

const formatReplacementRecipeLabel = (recipe: Recipe) =>
  `${recipe.recipeCode ?? '-'} - ${recipe.name} (${formatRecipeVersion(recipe.version)})`

const normalizeRecipeSearch = (value: string) => value.trim().toLowerCase()

type StoreRequestSiteOption = {
  code: string
  name: string
}

type MenuGroupApi = {
  id?: string
  _id?: string
  name?: string
}

type MenuGroupOption = {
  id: string
  name: string
}

type ChefStoreRequestProps = {
  requireSiteSelection?: boolean
  siteOptions?: StoreRequestSiteOption[]
  enableStoreRequestCancellation?: boolean
  enableStoreRequestCompletion?: boolean
  enableBulkExport?: boolean
  actionMode?: 'buttons' | 'select'
}

const getStoreRequestGroupKey = (group: {
  site?: string
  date: string
  productionCode?: string
}) =>
  `${group.site ?? 'no-site'}__${group.date}__${group.productionCode ?? 'no-code'}`

const mergeStoreRequestGroups = (groups: StoreRequestGroup[]) => {
  const groupedByBatch = new Map<
    string,
    {
      site?: string
      date: string
      productionCode?: string
      items: StoreRequestMenu[]
      summary: StoreRequestIngredient[]
      missingRecipes: Set<string>
      fulfillment?: StoreRequestFulfillment
    }
  >()

  groups.forEach((group) => {
    const groupKey = getStoreRequestGroupKey(group)
    const bucket = groupedByBatch.get(groupKey) ?? {
      site: group.site,
      date: group.date,
      productionCode: group.productionCode,
      items: [],
      summary: [],
      missingRecipes: new Set<string>(),
    }

    bucket.items.push(...group.items)
    bucket.summary = aggregateStoreRequestSummary([
      ...bucket.summary,
      ...(group.summary ?? []),
    ])

    group.missingRecipes.forEach((item) => {
      const value = item.trim()
      if (value) bucket.missingRecipes.add(value)
    })

    if (!bucket.fulfillment && group.fulfillment) {
      bucket.fulfillment = group.fulfillment
    }

    groupedByBatch.set(groupKey, bucket)
  })

  return Array.from(groupedByBatch.values())
    .map((group) => ({
      site: group.site,
      date: group.date,
      productionCode: group.productionCode,
      items: group.items,
      summary: group.summary,
      missingRecipes: Array.from(group.missingRecipes.values()),
      fulfillment: group.fulfillment,
    }))
    .sort((a, b) => {
      const byDate = b.date.localeCompare(a.date)
      if (byDate !== 0) return byDate
      return (b.productionCode ?? '').localeCompare(a.productionCode ?? '')
    })
}

const buildStoreRequestExportRows = (groups: StoreRequestGroup[]) => {
  const rows: SpreadsheetCell[][] = [
    [
      'No',
      'Created Date',
      'Production Date',
      'Site',
      'Client Name',
      'Production Code',
      'Menu Name',
      'Version',
      'Recipe Code',
      'Category',
      'Portion',
      'Product Type',
      'Product Code',
      'Ingredient Name',
      'Vendor',
      'Planned QTY',
      'Unit',
      'Price',
      'Ingredient Cost',
    ],
  ]

  let rowNumber = 1
  groups.forEach((group) => {
    group.items.forEach((menu) => {
      const ingredients = menu.ingredients ?? []
      if (ingredients.length === 0) {
        rows.push([
          rowNumber,
          formatCreatedDate(menu.submittedAt),
          toSpreadsheetDate(group.date),
          group.site ?? '',
          menu.clientName ?? '',
          group.productionCode ?? '',
          menu.menuName,
          formatRecipeVersion(menu.recipeVersion),
          menu.recipeCode ?? menu.recipeId ?? '',
          menu.category,
          menu.portion,
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
        ])
        rowNumber += 1
        return
      }

      ingredients.forEach((ingredient) => {
        rows.push([
          rowNumber,
          formatCreatedDate(menu.submittedAt),
          toSpreadsheetDate(group.date),
          group.site ?? '',
          menu.clientName ?? '',
          group.productionCode ?? '',
          menu.menuName,
          formatRecipeVersion(menu.recipeVersion),
          menu.recipeCode ?? menu.recipeId ?? '',
          menu.category,
          menu.portion,
          ingredient.ingredientType ?? '',
          ingredient.productCode,
          ingredient.name,
          ingredient.vendor ?? '',
          toSpreadsheetDecimal(formatQuantity(ingredient.qty)),
          formatUnitLabel(ingredient.unitOfMeasures),
          toSpreadsheetInteger(ingredient.price),
          toSpreadsheetInteger(ingredient.ingredientCost),
        ])
        rowNumber += 1
      })
    })
  })

  return rows
}

const buildIngredientSummaryExportRows = (groups: StoreRequestGroup[]) => {
  const rows: SpreadsheetCell[][] = [
    [
      'Production Date',
      'Site',
      'Client Name',
      'Product Type',
      'Product Code',
      'Ingredient Name',
      'Vendor',
      'QTY',
      'Unit',
    ],
  ]

  groups.forEach((group) => {
    aggregateStoreRequestSummaryByVendor(group).forEach((item) => {
      rows.push([
        toSpreadsheetDate(group.date),
        group.site ?? '',
        group.items[0]?.clientName ?? '',
        item.ingredientType ?? '',
        item.productCode,
        item.name,
        item.vendor ?? '',
        toSpreadsheetDecimal(formatQuantity(item.qty)),
        formatUnitLabel(item.unitOfMeasures),
      ])
    })
  })

  return rows
}

const buildEstimatedCostExportRows = (groups: StoreRequestGroup[]) => {
  const rows: SpreadsheetCell[][] = [
    [
      'Production Date',
      'Site',
      'Client Name',
      'Menu Name',
      'Version',
      'Category',
      'Portion',
      'Estimated Total Cost',
      'Cost Per Pax',
    ],
  ]

  groups.forEach((group) => {
    group.items.forEach((menu) => {
      const estimatedTotalCost = Number.isFinite(menu.estimatedCost)
        ? menu.estimatedCost
        : undefined
      const estimatedCostPerPax = Number.isFinite(menu.estimatedCostPerPax)
        ? menu.estimatedCostPerPax
        : estimatedTotalCost !== undefined && menu.portion > 0
          ? estimatedTotalCost / menu.portion
          : undefined

      rows.push([
      toSpreadsheetDate(group.date),
      group.site ?? '',
      menu.clientName ?? '',
      menu.menuName,
        formatRecipeVersion(menu.recipeVersion),
        menu.category,
        menu.portion,
        toSpreadsheetInteger(estimatedTotalCost),
        toSpreadsheetInteger(estimatedCostPerPax),
      ])
    })
  })

  return rows
}

const toInputDate = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const ChefStoreRequest = ({
  requireSiteSelection = false,
  siteOptions = [],
  enableStoreRequestCancellation = false,
  enableStoreRequestCompletion = false,
  enableBulkExport = true,
  actionMode = 'buttons',
}: ChefStoreRequestProps = {}) => {
  const { accessToken, user } = useAuth()
  const {
    cancelPendingMenuProductionBatch,
    cancelStoreRequestBatch,
    fetchRecipes,
    fulfillStoreRequestBatch,
    recipes,
    searchRecipes,
  } = useChefData()
  const [selectedSite, setSelectedSite] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<string[]>([])
  const [groups, setGroups] = useState<StoreRequestGroup[]>([])
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [cancellingGroupKey, setCancellingGroupKey] = useState<string | null>(null)
  const [pendingCancellationGroup, setPendingCancellationGroup] =
    useState<StoreRequestGroup | null>(null)
  const [pendingCancellationMenu, setPendingCancellationMenu] =
    useState<StoreRequestMenu | null>(null)
  const [cancellationGroup, setCancellationGroup] =
    useState<StoreRequestGroup | null>(null)
  const [cancellationMenu, setCancellationMenu] =
    useState<StoreRequestMenu | null>(null)
  const [cancellationReason, setCancellationReason] = useState('')
  const [cancellationError, setCancellationError] = useState('')
  const [completionGroup, setCompletionGroup] =
    useState<StoreRequestGroup | null>(null)
  const [completionRows, setCompletionRows] = useState<ReconciliationRow[]>([])
  const [completionNote, setCompletionNote] = useState('')
  const [completionError, setCompletionError] = useState('')
  const [bulkExportOpen, setBulkExportOpen] = useState(false)
  const [bulkExportStartDate, setBulkExportStartDate] = useState(() => {
    const today = new Date()
    return toInputDate(new Date(today.getFullYear(), today.getMonth(), 1))
  })
  const [bulkExportEndDate, setBulkExportEndDate] = useState(() =>
    toInputDate(new Date()),
  )
  const [bulkExportError, setBulkExportError] = useState('')
  const [bulkExporting, setBulkExporting] = useState(false)
  const [changingMenuId, setChangingMenuId] = useState<string | null>(null)
  const [changeMenuScope, setChangeMenuScope] =
    useState<ChangeMenuScope | null>(null)
  const [replacementGroup, setReplacementGroup] = useState('')
  const [replacementRecipeId, setReplacementRecipeId] = useState('')
  const [replacementRecipeQuery, setReplacementRecipeQuery] = useState('')
  const [replacementRecipeSearchResults, setReplacementRecipeSearchResults] =
    useState<Recipe[]>([])
  const [replacementRecipeDropdownOpen, setReplacementRecipeDropdownOpen] =
    useState(false)
  const [replacementSite, setReplacementSite] = useState('')
  const [replacementPortion, setReplacementPortion] = useState('')
  const [replacementVendorOptions, setReplacementVendorOptions] = useState<
    Record<number, ReplacementVendorOption[]>
  >({})
  const [replacementSelectedVendors, setReplacementSelectedVendors] =
    useState<Record<number, string>>({})
  const [replacementCustomPrices, setReplacementCustomPrices] = useState<
    Record<number, string>
  >({})
  const [replacementVendorErrors, setReplacementVendorErrors] = useState<
    Record<number, string>
  >({})
  const [replacementVendorLoading, setReplacementVendorLoading] =
    useState(false)
  const replacementVendorRequestRef = useRef(0)
  const replacementRecipeInputRef = useRef<HTMLInputElement | null>(null)
  const replacementRecipeDropdownRef = useRef<HTMLDivElement | null>(null)
  const [changeMenuError, setChangeMenuError] = useState('')
  const [changeMenuSubmitting, setChangeMenuSubmitting] = useState(false)
  const [menuGroupOptions, setMenuGroupOptions] = useState<MenuGroupOption[]>([])
  const [menuGroupLoading, setMenuGroupLoading] = useState(false)
  const [menuGroupError, setMenuGroupError] = useState('')
  const changesGroup = changeMenuScope === 'all' || changeMenuScope === 'group'
  const changesMenu = changeMenuScope === 'all' || changeMenuScope === 'menu'
  const changesPortion =
    changeMenuScope === 'all' || changeMenuScope === 'portion'

  const replacementRecipes = useMemo(
    () =>
      recipes
        .filter(
          (recipe) =>
            recipe.approvalStatus === 'approved' &&
            recipe.status === 'active' &&
            recipe.isActive,
        )
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [recipes],
  )
  const replacementRecipeOptions = useMemo(() => {
    const optionsById = new Map<string, Recipe>()
    const availableOptions = [
      ...replacementRecipes,
      ...replacementRecipeSearchResults,
    ]
    availableOptions.forEach((recipe) => {
      if (
        recipe.approvalStatus === 'approved' &&
        recipe.status === 'active' &&
        recipe.isActive
      ) {
        optionsById.set(recipe.id, recipe)
      }
    })
    return Array.from(optionsById.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    )
  }, [replacementRecipeSearchResults, replacementRecipes])
  const selectedReplacementRecipe = useMemo(
    () =>
      replacementRecipeOptions.find(
        (recipe) => recipe.id === replacementRecipeId,
      ),
    [replacementRecipeId, replacementRecipeOptions],
  )
  const replacementRecipeSuggestions = useMemo(() => {
    const normalizedQuery = normalizeRecipeSearch(replacementRecipeQuery)
    return replacementRecipeOptions
      .filter((recipe) => {
        if (!normalizedQuery) return true
        return normalizeRecipeSearch(
          [
            recipe.recipeCode,
            recipe.name,
            recipe.category,
            formatRecipeVersion(recipe.version),
          ]
            .filter(Boolean)
            .join(' '),
        ).includes(normalizedQuery)
      })
      .slice(0, 20)
  }, [replacementRecipeOptions, replacementRecipeQuery])
  const replacementCostPreview = useMemo(() => {
    const portion = Number(replacementPortion)
    if (
      !selectedReplacementRecipe ||
      !Number.isFinite(portion) ||
      portion <= 0
    ) {
      return {
        estimatedCost: undefined,
        estimatedCostPerPax: undefined,
      }
    }

    const basePax =
      Number(selectedReplacementRecipe.portionSize) > 0
        ? Number(selectedReplacementRecipe.portionSize)
        : 1
    let estimatedCost = 0
    let hasCost = false
    selectedReplacementRecipe.ingredients.forEach(
      (ingredient, ingredientIndex) => {
        const options = replacementVendorOptions[ingredientIndex] ?? []
        const selectedVendor = options.find(
          (option) =>
            option.key === replacementSelectedVendors[ingredientIndex],
        )
        const customPrice = Number(
          replacementCustomPrices[ingredientIndex],
        )
        const unitPrice =
          ingredient.ingredientType === 'NMP'
            ? Number.isFinite(customPrice)
              ? customPrice
              : undefined
            : getReplacementVendorUnitPrice(selectedVendor) ??
              getReplacementIngredientFallbackPrice(ingredient)
        if (unitPrice === undefined) return

        const baseQty = Number(ingredient.qty)
        const qty =
          (Number.isFinite(baseQty) ? baseQty : 0) * (portion / basePax)
        estimatedCost += qty * unitPrice
        hasCost = true
      },
    )

    if (!hasCost) {
      return {
        estimatedCost: undefined,
        estimatedCostPerPax: undefined,
      }
    }
    return {
      estimatedCost,
      estimatedCostPerPax: estimatedCost / portion,
    }
  }, [
    replacementCustomPrices,
    replacementPortion,
    replacementSelectedVendors,
    replacementVendorOptions,
    selectedReplacementRecipe,
  ])
  const replacementFormComplete = useMemo(() => {
    const portion = Number(replacementPortion)
    if (
      !changeMenuScope ||
      (changesGroup && (!replacementGroup.trim() || menuGroupLoading)) ||
      (changesPortion && (!Number.isInteger(portion) || portion < 1))
    ) {
      return false
    }

    if (!changesMenu) return true
    if (!selectedReplacementRecipe || replacementVendorLoading) return false

    return selectedReplacementRecipe.ingredients.every(
      (ingredient, ingredientIndex) => {
        if (replacementVendorErrors[ingredientIndex]) return false
        if (ingredient.ingredientType === 'NMP') {
          const rawPrice = replacementCustomPrices[ingredientIndex]?.trim()
          const price = Number(rawPrice)
          return Boolean(rawPrice) && Number.isFinite(price) && price >= 0
        }

        const options = replacementVendorOptions[ingredientIndex] ?? []
        const selectedVendor = options.find(
          (option) =>
            option.key === replacementSelectedVendors[ingredientIndex],
        )
        const price =
          getReplacementVendorUnitPrice(selectedVendor) ??
          getReplacementIngredientFallbackPrice(ingredient)
        return Boolean(selectedVendor?.vendor.trim()) && price !== undefined
      },
    )
  }, [
    changeMenuScope,
    changesGroup,
    changesMenu,
    changesPortion,
    menuGroupLoading,
    replacementCustomPrices,
    replacementGroup,
    replacementPortion,
    replacementSelectedVendors,
    replacementVendorErrors,
    replacementVendorLoading,
    replacementVendorOptions,
    selectedReplacementRecipe,
  ])

  const updateReplacementRecipeDropdownPosition = useCallback(() => {
    const input = replacementRecipeInputRef.current
    const dropdown = replacementRecipeDropdownRef.current
    if (!input || !dropdown) return

    const bounds = input.getBoundingClientRect()
    const gap = 4
    const availableBelow = window.innerHeight - bounds.bottom - 20
    const availableAbove = bounds.top - 20
    const naturalHeight = Math.min(280, dropdown.scrollHeight)
    const placeBelow = availableBelow >= Math.min(naturalHeight, 160)
    const maxHeight = Math.max(
      100,
      Math.min(280, placeBelow ? availableBelow : availableAbove),
    )
    const dropdownWidth = Math.min(
      Math.max(bounds.width, 420),
      window.innerWidth - 32,
    )
    const left = Math.min(
      Math.max(16, bounds.left),
      window.innerWidth - dropdownWidth - 16,
    )
    const renderedHeight = Math.min(naturalHeight, maxHeight)

    dropdown.style.left = `${left}px`
    dropdown.style.top = `${
      placeBelow
        ? bounds.bottom + gap
        : Math.max(8, bounds.top - renderedHeight - gap)
    }px`
    dropdown.style.width = `${dropdownWidth}px`
    dropdown.style.maxHeight = `${maxHeight}px`
    dropdown.style.borderRadius = placeBelow
      ? '0 0 0.75rem 0.75rem'
      : '0.75rem 0.75rem 0 0'
    dropdown.style.visibility = 'visible'
  }, [])

  useEffect(() => {
    if (!replacementRecipeDropdownOpen) return

    let animationFrame = 0
    const syncPosition = () => {
      updateReplacementRecipeDropdownPosition()
      animationFrame = window.requestAnimationFrame(syncPosition)
    }
    animationFrame = window.requestAnimationFrame(syncPosition)

    return () => window.cancelAnimationFrame(animationFrame)
  }, [
    replacementRecipeDropdownOpen,
    replacementRecipeQuery,
    replacementRecipeSuggestions,
    updateReplacementRecipeDropdownPosition,
  ])

  useEffect(() => {
    const query = replacementRecipeQuery.trim()
    if (!replacementRecipeDropdownOpen) return
    if (query.length < 2) {
      setReplacementRecipeSearchResults([])
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      searchRecipes(query, {
        limit: 20,
        ...(replacementSite ? { site: replacementSite } : {}),
      })
        .then((results) => {
          if (!cancelled) setReplacementRecipeSearchResults(results)
        })
        .catch(() => {
          if (!cancelled) setReplacementRecipeSearchResults([])
        })
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [
    replacementRecipeDropdownOpen,
    replacementRecipeQuery,
    replacementSite,
    searchRecipes,
  ])

  useEffect(() => {
    if (!accessToken) {
      setMenuGroupOptions([])
      return
    }

    let cancelled = false
    setMenuGroupLoading(true)
    setMenuGroupError('')
    apiFetch<{ items?: MenuGroupApi[] }>(
      '/menu-groups?limit=100&isActive=true',
      undefined,
      accessToken,
    )
      .then((data) => {
        if (cancelled) return
        setMenuGroupOptions(
          (data.items ?? [])
            .map((item) => ({
              id: item.id ?? item._id ?? '',
              name: item.name?.trim() ?? '',
            }))
            .filter((item) => item.id && item.name),
        )
      })
      .catch((error) => {
        if (cancelled) return
        setMenuGroupOptions([])
        setMenuGroupError(
          error instanceof Error
            ? error.message
            : 'Failed to load Group By options.',
        )
      })
      .finally(() => {
        if (!cancelled) setMenuGroupLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [accessToken])

  const parseDotDecimal = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return { valid: false as const, reason: 'empty' as const }
    if (trimmed.includes(',')) {
      return { valid: false as const, reason: 'comma' as const }
    }
    if (!/^(?:\d+|\d+\.\d+|\.\d+)$/.test(trimmed)) {
      return { valid: false as const, reason: 'format' as const }
    }

    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed) || parsed < 0) {
      return { valid: false as const, reason: 'range' as const }
    }

    return { valid: true as const, value: parsed }
  }

  const makeReconciliationRowId = () => {
    if (
      typeof crypto !== 'undefined' &&
      typeof crypto.randomUUID === 'function'
    ) {
      return `recon-${crypto.randomUUID()}`
    }
    return `recon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  const createAdditionalReconciliationRow = (): ReconciliationRow => ({
    id: makeReconciliationRowId(),
    productCode: '',
    name: '',
    unitOfMeasures: '',
    plannedQty: 0,
    actualQty: '',
    reason: '',
    isAdditional: true,
  })

  const buildReconciliationItemKey = (
    productCode: string,
    name: string,
    unitOfMeasures: string,
  ) => {
    const identity = (productCode || name).trim().toLowerCase()
    const unit = unitOfMeasures.trim().toLowerCase()
    if (!identity || !unit) return ''
    return `${identity}__${unit}`
  }

  const getSiteDisplayName = (site?: string) => {
    const siteCode = site?.trim() ?? ''
    const optionName = siteOptions
      .find((option) => option.code.trim() === siteCode)
      ?.name.trim()
    if (optionName) return optionName

    const userSiteName = user?.siteName?.trim()
    if (
      userSiteName &&
      (!siteCode || siteCode === user?.site?.trim() || !requireSiteSelection)
    ) {
      return userSiteName
    }

    return siteCode || userSiteName || ''
  }

  const handleReplacementRecipeChange = async (
    group: StoreRequestGroup,
    recipeId: string,
  ) => {
    setReplacementRecipeId(recipeId)
    setReplacementVendorOptions({})
    setReplacementSelectedVendors({})
    setReplacementCustomPrices({})
    setReplacementVendorErrors({})
    setChangeMenuError('')

    const requestId = replacementVendorRequestRef.current + 1
    replacementVendorRequestRef.current = requestId
    const recipe = replacementRecipeOptions.find(
      (item) => item.id === recipeId,
    )
    if (!accessToken || !recipe) {
      setReplacementVendorLoading(false)
      return
    }

    setReplacementVendorLoading(true)
    const site = getSiteDisplayName(group.site)
    const requestsByProductCode = new Map<
      string,
      Promise<RawMaterialVendorPriceApi[]>
    >()
    const fetchVendorOptions = (productCode: string) => {
      const normalizedProductCode = productCode.trim()
      const existingRequest = requestsByProductCode.get(normalizedProductCode)
      if (existingRequest) return existingRequest

      const params = new URLSearchParams()
      if (site) params.set('site', site)
      const query = params.toString()
      const request = apiFetch<RawMaterialVendorPriceApi[]>(
        `/raw-materials/${encodeURIComponent(normalizedProductCode)}/vendor-prices${
          query ? `?${query}` : ''
        }`,
        undefined,
        accessToken,
      )
      requestsByProductCode.set(normalizedProductCode, request)
      return request
    }

    try {
      const results = await Promise.all(
        recipe.ingredients.map(async (ingredient, ingredientIndex) => {
          const fallbackPrice = getReplacementIngredientFallbackPrice(ingredient)
          if (
            ingredient.ingredientType === 'NMP' ||
            !ingredient.productCode.trim()
          ) {
            return {
              ingredientIndex,
              options: [] as ReplacementVendorOption[],
              customPrice: fallbackPrice,
            }
          }

          try {
            const items = await fetchVendorOptions(ingredient.productCode)
            const optionsByKey = new Map<string, ReplacementVendorOption>()
            items.forEach((item) => {
              const productCode = item.productCode?.trim() ?? ''
              const vendorSite = item.site?.trim() ?? ''
              const vendor = item.vendor?.trim() ?? ''
              const unitOfMeasures = item.unitOfMeasures?.trim() ?? ''
              if (!productCode || !vendorSite || !vendor || !unitOfMeasures) {
                return
              }
              const minimumQuantity = Number.isFinite(
                Number(item.minimumQuantity),
              )
                ? Number(item.minimumQuantity)
                : undefined
              const price = Number.isFinite(Number(item.price))
                ? Number(item.price)
                : undefined
              const currency = item.currency?.trim() || undefined
              const key = [
                productCode.toLowerCase(),
                vendorSite.toLowerCase(),
                vendor.toLowerCase(),
                currency?.toLowerCase() ?? '',
                unitOfMeasures.toLowerCase(),
                minimumQuantity ?? '',
                price ?? '',
              ].join('|')
              optionsByKey.set(key, {
                key,
                productCode,
                site: vendorSite,
                vendor,
                currency,
                unitOfMeasures,
                minimumQuantity,
                price,
              })
            })
            const options = Array.from(optionsByKey.values()).sort((a, b) =>
              a.vendor.localeCompare(b.vendor, undefined, {
                sensitivity: 'base',
              }),
            )
            const defaultOption = options.reduce<
              ReplacementVendorOption | undefined
            >((selected, option) => {
              if (!selected) return option
              const selectedPrice = getReplacementVendorUnitPrice(selected)
              const optionPrice = getReplacementVendorUnitPrice(option)
              if (optionPrice !== undefined && selectedPrice === undefined) {
                return option
              }
              if (
                optionPrice !== undefined &&
                selectedPrice !== undefined &&
                optionPrice > selectedPrice
              ) {
                return option
              }
              return selected
            }, undefined)
            return {
              ingredientIndex,
              options,
              selectedKey: defaultOption?.key,
              customPrice: fallbackPrice,
            }
          } catch (error) {
            return {
              ingredientIndex,
              options: [] as ReplacementVendorOption[],
              customPrice: fallbackPrice,
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to load vendors.',
            }
          }
        }),
      )
      if (replacementVendorRequestRef.current !== requestId) return

      const optionsByIngredient: Record<number, ReplacementVendorOption[]> = {}
      const selectedByIngredient: Record<number, string> = {}
      const customPricesByIngredient: Record<number, string> = {}
      const errorsByIngredient: Record<number, string> = {}
      results.forEach((result) => {
        optionsByIngredient[result.ingredientIndex] = result.options
        if (result.selectedKey) {
          selectedByIngredient[result.ingredientIndex] = result.selectedKey
        }
        if (result.customPrice !== undefined) {
          customPricesByIngredient[result.ingredientIndex] = String(
            result.customPrice,
          )
        }
        if (result.error) {
          errorsByIngredient[result.ingredientIndex] = result.error
        }
      })
      setReplacementVendorOptions(optionsByIngredient)
      setReplacementSelectedVendors(selectedByIngredient)
      setReplacementCustomPrices(customPricesByIngredient)
      setReplacementVendorErrors(errorsByIngredient)
    } finally {
      if (replacementVendorRequestRef.current === requestId) {
        setReplacementVendorLoading(false)
      }
    }
  }

  const handleExportMenusByDate = (group: StoreRequestGroup) => {
    const exportGroup = {
      ...group,
      site: getSiteDisplayName(group.site),
    }
    const rows = buildStoreRequestExportRows([exportGroup])
    const summaryRows = buildIngredientSummaryExportRows([exportGroup])
    const estimatedCostRows = buildEstimatedCostExportRows([exportGroup])

    const safeDate = group.date.replace(/[\\/:*?"<>|]/g, '-')
    const safeProductionCode = (group.productionCode ?? 'no-code').replace(
      /[\\/:*?"<>|]/g,
      '-',
    )
    downloadSpreadsheet(`store-request-${safeDate}-${safeProductionCode}.xlsx`, [
      { name: 'Store Request', rows },
      { name: 'Ingredient Summary', rows: summaryRows },
      { name: 'Estimated Costs', rows: estimatedCostRows },
    ])
  }

  const openBulkExportModal = () => {
    setBulkExportError('')
    setActionMessage('')
    setBulkExportOpen(true)
  }

  const closeBulkExportModal = () => {
    if (bulkExporting) return
    setBulkExportOpen(false)
    setBulkExportError('')
  }

  const handleBulkExport = async () => {
    if (!accessToken) {
      setBulkExportError('Please log in first to export data.')
      return
    }
    if (requireSiteSelection && !selectedSite) {
      setBulkExportError('Please select a site first.')
      return
    }
    if (!bulkExportStartDate || !bulkExportEndDate) {
      setBulkExportError('Please complete start and end date.')
      return
    }
    if (bulkExportStartDate > bulkExportEndDate) {
      setBulkExportError('Start date cannot be later than end date.')
      return
    }

    setBulkExporting(true)
    setBulkExportError('')
    try {
      const params = new URLSearchParams({
        startDate: bulkExportStartDate,
        endDate: bulkExportEndDate,
      })
      if (requireSiteSelection && selectedSite) {
        params.set('site', selectedSite)
      }

      const data = await apiFetch<{ items: StoreRequestGroup[] }>(
        `/menu-productions/store-requests?${params.toString()}`,
        undefined,
        accessToken,
      )
      const exportGroups = mergeStoreRequestGroups(data.items ?? [])
      if (exportGroups.length === 0) {
        setBulkExportError('No store request data found for selected date range.')
        return
      }
      const namedExportGroups = exportGroups.map((group) => ({
        ...group,
        site: getSiteDisplayName(group.site),
      }))

      await downloadSpreadsheet(
        `store-request-bulk-${bulkExportStartDate}_to_${bulkExportEndDate}.xlsx`,
        [
          {
            name: 'Store Requests',
            rows: buildStoreRequestExportRows(namedExportGroups),
          },
          {
            name: 'Ingredient Summary',
            rows: buildIngredientSummaryExportRows(namedExportGroups),
          },
          {
            name: 'Estimated Costs',
            rows: buildEstimatedCostExportRows(namedExportGroups),
          },
        ],
      )

      setActionMessage(
        `Bulk export complete. ${exportGroups.length} production batches exported.`,
      )
      setBulkExportOpen(false)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to export data.'
      setBulkExportError(message)
    } finally {
      setBulkExporting(false)
    }
  }

  // FRONTEND VIEW: backend returns grouped store requests with multiplied ingredients.
  const fetchStoreRequests = useCallback(async () => {
    if (!accessToken) {
      setErrorMessage('Please log in first to load store requests.')
      return
    }
    if (requireSiteSelection && !selectedSite) {
      setGroups([])
      setLoading(false)
      setErrorMessage('')
      return
    }

    setLoading(true)
    setErrorMessage('')
    try {
      const params = new URLSearchParams()
      if (requireSiteSelection && selectedSite) {
        params.set('site', selectedSite)
      }
      const query = params.toString()
      const data = await apiFetch<{ items: StoreRequestGroup[] }>(
        query
          ? `/menu-productions/store-requests?${query}`
          : '/menu-productions/store-requests',
        undefined,
        accessToken,
      )

      const merged = mergeStoreRequestGroups(data.items ?? [])
      setGroups(merged)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to refresh data.'
      setErrorMessage(message)
    } finally {
      setLoading(false)
    }
  }, [accessToken, requireSiteSelection, selectedSite])

  const openChangeMenu = (
    group: StoreRequestGroup,
    menu: StoreRequestMenu,
    scope: ChangeMenuScope,
  ) => {
    if (menu.approvalStatus !== 'rejected') return
    setChangingMenuId(menu.id)
    setChangeMenuScope(scope)
    setReplacementGroup(menu.group ?? '')
    setReplacementRecipeId('')
    setReplacementRecipeQuery('')
    setReplacementRecipeSearchResults([])
    setReplacementRecipeDropdownOpen(false)
    setReplacementSite(group.site ?? '')
    setReplacementPortion(String(menu.portion))
    replacementVendorRequestRef.current += 1
    setReplacementVendorOptions({})
    setReplacementSelectedVendors({})
    setReplacementCustomPrices({})
    setReplacementVendorErrors({})
    setReplacementVendorLoading(false)
    setChangeMenuError('')
    setActionMessage('')
    if (scope === 'all' || scope === 'menu') {
      fetchRecipes({ site: group.site }).catch((error) => {
        setChangeMenuError(
          error instanceof Error
            ? error.message
            : 'Failed to load replacement menus.',
        )
      })
    }
  }

  const closeChangeMenu = () => {
    if (changeMenuSubmitting) return
    setChangingMenuId(null)
    setChangeMenuScope(null)
    setReplacementGroup('')
    setReplacementRecipeId('')
    setReplacementRecipeQuery('')
    setReplacementRecipeSearchResults([])
    setReplacementRecipeDropdownOpen(false)
    setReplacementSite('')
    setReplacementPortion('')
    replacementVendorRequestRef.current += 1
    setReplacementVendorOptions({})
    setReplacementSelectedVendors({})
    setReplacementCustomPrices({})
    setReplacementVendorErrors({})
    setReplacementVendorLoading(false)
    setChangeMenuError('')
  }

  const handleChangeRejectedMenu = async (menu: StoreRequestMenu) => {
    if (!accessToken || changingMenuId !== menu.id || !changeMenuScope) return
    if (changesGroup && !replacementGroup.trim()) {
      setChangeMenuError('Select Group By.')
      return
    }
    if (changesMenu && !replacementRecipeId) {
      setChangeMenuError('Select a replacement menu.')
      return
    }
    if (changesMenu && replacementRecipeId === menu.recipeId) {
      setChangeMenuError('Select a different menu.')
      return
    }
    const portion = Number(replacementPortion)
    if (changesPortion && (!Number.isInteger(portion) || portion < 1)) {
      setChangeMenuError('Portion must be a positive whole number.')
      return
    }
    if (changesMenu && !selectedReplacementRecipe) {
      setChangeMenuError('Replacement menu details are not available.')
      return
    }
    if (changesMenu && replacementVendorLoading) {
      setChangeMenuError('Wait until vendor data has finished loading.')
      return
    }

    const ingredientVendors: ReplacementIngredientVendorInput[] = []
    for (const [ingredientIndex, ingredient] of (
      selectedReplacementRecipe?.ingredients ?? []
    ).entries()) {
      const ingredientLabel =
        ingredient.name || ingredient.productCode || `${ingredientIndex + 1}`
      if (replacementVendorErrors[ingredientIndex]) {
        setChangeMenuError(
          `Failed to load vendor for ${ingredientLabel}: ${replacementVendorErrors[ingredientIndex]}`,
        )
        return
      }

      if (ingredient.ingredientType === 'NMP') {
        const rawPrice = replacementCustomPrices[ingredientIndex]?.trim()
        const price = Number(rawPrice)
        if (!rawPrice || !Number.isFinite(price) || price < 0) {
          setChangeMenuError(`Price is required for ${ingredientLabel}.`)
          return
        }
        ingredientVendors.push({
          ingredientIndex,
          productCode: ingredient.productCode,
          name: ingredient.name,
          unitOfMeasures: ingredient.unitOfMeasures,
          vendor: 'CUSTOM',
          price,
        })
        continue
      }

      const options = replacementVendorOptions[ingredientIndex] ?? []
      if (options.length === 0) {
        setChangeMenuError(
          `No vendor is available for ${ingredientLabel} at this site.`,
        )
        return
      }
      const selectedKey = replacementSelectedVendors[ingredientIndex]
      const selectedVendor = options.find(
        (option) => option.key === selectedKey,
      )
      if (!selectedVendor) {
        setChangeMenuError(`Select a vendor for ${ingredientLabel}.`)
        return
      }
      const price =
        getReplacementVendorUnitPrice(selectedVendor) ??
        getReplacementIngredientFallbackPrice(ingredient)
      if (price === undefined) {
        setChangeMenuError(`Price is required for ${ingredientLabel}.`)
        return
      }
      ingredientVendors.push({
        ingredientIndex,
        productCode: ingredient.productCode,
        name: ingredient.name,
        unitOfMeasures: ingredient.unitOfMeasures,
        vendor: selectedVendor.vendor,
        site: selectedVendor.site,
        currency: selectedVendor.currency,
        minimumQuantity: selectedVendor.minimumQuantity,
        price,
      })
    }

    setChangeMenuSubmitting(true)
    setChangeMenuError('')
    setActionMessage('')
    try {
      const payload: Record<string, unknown> = { scope: changeMenuScope }
      if (changesGroup) payload.group = replacementGroup
      if (changesPortion) payload.portion = portion
      if (changesMenu) {
        payload.recipeId = replacementRecipeId
        payload.ingredientVendors = ingredientVendors
      }
      await apiFetch(
        `/menu-productions/${menu.id}/change-rejected-menu`,
        {
          method: 'PATCH',
          body: JSON.stringify(payload),
        },
        accessToken,
      )
      await fetchStoreRequests()
      setActionMessage(
        `${menu.menuName} was changed and submitted to Admin Site for new sales input.`,
      )
      setChangingMenuId(null)
      setChangeMenuScope(null)
      setReplacementGroup('')
      setReplacementRecipeId('')
      setReplacementRecipeQuery('')
      setReplacementRecipeSearchResults([])
      setReplacementRecipeDropdownOpen(false)
      setReplacementSite('')
      setReplacementPortion('')
      replacementVendorRequestRef.current += 1
      setReplacementVendorOptions({})
      setReplacementSelectedVendors({})
      setReplacementCustomPrices({})
      setReplacementVendorErrors({})
      setReplacementVendorLoading(false)
    } catch (error) {
      setChangeMenuError(
        error instanceof Error ? error.message : 'Failed to change menu.',
      )
    } finally {
      setChangeMenuSubmitting(false)
    }
  }

  const openPendingCancellationModal = (
    group: StoreRequestGroup,
    menu: StoreRequestMenu,
  ) => {
    if (menu.approvalStatus !== 'pending') return
    setPendingCancellationGroup(group)
    setPendingCancellationMenu(menu)
    setErrorMessage('')
    setActionMessage('')
  }

  const closePendingCancellationModal = () => {
    if (cancellingGroupKey) return
    setPendingCancellationGroup(null)
    setPendingCancellationMenu(null)
  }

  const handleConfirmPendingCancellation = async () => {
    if (!pendingCancellationGroup || !pendingCancellationMenu) return

    const productionCodeLabel =
      pendingCancellationGroup.productionCode ?? 'this batch'
    const groupKey = getStoreRequestGroupKey(pendingCancellationGroup)
    setCancellingGroupKey(groupKey)
    setErrorMessage('')
    setActionMessage('')

    try {
      await cancelPendingMenuProductionBatch({
        menuProductionIds: [pendingCancellationMenu.id],
      })
      setActionMessage(
        `${pendingCancellationMenu.menuName} was cancelled from ${productionCodeLabel} for ${pendingCancellationGroup.date}.`,
      )
      await fetchStoreRequests()
      setPendingCancellationGroup(null)
      setPendingCancellationMenu(null)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to cancel pending menu production.'
      setErrorMessage(message)
    } finally {
      setCancellingGroupKey(null)
    }
  }

  const buildCompletionRows = (group: StoreRequestGroup): ReconciliationRow[] => {
    const fulfilledByKey = new Map<string, StoreRequestFulfillment['items'][number]>()
    const fulfilledItems = group.fulfillment?.items ?? []
    fulfilledItems.forEach((item) => {
      const key = buildReconciliationItemKey(
        item.productCode,
        item.name,
        item.unitOfMeasures,
      )
      if (key) fulfilledByKey.set(key, item)
    })

    const plannedKeys = new Set<string>()
    const plannedRows = aggregateStoreRequestSummary(group.summary ?? []).map(
      (item) => {
        const key = buildReconciliationItemKey(
          item.productCode,
          item.name,
          item.unitOfMeasures,
        )
        if (key) plannedKeys.add(key)
        const fulfilledItem = key ? fulfilledByKey.get(key) : undefined
        return {
          id: makeReconciliationRowId(),
          productCode: item.productCode,
          name: item.name,
          unitOfMeasures: item.unitOfMeasures,
          plannedQty: item.qty,
          actualQty: formatQuantity(fulfilledItem?.actualQty ?? item.qty),
          reason: fulfilledItem?.reason ?? '',
          isAdditional: false,
        }
      },
    )

    const additionalRows = fulfilledItems
      .filter((item) => {
        const key = buildReconciliationItemKey(
          item.productCode,
          item.name,
          item.unitOfMeasures,
        )
        return key && !plannedKeys.has(key)
      })
      .map((item) => ({
        id: makeReconciliationRowId(),
        productCode: item.productCode,
        name: item.name,
        unitOfMeasures: item.unitOfMeasures,
        plannedQty: 0,
        actualQty: formatQuantity(item.actualQty),
        reason: item.reason ?? '',
        isAdditional: true,
      }))

    return [...plannedRows, ...additionalRows]
  }

  const openCompletionModal = (group: StoreRequestGroup) => {
    setCompletionGroup(group)
    setCompletionRows(buildCompletionRows(group))
    setCompletionNote(group.fulfillment?.note ?? '')
    setCompletionError('')
    setErrorMessage('')
    setActionMessage('')
  }

  const closeCompletionModal = () => {
    if (cancellingGroupKey) return
    setCompletionGroup(null)
    setCompletionRows([])
    setCompletionNote('')
    setCompletionError('')
  }

  const updateCompletionRow = <K extends keyof ReconciliationRow>(
    rowId: string,
    field: K,
    value: ReconciliationRow[K],
  ) => {
    setCompletionRows((prev) =>
      prev.map((row) => (row.id === rowId ? { ...row, [field]: value } : row)),
    )
  }

  const handleAddCompletionRow = () => {
    setCompletionRows((prev) => [...prev, createAdditionalReconciliationRow()])
    setCompletionError('')
  }

  const handleRemoveCompletionRow = (rowId: string) => {
    setCompletionRows((prev) => prev.filter((row) => row.id !== rowId))
    setCompletionError('')
  }

  const getVarianceQty = (plannedQty: number, actualQtyText: string) => {
    const parsed = parseDotDecimal(actualQtyText)
    if (!parsed.valid) return null
    return parsed.value - plannedQty
  }

  const handleSubmitCompletion = async () => {
    if (!completionGroup) return

    const groupKey = getStoreRequestGroupKey(completionGroup)
    const menuProductionIds = completionGroup.items
      .map((item) => item.id)
      .filter(Boolean)

    if (menuProductionIds.length === 0) {
      setCompletionError('Menu production data is missing for this batch.')
      return
    }

    if (completionRows.length === 0) {
      setCompletionError('No planned raw materials available to reconcile.')
      return
    }

    const payloadItems = []
    const seenKeys = new Set<string>()
    for (const row of completionRows) {
      const productCode = row.productCode.trim()
      const name = row.name.trim()
      const unitOfMeasures = row.unitOfMeasures.trim()
      const fieldLabel = productCode || name

      if (row.isAdditional && (!productCode || !name || !unitOfMeasures)) {
        setCompletionError(
          'Additional ingredient rows must include product code, ingredient name, and unit.',
        )
        return
      }

      const itemKey = buildReconciliationItemKey(productCode, name, unitOfMeasures)
      if (!itemKey) {
        setCompletionError(
          `Ingredient identity is incomplete for ${fieldLabel || 'an actual qty row'}.`,
        )
        return
      }
      if (seenKeys.has(itemKey)) {
        setCompletionError(
          `Duplicate ingredient found in actual qty for ${fieldLabel}.`,
        )
        return
      }
      seenKeys.add(itemKey)

      const actualQtyText = row.actualQty.trim()
      if (!actualQtyText) {
        setCompletionError(
          `Actual qty is required for ${fieldLabel || 'an ingredient'}.`,
        )
        return
      }

      const parsedActualQty = parseDotDecimal(actualQtyText)
      if (!parsedActualQty.valid) {
        if (parsedActualQty.reason === 'comma') {
          setCompletionError(
            `Use dot decimal format for ${fieldLabel}, for example 0.5.`,
          )
          return
        }
        setCompletionError(
          `Actual qty for ${fieldLabel} must be a valid number using dot decimals, for example 0.5.`,
        )
        return
      }

      const actualQty = parsedActualQty.value
      if (row.isAdditional && actualQty <= 0) {
        setCompletionError(
          `Actual qty for added ingredient ${fieldLabel} must be greater than 0.`,
        )
        return
      }
      const reason = row.reason.trim()
      if (quantitiesDiffer(actualQty, row.plannedQty) && !reason) {
        setCompletionError(
          `Reason is required when actual qty differs for ${fieldLabel}.`,
        )
        return
      }

      payloadItems.push({
        productCode,
        name,
        unitOfMeasures,
        actualQty,
        reason: reason || undefined,
      })
    }

    setCompletionError('')
    setErrorMessage('')
    setCancellingGroupKey(groupKey)
    try {
      await fulfillStoreRequestBatch({
        menuProductionIds,
        items: payloadItems,
        note: completionNote.trim() || undefined,
      })
      const label = completionGroup.productionCode
        ? `${completionGroup.date} (${completionGroup.productionCode})`
        : completionGroup.date
      setActionMessage(`Actual qty for ${label} saved.`)
      await fetchStoreRequests()
      setExpandedGroups((prev) => prev.filter((item) => item !== groupKey))
      setCompletionGroup(null)
      setCompletionRows([])
      setCompletionNote('')
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to save actual qty.'
      setCompletionError(message)
    } finally {
      setCancellingGroupKey(null)
    }
  }

  const openCancellationModal = (
    group: StoreRequestGroup,
    menu: StoreRequestMenu,
  ) => {
    setCancellationGroup(group)
    setCancellationMenu(menu)
    setCancellationReason('')
    setCancellationError('')
    setErrorMessage('')
    setActionMessage('')
  }

  const closeCancellationModal = () => {
    if (cancellingGroupKey) return
    setCancellationGroup(null)
    setCancellationMenu(null)
    setCancellationReason('')
    setCancellationError('')
  }

  const handleSubmitCancellation = async () => {
    if (!cancellationGroup || !cancellationMenu) return

    const reason = cancellationReason.trim()
    if (!reason) {
      setCancellationError('Cancellation reason is required.')
      return
    }

    const menuProductionIds = cancellationMenu.id ? [cancellationMenu.id] : []

    if (menuProductionIds.length === 0) {
      setCancellationError('Menu production data is missing for this menu.')
      return
    }

    const groupKey = getStoreRequestGroupKey(cancellationGroup)
    setCancellingGroupKey(groupKey)
    setCancellationError('')
    setErrorMessage('')

    try {
      await cancelStoreRequestBatch({
        menuProductionIds,
        reason,
      })
      setActionMessage(`Store request for ${cancellationMenu.menuName} cancelled.`)
      await fetchStoreRequests()
      setExpandedGroups((prev) => prev.filter((item) => item !== groupKey))
      setCancellationGroup(null)
      setCancellationMenu(null)
      setCancellationReason('')
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to cancel store request.'
      setCancellationError(message)
    } finally {
      setCancellingGroupKey(null)
    }
  }

  const toggleExpanded = (groupKey: string) => {
    setExpandedGroups((prev) =>
      prev.includes(groupKey)
        ? prev.filter((item) => item !== groupKey)
        : [...prev, groupKey],
    )
  }

  useEffect(() => {
    fetchStoreRequests().catch(() => null)

    if (accessToken && user?.site) {
      apiFetch(
        '/notifications/mark-role-read',
        {
          method: 'PATCH',
          body: JSON.stringify({
            siteCode: user.site,
            targetUserRole: 'chef',
            componentKey: 'STORE_REQUEST_RECORDS',
          }),
        },
        accessToken,
      )
        .then(() => window.dispatchEvent(new CustomEvent('refresh-notifications')))
        .catch((err) =>
          console.error('Failed to clear chef badges automatically:', err),
        )
    }

  }, [fetchStoreRequests, accessToken, user?.site])

  useEffect(() => {
    setExpandedGroups([])
    setPage(1)
    setActionMessage('')
    setErrorMessage('')
    setPendingCancellationGroup(null)
    setPendingCancellationMenu(null)
    setCancellationGroup(null)
    setCancellationMenu(null)
    setCancellationReason('')
    setCancellationError('')
    setCompletionGroup(null)
    setCompletionRows([])
    setCompletionNote('')
    setCompletionError('')
    setBulkExportOpen(false)
    setBulkExportError('')
  }, [selectedSite])

  useEffect(() => {
    const nextTotalPages = Math.max(
      1,
      Math.ceil(groups.length / ITEMS_PER_PAGE),
    )
    setPage((prev) => Math.min(prev, nextTotalPages))
  }, [groups.length])

  const totalPages = Math.max(1, Math.ceil(groups.length / ITEMS_PER_PAGE))
  const paginatedGroups = groups.slice(
    (page - 1) * ITEMS_PER_PAGE,
    page * ITEMS_PER_PAGE,
  )

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Store Request</h1>
          {enableBulkExport ? (
            <button
              type="button"
              onClick={openBulkExportModal}
              disabled={loading || (requireSiteSelection && !selectedSite)}
              className="rounded-md border border-success bg-white px-4 py-2 text-xs font-semibold text-success shadow-sm hover:bg-success/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="flex items-center gap-2">
                <i className="bi bi-download text-sm" aria-hidden="true" />
                <span>Bulk Export</span>
              </span>
            </button>
          ) : null}
        </div>
        {requireSiteSelection ? (
          <div className="max-w-xs">
            <label className="text-xs font-medium text-muted">
              Store request site
            </label>
            <select
              value={selectedSite}
              onChange={(event) => setSelectedSite(event.target.value)}
              className="mt-2 w-full rounded-xl border border-border bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
            >
              <option value="">Select site</option>
              {siteOptions
                .filter((site) => site.code.trim())
                .map((site) => (
                  <option key={site.code} value={site.code}>
                    {site.name ? `${site.name} (${site.code})` : site.code}
                  </option>
                ))}
            </select>
            {!selectedSite ? (
              <p className="mt-2 text-xs text-muted">
                Select a site to load store request batches.
              </p>
            ) : null}
          </div>
        ) : null}
        {errorMessage ? (
          <p className="text-xs font-medium text-red-600">{errorMessage}</p>
        ) : null}
        {actionMessage ? (
          <p className="text-xs font-medium text-primary">{actionMessage}</p>
        ) : null}
      </div>

      <div className="rounded-md border border-border bg-surface shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-t-md border-b border-border bg-white px-5 py-4 text-xs">
          <span className="text-muted">
            Showing {paginatedGroups.length} of {groups.length} production batches
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
                <th className="w-16 px-5 py-4 font-semibold">No</th>
                <th className="px-5 py-4 font-semibold">Created date</th>
                <th className="px-5 py-4 font-semibold">Production date</th>
                <th className="px-5 py-4 font-semibold">Production code</th>
                <th className="px-5 py-4 font-semibold">Client name</th>
                <th className="px-5 py-4 font-semibold">Reviewed by</th>
                <th className="px-5 py-4 font-semibold">Total menu</th>
                <th className="px-5 py-4 font-semibold">Storekeeper</th>
                <th className="px-5 py-4 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr className="border-t border-border">
                  <td colSpan={9} className="px-5 py-10 text-center text-muted">
                    Loading store requests...
                  </td>
                </tr>
              ) : groups.length === 0 ? (
                <tr className="border-t border-border">
                  <td colSpan={9} className="px-5 py-10 text-center text-muted">
                    No production batches submitted yet.
                  </td>
                </tr>
              ) : (
                paginatedGroups.map((group, index) => {
                const date = group.date
                const groupKey = getStoreRequestGroupKey(group)
                const items = group.items
                const summaryItems = aggregateStoreRequestSummary(group.summary ?? [])
                const isExpanded = expandedGroups.includes(groupKey)
                const cancelledCount = items.filter(
                  (item) => item.storeRequestStatus === 'cancelled',
                ).length
                const approvedCount = items.filter(
                  (item) =>
                    item.approvalStatus === 'approved' &&
                    item.storeRequestStatus !== 'cancelled',
                ).length
                const rejectedCount = items.filter(
                  (item) =>
                    item.approvalStatus === 'rejected' &&
                    item.storeRequestStatus !== 'cancelled',
                ).length
                const pendingCount = items.filter(
                  (item) =>
                    item.approvalStatus === 'pending' &&
                    item.storeRequestStatus !== 'cancelled',
                ).length
                const hasDelivered = items.some(
                  (item) => item.storeRequestStatus === 'fulfilled',
                )
                const reviewedByNames = Array.from(
                  new Set(
                    items
                      .map((item) => item.reviewedBy?.trim())
                      .filter((name): name is string => Boolean(name)),
                  ),
                )
                const reviewedByLabel = reviewedByNames.length
                  ? reviewedByNames.join(', ')
                  : '-'
                const handledByNames = group.fulfillment?.completedBy?.trim()
                  ? [group.fulfillment.completedBy.trim()]
                  : Array.from(
                  new Set(
                    items
                      .map((item) =>
                        item.fulfilledBy?.trim() || item.cancelledBy?.trim(),
                      )
                      .filter((name): name is string => Boolean(name)),
                  ),
                )
                const handledByLabel = handledByNames.length
                  ? handledByNames.join(', ')
                  : '-'

                return (
                  <Fragment key={groupKey}>
                    <tr
                      className="border-t border-border cursor-pointer"
                      onClick={() => toggleExpanded(groupKey)}
                    >
                      <td className="px-5 py-4 text-sm text-muted">
                        {(page - 1) * ITEMS_PER_PAGE + index + 1}
                      </td>
                      <td className="px-5 py-4 text-sm text-muted">
                        {formatCreatedDate(getGroupSubmittedAt(group))}
                      </td>
                      <td className="px-5 py-4">{date}</td>
                      <td className="px-5 py-4 text-xs text-muted">
                        {group.productionCode ?? '-'}
                      </td>
                      <td className="px-5 py-4">{items[0]?.clientName ?? '-'}</td>
                      <td className="px-5 py-4 text-sm text-muted">
                        {reviewedByLabel}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-semibold text-foreground">
                            {items.length} total
                          </span>
                          {approvedCount > 0 ? (
                            <span className="rounded-full bg-primary-soft px-2 py-1 font-semibold text-primary">
                              {approvedCount} approved
                            </span>
                          ) : null}
                          {rejectedCount > 0 ? (
                            <span className="rounded-full bg-red-100 px-2 py-1 font-semibold text-red-700">
                              {rejectedCount} rejected
                            </span>
                          ) : null}
                          {cancelledCount > 0 ? (
                            <span className="rounded-full bg-amber-100 px-2 py-1 font-semibold text-amber-700">
                              {cancelledCount} cancelled
                            </span>
                          ) : null}
                          {pendingCount > 0 ? (
                            <span className="rounded-full bg-background px-2 py-1 font-semibold text-muted">
                              {pendingCount} pending
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-sm text-muted">
                        {handledByLabel}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              toggleExpanded(groupKey)
                            }}
                            className="rounded-md border border-primary bg-background px-3 py-1 text-xs font-semibold text-primary hover:bg-primary-soft/80"
                          >
                            {isExpanded ? 'Hide details' : 'View details'}
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              handleExportMenusByDate(group)
                            }}
                            className="rounded-md border border-success bg-white px-3 py-1 text-xs font-semibold text-success hover:bg-success/10"
                          >
                            <span className="flex items-center gap-2">
                              <i
                                className="bi bi-download text-sm"
                                aria-hidden="true"
                              />
                              <span>Export</span>
                            </span>
                          </button>
                          {actionMode === 'select' ? (
                            <select
                              value=""
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => {
                                const action = event.target.value as
                                  | 'cancel'
                                  | 'complete'
                                  | ''
                                event.target.value = ''
                                if (!action) return
                                openCompletionModal(group)
                              }}
                              disabled={cancellingGroupKey === groupKey}
                              className="h-8 w-36 rounded-md border border-border bg-white px-3 py-1 text-xs font-semibold text-primary shadow-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <option value="">Select action</option>
                              {enableStoreRequestCompletion && items.length > 0 ? (
                                <option value="complete">
                                  {hasDelivered
                                    ? 'Correct actual'
                                    : 'Complete actual'}
                                </option>
                              ) : null}
                            </select>
                          ) : (
                            <>
                              {enableStoreRequestCompletion && items.length > 0 ? (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    openCompletionModal(group)
                                  }}
                                  disabled={cancellingGroupKey === groupKey}
                                  className={
                                    hasDelivered
                                      ? 'rounded-md border border-amber-500 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60'
                                      : 'rounded-md border border-success bg-success/10 px-3 py-1 text-xs font-semibold text-success hover:bg-success/20 disabled:cursor-not-allowed disabled:opacity-60'
                                  }
                                >
                                  {cancellingGroupKey === groupKey
                                    ? 'Saving...'
                                    : hasDelivered
                                      ? 'Correct actual'
                                      : 'Complete actual'}
                                </button>
                              ) : null}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isExpanded ? (
                      <tr className="border-t border-border bg-background">
                        <td colSpan={9} className="px-5 py-5">
                          <div className="space-y-3">
                            <p className="text-xs font-bold text-muted">
                              Menu details
                            </p>

                            <div className="max-w-full overflow-x-auto rounded-md border border-border bg-white">
                              <div className="border-b border-border px-4 py-3 text-xs text-muted">
                                Showing {items.length} of {items.length} menu rows
                              </div>
                              <table
                                className="dm-table min-w-full text-sm"
                                aria-label="Menu production summary"
                              >
                                <thead className="bg-background">
                                  <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                                    <th className="w-12 px-4 py-3 font-semibold">
                                      No
                                    </th>
                                    <th className="px-4 py-3 font-semibold">
                                      Group By
                                    </th>
                                    <th className="px-4 py-3 font-semibold">
                                      Recipe ID
                                    </th>
                                    <th className="px-4 py-3 font-semibold">
                                      Menu
                                    </th>
                                    <th className="px-4 py-3 font-semibold">
                                      Category
                                    </th>
                                    <th className="px-4 py-3 font-semibold">
                                      Portion
                                    </th>
                                    <th className="px-4 py-3 font-semibold">
                                      Estimated Total Cost
                                    </th>
                                    <th className="px-4 py-3 font-semibold">
                                      Cost/Pax
                                    </th>
                                    <th className="px-4 py-3 font-semibold">
                                      Action
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {items.map((menu, menuIndex) => {
                                    const {
                                      estimatedCost,
                                      estimatedCostPerPax,
                                    } = getMenuCostSummary(menu)
                                    const isChangingMenu =
                                      changingMenuId === menu.id
                                    const displayedEstimatedCost =
                                      isChangingMenu && changesMenu
                                        ? replacementCostPreview.estimatedCost
                                        : isChangingMenu && changesPortion
                                          ? estimatedCost === undefined
                                            ? undefined
                                            : (estimatedCost *
                                                Number(replacementPortion)) /
                                              menu.portion
                                        : estimatedCost
                                    const displayedEstimatedCostPerPax =
                                      isChangingMenu && changesMenu
                                        ? replacementCostPreview.estimatedCostPerPax
                                        : estimatedCostPerPax
                                    const availableReplacementSuggestions =
                                      replacementRecipeSuggestions.filter(
                                        (recipe) =>
                                          recipe.id !== menu.recipeId,
                                      )

                                    return (
                                      <tr
                                        key={`summary-${menu.id}`}
                                        className="border-t border-border"
                                      >
                                        <td className="px-4 py-3 text-sm text-muted">
                                          {menuIndex + 1}
                                        </td>
                                        <td className="px-4 py-3">
                                          {changingMenuId === menu.id &&
                                          changesGroup ? (
                                            <select
                                              value={replacementGroup}
                                              onChange={(event) => {
                                                setReplacementGroup(
                                                  event.target.value,
                                                )
                                                setChangeMenuError('')
                                              }}
                                              disabled={
                                                changeMenuSubmitting ||
                                                menuGroupLoading
                                              }
                                              title={
                                                menuGroupError || undefined
                                              }
                                              aria-label="Replacement menu group"
                                              required
                                              className="w-40 rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20 disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                              <option value="">
                                                {menuGroupLoading
                                                  ? 'Loading groups...'
                                                  : menuGroupOptions.length ===
                                                      0
                                                    ? 'No groups configured'
                                                    : 'Select group'}
                                              </option>
                                              {replacementGroup &&
                                              !menuGroupOptions.some(
                                                (option) =>
                                                  option.name ===
                                                  replacementGroup,
                                              ) ? (
                                                <option
                                                  value={replacementGroup}
                                                >
                                                  {replacementGroup} (inactive)
                                                </option>
                                              ) : null}
                                              {menuGroupOptions.map((option) => (
                                                <option
                                                  key={option.id}
                                                  value={option.name}
                                                >
                                                  {option.name}
                                                </option>
                                              ))}
                                            </select>
                                          ) : (
                                            menu.group ?? '-'
                                          )}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-muted">
                                          {changingMenuId === menu.id &&
                                          changesMenu
                                            ? selectedReplacementRecipe
                                                ?.recipeCode || '-'
                                            : menu.recipeCode ?? '-'}
                                        </td>
                                        <td className="min-w-72 px-4 py-3 font-medium">
                                          {changingMenuId === menu.id &&
                                          changesMenu ? (
                                            <div>
                                              <input
                                                ref={replacementRecipeInputRef}
                                                type="text"
                                                value={replacementRecipeQuery}
                                                onChange={(event) => {
                                                  setReplacementRecipeQuery(
                                                    event.target.value,
                                                  )
                                                  setChangeMenuError('')
                                                  if (replacementRecipeId) {
                                                    void handleReplacementRecipeChange(
                                                      group,
                                                      '',
                                                    )
                                                  }
                                                }}
                                                onFocus={(event) => {
                                                  replacementRecipeInputRef.current =
                                                    event.currentTarget
                                                  setReplacementRecipeDropdownOpen(
                                                    true,
                                                  )
                                                }}
                                                onBlur={() => {
                                                  window.setTimeout(() => {
                                                    setReplacementRecipeDropdownOpen(
                                                      false,
                                                    )
                                                    replacementRecipeInputRef.current =
                                                      null
                                                    replacementRecipeDropdownRef.current =
                                                      null
                                                  }, 150)
                                                }}
                                                disabled={
                                                  changeMenuSubmitting ||
                                                  replacementVendorLoading
                                                }
                                                placeholder="Search replacement menu"
                                                role="combobox"
                                                aria-autocomplete="list"
                                                aria-expanded={
                                                  replacementRecipeDropdownOpen
                                                }
                                                aria-controls="replacement-menu-options"
                                                aria-label="Replacement menu"
                                                required
                                                className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm font-normal outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20 disabled:cursor-not-allowed disabled:opacity-60"
                                              />
                                              {replacementRecipeDropdownOpen
                                                ? createPortal(
                                                    <div
                                                      id="replacement-menu-options"
                                                      ref={
                                                        replacementRecipeDropdownRef
                                                      }
                                                      role="listbox"
                                                      className="fixed z-[100] overflow-y-auto border border-border bg-white shadow-xl"
                                                      style={{
                                                        visibility: 'hidden',
                                                      }}
                                                    >
                                                      {availableReplacementSuggestions.length >
                                                      0 ? (
                                                        availableReplacementSuggestions
                                                          .map((recipe) => (
                                                            <button
                                                              key={recipe.id}
                                                              type="button"
                                                              role="option"
                                                              aria-selected={
                                                                recipe.id ===
                                                                replacementRecipeId
                                                              }
                                                              onMouseDown={(
                                                                event,
                                                              ) =>
                                                                event.preventDefault()
                                                              }
                                                              onClick={() => {
                                                                setReplacementRecipeQuery(
                                                                  formatReplacementRecipeLabel(
                                                                    recipe,
                                                                  ),
                                                                )
                                                                setReplacementRecipeDropdownOpen(
                                                                  false,
                                                                )
                                                                replacementRecipeInputRef.current =
                                                                  null
                                                                replacementRecipeDropdownRef.current =
                                                                  null
                                                                handleReplacementRecipeChange(
                                                                  group,
                                                                  recipe.id,
                                                                ).catch(
                                                                  (error) => {
                                                                    setChangeMenuError(
                                                                      error instanceof
                                                                        Error
                                                                        ? error.message
                                                                        : 'Failed to load vendors.',
                                                                    )
                                                                  },
                                                                )
                                                              }}
                                                              className="block w-full border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-primary-soft"
                                                            >
                                                              <span className="block truncate text-sm font-semibold text-foreground">
                                                                {formatReplacementRecipeLabel(
                                                                  recipe,
                                                                )}
                                                              </span>
                                                              <span className="mt-1 block text-xs text-muted">
                                                                {recipe.category ||
                                                                  '-'}
                                                              </span>
                                                            </button>
                                                          ))
                                                      ) : (
                                                        <p className="px-3 py-3 text-sm text-muted">
                                                          No replacement menu
                                                          found.
                                                        </p>
                                                      )}
                                                    </div>,
                                                    document.body,
                                                  )
                                                : null}
                                            </div>
                                          ) : (
                                            <>
                                              {menu.menuName} (
                                              {formatRecipeVersion(
                                                menu.recipeVersion,
                                              )}
                                              )
                                            </>
                                          )}
                                        </td>
                                        <td className="px-4 py-3">
                                          {changingMenuId === menu.id &&
                                          changesMenu
                                            ? selectedReplacementRecipe
                                                ?.category || '-'
                                            : menu.category || '-'}
                                        </td>
                                        <td className="px-4 py-3">
                                          {changingMenuId === menu.id &&
                                          changesPortion ? (
                                            <input
                                              type="number"
                                              min="1"
                                              step="1"
                                              value={replacementPortion}
                                              onChange={(event) => {
                                                setReplacementPortion(
                                                  event.target.value,
                                                )
                                                setChangeMenuError('')
                                              }}
                                              disabled={changeMenuSubmitting}
                                              aria-label="Replacement portion"
                                              required
                                              className="w-24 rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20 disabled:cursor-not-allowed disabled:opacity-60"
                                            />
                                          ) : (
                                            menu.portion
                                          )}
                                        </td>
                                        <td className="px-4 py-3 font-medium">
                                          {formatPrice(
                                            displayedEstimatedCost,
                                          )}
                                        </td>
                                        <td className="px-4 py-3 font-medium">
                                          {formatPrice(
                                            displayedEstimatedCostPerPax,
                                          )}
                                        </td>
                                        <td className="px-4 py-3">
                                          {changingMenuId === menu.id ? (
                                            <div>
                                              <div className="flex flex-wrap gap-2">
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    handleChangeRejectedMenu(
                                                      menu,
                                                    )
                                                  }
                                                  disabled={
                                                    changeMenuSubmitting ||
                                                    replacementVendorLoading ||
                                                    !replacementFormComplete
                                                  }
                                                  className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                                                >
                                                  {replacementVendorLoading
                                                    ? 'Loading...'
                                                    : changeMenuSubmitting
                                                      ? 'Saving...'
                                                      : 'Save'}
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={closeChangeMenu}
                                                  disabled={
                                                    changeMenuSubmitting
                                                  }
                                                  className="rounded-md bg-danger px-3 py-2 text-xs font-semibold text-white hover:bg-danger/90 disabled:cursor-not-allowed disabled:opacity-60"
                                                >
                                                  Cancel
                                                </button>
                                              </div>
                                              {changeMenuError ? (
                                                <p className="mt-2 min-w-40 text-xs font-medium text-danger">
                                                  {changeMenuError}
                                                </p>
                                              ) : null}
                                            </div>
                                          ) : menu.approvalStatus ===
                                              'rejected' &&
                                            user?.role === 'chef' ? (
                                            <select
                                              value=""
                                              onChange={(event) => {
                                                const scope = event.target
                                                  .value as ChangeMenuScope
                                                if (!scope) return
                                                setActionMessage('')
                                                openChangeMenu(
                                                  group,
                                                  menu,
                                                  scope,
                                                )
                                              }}
                                              aria-label={`Change ${menu.menuName}`}
                                              className="min-w-28 rounded-md border border-primary bg-primary-soft px-3 py-2 text-xs font-semibold text-primary outline-none hover:bg-primary-soft/80"
                                            >
                                              <option
                                                value=""
                                                disabled
                                                className="bg-white text-foreground"
                                              >
                                                Change
                                              </option>
                                              <option
                                                value="all"
                                                className="bg-white text-foreground"
                                              >
                                                All
                                              </option>
                                              <option
                                                value="group"
                                                className="bg-white text-foreground"
                                              >
                                                Group By
                                              </option>
                                              <option
                                                value="menu"
                                                className="bg-white text-foreground"
                                              >
                                                Menu
                                              </option>
                                              <option
                                                value="portion"
                                                className="bg-white text-foreground"
                                              >
                                                Portion
                                              </option>
                                            </select>
                                          ) : (
                                            '-'
                                          )}
                                        </td>
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            </div>

                            {changingMenuId &&
                            changesMenu &&
                            selectedReplacementRecipe ? (
                              <div className="rounded-md border border-primary/30 bg-surface p-4">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div>
                                    <h3 className="font-semibold text-foreground">
                                      Vendor setup
                                    </h3>
                                    <p className="mt-1 text-xs text-muted">
                                      Select the vendor for every ingredient in{' '}
                                      {selectedReplacementRecipe.name} before
                                      saving.
                                    </p>
                                  </div>
                                  {replacementVendorLoading ? (
                                    <span className="text-xs font-medium text-muted">
                                      Loading vendors...
                                    </span>
                                  ) : null}
                                </div>

                                <div className="mt-3 max-w-full overflow-x-auto rounded-md border border-border bg-white">
                                  <table
                                    className="dm-table min-w-full text-sm"
                                    aria-label="Replacement ingredient vendor setup"
                                  >
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
                                        <th className="min-w-52 px-4 py-3 font-semibold">
                                          Vendor
                                        </th>
                                        <th className="px-4 py-3 font-semibold">
                                          Price
                                        </th>
                                        <th className="px-4 py-3 font-semibold">
                                          Ingredient cost
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {selectedReplacementRecipe.ingredients.map(
                                        (ingredient, ingredientIndex) => {
                                          const options =
                                            replacementVendorOptions[
                                              ingredientIndex
                                            ] ?? []
                                          const selectedVendor = options.find(
                                            (option) =>
                                              option.key ===
                                              replacementSelectedVendors[
                                                ingredientIndex
                                              ],
                                          )
                                          const isNmp =
                                            ingredient.ingredientType === 'NMP'
                                          const portion = Number(
                                            replacementPortion,
                                          )
                                          const basePax =
                                            Number(
                                              selectedReplacementRecipe.portionSize,
                                            ) > 0
                                              ? Number(
                                                  selectedReplacementRecipe.portionSize,
                                                )
                                              : 1
                                          const qty =
                                            Number.isFinite(portion) &&
                                            portion > 0
                                              ? (Number(ingredient.qty) *
                                                  portion) /
                                                basePax
                                              : 0
                                          const customPrice = Number(
                                            replacementCustomPrices[
                                              ingredientIndex
                                            ],
                                          )
                                          const unitPrice = isNmp
                                            ? Number.isFinite(customPrice)
                                              ? customPrice
                                              : undefined
                                            : getReplacementVendorUnitPrice(
                                                selectedVendor,
                                              ) ??
                                              getReplacementIngredientFallbackPrice(
                                                ingredient,
                                              )
                                          const ingredientCost =
                                            unitPrice === undefined
                                              ? undefined
                                              : qty * unitPrice
                                          const vendorError =
                                            replacementVendorErrors[
                                              ingredientIndex
                                            ]

                                          return (
                                            <tr
                                              key={`${ingredient.productCode}-${ingredientIndex}`}
                                              className="border-t border-border"
                                            >
                                              <td className="px-4 py-3 text-muted">
                                                {ingredientIndex + 1}
                                              </td>
                                              <td className="px-4 py-3">
                                                {ingredient.productCode || '-'}
                                              </td>
                                              <td className="px-4 py-3">
                                                {ingredient.name}
                                              </td>
                                              <td className="px-4 py-3">
                                                {formatQuantity(qty)}
                                              </td>
                                              <td className="px-4 py-3">
                                                {formatUnitLabel(
                                                  ingredient.unitOfMeasures,
                                                )}
                                              </td>
                                              <td className="min-w-52 px-4 py-3">
                                                {isNmp ? (
                                                  <input
                                                    type="text"
                                                    value="CUSTOM"
                                                    readOnly
                                                    className="w-full rounded-md border border-border bg-slate-100 px-3 py-2 text-sm text-muted"
                                                  />
                                                ) : (
                                                  <>
                                                    <select
                                                      value={
                                                        replacementSelectedVendors[
                                                          ingredientIndex
                                                        ] ?? ''
                                                      }
                                                      onChange={(event) => {
                                                        setReplacementSelectedVendors(
                                                          (current) => ({
                                                            ...current,
                                                            [ingredientIndex]:
                                                              event.target
                                                                .value,
                                                          }),
                                                        )
                                                        setChangeMenuError('')
                                                      }}
                                                      disabled={
                                                        replacementVendorLoading ||
                                                        options.length === 0 ||
                                                        changeMenuSubmitting
                                                      }
                                                      required
                                                      className={`w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20 disabled:cursor-not-allowed disabled:opacity-60 ${
                                                        options.length > 1
                                                          ? 'border-amber-400 bg-amber-100'
                                                          : 'border-border bg-white'
                                                      }`}
                                                    >
                                                      {replacementVendorLoading ? (
                                                        <option value="">
                                                          Loading vendors...
                                                        </option>
                                                      ) : options.length ===
                                                        0 ? (
                                                        <option value="">
                                                          {vendorError ||
                                                            'No vendor for this site'}
                                                        </option>
                                                      ) : null}
                                                      {options.map((option) => (
                                                        <option
                                                          key={option.key}
                                                          value={option.key}
                                                        >
                                                          {option.vendor}
                                                        </option>
                                                      ))}
                                                    </select>
                                                    {vendorError ? (
                                                      <p className="mt-1 text-xs text-danger">
                                                        {vendorError}
                                                      </p>
                                                    ) : null}
                                                  </>
                                                )}
                                              </td>
                                              <td className="px-4 py-3 font-medium">
                                                {isNmp ? (
                                                  <input
                                                    type="number"
                                                    min="0"
                                                    step="any"
                                                    value={
                                                      replacementCustomPrices[
                                                        ingredientIndex
                                                      ] ?? ''
                                                    }
                                                    onChange={(event) => {
                                                      setReplacementCustomPrices(
                                                        (current) => ({
                                                          ...current,
                                                          [ingredientIndex]:
                                                            event.target.value,
                                                        }),
                                                      )
                                                      setChangeMenuError('')
                                                    }}
                                                    disabled={
                                                      changeMenuSubmitting
                                                    }
                                                    aria-label={`Price for ${ingredient.name}`}
                                                    required
                                                    className="w-32 rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20 disabled:cursor-not-allowed disabled:opacity-60"
                                                  />
                                                ) : (
                                                  formatPrice(unitPrice)
                                                )}
                                              </td>
                                              <td className="px-4 py-3 font-medium">
                                                {formatPrice(ingredientCost)}
                                              </td>
                                            </tr>
                                          )
                                        },
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            ) : null}

                            {items.map((menu) => {
                              const ingredients = menu.ingredients ?? []
                              const {
                                estimatedCost,
                                estimatedCostPerPax,
                              } = getMenuCostSummary(menu)
                              const canCancelPendingMenu =
                                !enableStoreRequestCancellation &&
                                menu.approvalStatus === 'pending'
                              const canCancelStoreRequestMenu =
                                enableStoreRequestCancellation &&
                                menu.storeRequestStatus !== 'cancelled'

                              return (
                                <div
                                  key={menu.id}
                                  className="grid gap-3 lg:grid-cols-[1.1fr_2.9fr]"
                                >
                                  <div className="rounded-md border border-border bg-surface p-4">
                                    <div className="flex items-center justify-between gap-3">
                                      <div>
                                        <h3 className="font-semibold text-foreground">
                                          Menu
                                        </h3>
                                        <p className="mt-1 text-xs text-muted">
                                          ID: {menu.recipeCode ?? '-'}
                                        </p>
                                        <p className="mt-1 text-xs text-muted">
                                          {menu.menuName}
                                        </p>
                                        <p className="mt-1 text-xs text-muted">
                                          {menu.category}
                                        </p>
                                      </div>
                                      <span className="rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold text-primary">
                                        {menu.portion} portions
                                      </span>
                                    </div>

                                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                                      <div>
                                        <p className="text-xs text-muted">
                                          Approval
                                        </p>
                                        <p
                                          className={`mt-1 text-sm font-medium ${
                                            menu.approvalStatus === 'rejected'
                                              ? 'text-danger'
                                              : ''
                                          }`}
                                        >
                                          {getApprovalStatusLabel(menu.approvalStatus)}
                                        </p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-muted">
                                          Store request
                                        </p>
                                        <p className="mt-1 text-sm font-medium">
                                          {getStoreRequestStatusLabel(
                                            menu.storeRequestStatus,
                                          )}
                                        </p>
                                      </div>
                                    </div>

                                    <div className="mt-4 grid grid-cols-2 gap-3">
                                      <div className="rounded-md border border-border bg-background p-3">
                                        <p className="text-xs text-muted">
                                          Estimated total cost
                                        </p>
                                        <p className="mt-1 text-sm font-semibold text-foreground">
                                          {formatPrice(estimatedCost)}
                                        </p>
                                      </div>
                                      <div className="rounded-md border border-border bg-background p-3">
                                        <p className="text-xs text-muted">
                                          Cost per pax
                                        </p>
                                        <p className="mt-1 text-sm font-semibold text-foreground">
                                          {formatPrice(estimatedCostPerPax)}
                                        </p>
                                      </div>
                                    </div>

                                    {canCancelPendingMenu ||
                                    canCancelStoreRequestMenu ? (
                                      <div className="mt-4 flex flex-wrap gap-2">
                                        {canCancelPendingMenu ? (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              openPendingCancellationModal(
                                                group,
                                                menu,
                                              )
                                            }
                                            disabled={
                                              cancellingGroupKey === groupKey
                                            }
                                            className="rounded-md border border-danger bg-white px-3 py-2 text-xs font-semibold text-danger hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-60"
                                          >
                                            {cancellingGroupKey === groupKey
                                              ? 'Cancelling...'
                                              : 'Cancel menu'}
                                          </button>
                                        ) : null}
                                        {canCancelStoreRequestMenu ? (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              openCancellationModal(group, menu)
                                            }
                                            disabled={
                                              cancellingGroupKey === groupKey
                                            }
                                            className="rounded-md border border-danger bg-white px-3 py-2 text-xs font-semibold text-danger hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-60"
                                          >
                                            {cancellingGroupKey === groupKey
                                              ? 'Cancelling...'
                                              : 'Cancel request'}
                                          </button>
                                        ) : null}
                                      </div>
                                    ) : null}

                                    {menu.storeRequestStatus === 'cancelled' ? (
                                      <div className="mt-4 rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
                                        Cancel reason:{' '}
                                        {menu.cancellationReason?.trim() || '-'}
                                      </div>
                                    ) : null}
                                    {menu.approvalStatus === 'rejected' ? (
                                      <div className="mt-4 rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
                                        Reject reason:{' '}
                                        {menu.rejectionReason?.trim() || '-'}
                                      </div>
                                    ) : null}
                                  </div>

                                  <div className="rounded-md border border-border bg-surface p-4">
                                    <h3 className="font-semibold text-foreground">
                                      Ingredients
                                    </h3>
                                    <p className="mt-1 text-xs text-muted">
                                      Qty calculated from base pax (
                                      {menu.portionSize ?? 1}) for {menu.portion}{' '}
                                      portions
                                    </p>

                                    {menu.missingRecipe ? (
                                      <div className="mt-3 rounded-md border border-border bg-background p-4 text-sm text-muted">
                                        Recipe not found in the recipe list. Make
                                        sure the menu name matches the created
                                        recipe.
                                      </div>
                                    ) : ingredients.length === 0 ? (
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
                                                Price
                                              </th>
                                              <th className="px-4 py-3 font-semibold">
                                                Ingredient cost
                                              </th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {ingredients.map((ingredient, idx) => (
                                              <tr
                                                key={`${ingredient.productCode}-${idx}`}
                                                className="border-t border-border"
                                              >
                                                <td className="px-4 py-3 text-sm text-muted">
                                                  {idx + 1}
                                                </td>
                                                <td className="px-4 py-3">
                                                  {ingredient.productCode}
                                                </td>
                                                <td className="px-4 py-3">
                                                  {ingredient.name}
                                                </td>
                                                <td className="px-4 py-3">
                                                  {formatQuantity(ingredient.qty)}
                                                </td>
                                                <td className="px-4 py-3">
                                                  {formatUnitLabel(
                                                    ingredient.unitOfMeasures,
                                                  )}
                                                </td>
                                                <td className="px-4 py-3 font-medium">
                                                  {formatPrice(ingredient.price)}
                                                </td>
                                                <td className="px-4 py-3 font-medium">
                                                  {formatPrice(
                                                    ingredient.ingredientCost,
                                                  )}
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )
                            })}

                            <div className="rounded-md border border-border bg-surface p-4">
                              <h3 className="font-semibold text-foreground">
                                Summary
                              </h3>
                              <p className="mt-1 text-xs text-muted">
                                Ingredient summary
                              </p>
                              <p className="mt-1 text-xs text-muted">
                                Combined ingredients for all menus on {date}.
                              </p>
                              {group.fulfillment?.completedBy ? (
                                <p className="mt-1 text-xs text-muted">
                                  Storekeeper: {group.fulfillment.completedBy}
                                </p>
                              ) : null}
                              {group.fulfillment?.completedAt ? (
                                <p className="mt-1 text-xs text-muted">
                                  Updated at:{' '}
                                  {new Date(
                                    group.fulfillment.completedAt,
                                  ).toLocaleString()}
                                </p>
                              ) : null}
                              {group.fulfillment?.note ? (
                                <p className="mt-1 text-xs text-muted">
                                  {group.fulfillment.status === 'cancelled'
                                    ? 'Cancellation reason: '
                                    : 'Storekeeper note: '}
                                  {group.fulfillment.note}
                                </p>
                              ) : null}

                              {summaryItems.length === 0 ? (
                                <div className="mt-3 rounded-md border border-border bg-background p-4 text-sm text-muted">
                                  No ingredient summary available yet.
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
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {summaryItems.map((ingredient, idx) => (
                                        <tr
                                          key={`${ingredient.productCode}-${idx}`}
                                          className="border-t border-border"
                                        >
                                          <td className="px-4 py-3 text-sm text-muted">
                                            {idx + 1}
                                          </td>
                                          <td className="px-4 py-3">
                                            {ingredient.productCode}
                                          </td>
                                          <td className="px-4 py-3">
                                            {ingredient.name}
                                          </td>
                                          <td className="px-4 py-3">
                                            {formatQuantity(ingredient.qty)}
                                          </td>
                                          <td className="px-4 py-3">
                                            {formatUnitLabel(
                                              ingredient.unitOfMeasures,
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {bulkExportOpen && typeof document !== 'undefined'
        ? createPortal(
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/20 px-4 py-2 backdrop-blur-sm sm:p-4">
              <form
                className="flex w-full max-w-xl flex-col overflow-hidden rounded-md border border-border bg-surface shadow-[0_12px_36px_rgba(15,23,42,0.12)]"
                role="dialog"
                aria-modal="true"
                aria-labelledby="bulk-export-title"
                onSubmit={(event) => {
                  event.preventDefault()
                  handleBulkExport().catch(() => null)
                }}
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-6 py-5">
                  <div>
                    <p className="text-xs text-muted">Store Request Export</p>
                    <h3
                      id="bulk-export-title"
                      className="mt-1 text-lg font-semibold text-foreground"
                    >
                      Bulk Export
                    </h3>
                    <p className="mt-2 text-sm text-muted">
                      Select the production date range to include in the export.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeBulkExportModal}
                    disabled={bulkExporting}
                    className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Close
                  </button>
                </div>

                <div className="space-y-5 px-6 py-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="bulk-export-start-date"
                        className="text-sm font-medium text-foreground"
                      >
                        Start date
                      </label>
                      <input
                        id="bulk-export-start-date"
                        type="date"
                        value={bulkExportStartDate}
                        max={bulkExportEndDate || undefined}
                        onChange={(event) => {
                          setBulkExportStartDate(event.target.value)
                          setBulkExportError('')
                        }}
                        disabled={bulkExporting}
                        className="mt-2 w-full rounded-xl border border-border bg-white px-4 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20 disabled:cursor-not-allowed disabled:opacity-60"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="bulk-export-end-date"
                        className="text-sm font-medium text-foreground"
                      >
                        End date
                      </label>
                      <input
                        id="bulk-export-end-date"
                        type="date"
                        value={bulkExportEndDate}
                        min={bulkExportStartDate || undefined}
                        onChange={(event) => {
                          setBulkExportEndDate(event.target.value)
                          setBulkExportError('')
                        }}
                        disabled={bulkExporting}
                        className="mt-2 w-full rounded-xl border border-border bg-white px-4 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20 disabled:cursor-not-allowed disabled:opacity-60"
                      />
                    </div>
                  </div>

                  {bulkExportError ? (
                    <p className="text-xs font-medium text-red-600">
                      {bulkExportError}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border px-6 py-4">
                  <button
                    type="button"
                    onClick={closeBulkExportModal}
                    disabled={bulkExporting}
                    className="rounded-md border border-border bg-background px-4 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={bulkExporting}
                    className="rounded-md border border-success bg-success px-4 py-2 text-xs font-semibold text-white shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="flex items-center gap-2">
                      <i className="bi bi-download text-sm" aria-hidden="true" />
                      <span>{bulkExporting ? 'Exporting...' : 'Export'}</span>
                    </span>
                  </button>
                </div>
              </form>
            </div>,
            document.body,
          )
        : null}

      {completionGroup && typeof document !== 'undefined'
        ? createPortal(
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/20 px-4 py-2 backdrop-blur-sm sm:p-4">
              <div
                className="flex max-h-[96vh] w-full max-w-6xl flex-col overflow-hidden rounded-md border border-border bg-surface shadow-[0_12px_36px_rgba(15,23,42,0.12)]"
                role="dialog"
                aria-modal="true"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-6 py-5">
                  <div>
                    <p className="text-xs text-muted">
                      Superadmin Actual Qty Override
                    </p>
                    <h3 className="mt-1 text-lg font-semibold text-foreground">
                      {completionGroup.productionCode
                        ? `${completionGroup.date} (${completionGroup.productionCode})`
                        : completionGroup.date}
                    </h3>
                    <p className="mt-2 text-sm text-muted">
                      Save actual raw material delivery for this batch, or
                      correct previously completed actual qty.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeCompletionModal}
                    disabled={Boolean(cancellingGroupKey)}
                    className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Close
                  </button>
                </div>

                <div className="space-y-6 overflow-y-auto px-6 py-5">
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="rounded-md border border-border bg-white p-4">
                      <p className="text-xs text-muted">Production date</p>
                      <p className="mt-2 text-sm font-medium text-foreground">
                        {completionGroup.date}
                      </p>
                    </div>
                    <div className="rounded-md border border-border bg-white p-4">
                      <p className="text-xs text-muted">Production code</p>
                      <p className="mt-2 text-sm font-medium text-foreground">
                        {completionGroup.productionCode ?? '-'}
                      </p>
                    </div>
                    <div className="rounded-md border border-border bg-white p-4">
                      <p className="text-xs text-muted">Menus in batch</p>
                      <p className="mt-2 text-sm font-medium text-foreground">
                        {completionGroup.items.length}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-md border border-border bg-surface p-4">
                    <p className="text-xs text-muted">Planned menu basis</p>
                    <div className="mt-3 max-w-full overflow-x-auto rounded-md border border-border bg-white">
                      <table className="dm-table min-w-full text-sm">
                        <thead className="bg-background">
                          <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                            <th className="w-12 px-3 py-1.5 font-semibold">No</th>
                            <th className="px-3 py-1.5 font-semibold">Menu ID</th>
                            <th className="px-3 py-1.5 font-semibold">Menu</th>
                            <th className="px-3 py-1.5 font-semibold">Category</th>
                            <th className="px-3 py-1.5 font-semibold">Portion</th>
                          </tr>
                        </thead>
                        <tbody>
                          {completionGroup.items.map((menu, index) => (
                            <tr key={menu.id} className="border-t border-border">
                              <td className="px-3 py-1.5 text-sm text-muted">
                                {index + 1}
                              </td>
                              <td className="px-3 py-1.5 font-medium">
                                {menu.recipeCode ?? '-'}
                              </td>
                              <td className="px-3 py-1.5">{menu.menuName}</td>
                              <td className="px-3 py-1.5">{menu.category}</td>
                              <td className="px-3 py-1.5">{menu.portion}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="rounded-md border border-border bg-surface p-4">
                    <div>
                      <p className="text-xs text-muted">Actual issuance</p>
                      <p className="mt-1 text-sm text-muted">
                        Actual qty uses dot decimal format like `0.5`. Reason
                        is required when actual qty differs from planned qty.
                      </p>
                    </div>

                    <div className="mt-4 max-w-full overflow-x-auto rounded-md border border-border bg-white">
                      <table className="dm-table min-w-full text-sm">
                        <thead className="bg-background">
                          <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                            <th className="w-12 px-3 py-1.5 font-semibold">No</th>
                            <th className="px-3 py-1.5 font-semibold">
                              Product code
                            </th>
                            <th className="px-3 py-1.5 font-semibold">
                              Ingredient
                            </th>
                            <th className="px-3 py-1.5 font-semibold">
                              Planned qty
                            </th>
                            <th className="px-3 py-1.5 font-semibold">
                              Actual qty
                            </th>
                            <th className="px-3 py-1.5 font-semibold">
                              Variance
                            </th>
                            <th className="px-3 py-1.5 font-semibold">Unit</th>
                            <th className="min-w-[220px] px-3 py-1.5 font-semibold">
                              Reason
                            </th>
                            <th className="w-24 px-3 py-1.5 font-semibold">
                              Action
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {completionRows.map((row, index) => {
                            const varianceQty = getVarianceQty(
                              row.plannedQty,
                              row.actualQty,
                            )
                            const varianceClass =
                              varianceQty === null
                                ? 'text-muted'
                                : !quantitiesDiffer(varianceQty, 0)
                                  ? 'text-muted'
                                  : varianceQty > 0
                                    ? 'text-primary'
                                    : 'text-danger'

                            return (
                              <tr key={row.id} className="border-t border-border">
                                <td className="px-3 py-1.5 text-sm text-muted">
                                  {index + 1}
                                </td>
                                <td className="px-3 py-1.5">
                                  {row.isAdditional ? (
                                    <input
                                      type="text"
                                      value={row.productCode}
                                      onChange={(event) =>
                                        updateCompletionRow(
                                          row.id,
                                          'productCode',
                                          event.target.value,
                                        )
                                      }
                                      placeholder="Product code"
                                      className="w-32 rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                                    />
                                  ) : (
                                    row.productCode
                                  )}
                                </td>
                                <td className="px-3 py-1.5">
                                  {row.isAdditional ? (
                                    <input
                                      type="text"
                                      value={row.name}
                                      onChange={(event) =>
                                        updateCompletionRow(
                                          row.id,
                                          'name',
                                          event.target.value,
                                        )
                                      }
                                      placeholder="Ingredient name"
                                      className="w-48 rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                                    />
                                  ) : (
                                    row.name
                                  )}
                                </td>
                                <td className="px-3 py-1.5 font-medium">
                                  {formatQuantity(row.plannedQty)}
                                </td>
                                <td className="px-3 py-1.5">
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={row.actualQty}
                                    onChange={(event) =>
                                      updateCompletionRow(
                                        row.id,
                                        'actualQty',
                                        event.target.value,
                                      )
                                    }
                                    placeholder="0"
                                    className="w-28 rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                                  />
                                </td>
                                <td
                                  className={`px-3 py-1.5 font-medium ${varianceClass}`}
                                >
                                  {varianceQty === null
                                    ? '-'
                                    : formatSignedQuantity(varianceQty)}
                                </td>
                                <td className="px-3 py-1.5">
                                  {row.isAdditional ? (
                                    <input
                                      type="text"
                                      value={row.unitOfMeasures}
                                      onChange={(event) =>
                                        updateCompletionRow(
                                          row.id,
                                          'unitOfMeasures',
                                          event.target.value,
                                        )
                                      }
                                      placeholder="Unit"
                                      className="w-28 rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                                    />
                                  ) : (
                                    formatUnitLabel(row.unitOfMeasures)
                                  )}
                                </td>
                                <td className="px-3 py-1.5">
                                  <input
                                    type="text"
                                    value={row.reason}
                                    onChange={(event) =>
                                      updateCompletionRow(
                                        row.id,
                                        'reason',
                                        event.target.value,
                                      )
                                    }
                                    placeholder={
                                      row.isAdditional
                                        ? 'Required for added ingredient'
                                        : 'Required if variance exists'
                                    }
                                    className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                                  />
                                </td>
                                <td className="px-3 py-1.5">
                                  {row.isAdditional ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleRemoveCompletionRow(row.id)
                                      }
                                      disabled={Boolean(cancellingGroupKey)}
                                      className="rounded-md border border-danger bg-white px-3 py-2 text-xs font-semibold text-danger hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      Remove
                                    </button>
                                  ) : (
                                    <span className="text-xs text-muted">
                                      Planned
                                    </span>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                          <tr className="border-t border-border">
                            <td colSpan={9} className="px-3 py-3">
                              <div className="flex justify-center">
                                <button
                                  type="button"
                                  onClick={handleAddCompletionRow}
                                  disabled={Boolean(cancellingGroupKey)}
                                  className="inline-flex items-center gap-2 rounded-md border border-primary bg-primary px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  + Add ingredient
                                </button>
                              </div>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <div className="mt-4">
                      <label className="text-sm font-medium text-foreground">
                        Batch note
                      </label>
                      <textarea
                        value={completionNote}
                        onChange={(event) => setCompletionNote(event.target.value)}
                        rows={3}
                        placeholder="Optional note for this delivery batch"
                        className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                      />
                    </div>

                    {completionError ? (
                      <p className="mt-4 text-xs font-medium text-red-600">
                        {completionError}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border px-6 py-4">
                  <ActionButton
                    action="cancel"
                    onClick={closeCompletionModal}
                    disabled={Boolean(cancellingGroupKey)}
                    size="sm"
                  />
                  <ActionButton
                    action="save"
                    onClick={handleSubmitCompletion}
                    disabled={Boolean(cancellingGroupKey)}
                    size="sm"
                  />
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {pendingCancellationGroup &&
      pendingCancellationMenu &&
      typeof document !== 'undefined'
        ? createPortal(
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/20 px-4 py-2 backdrop-blur-sm sm:p-4">
              <div
                className="flex w-full max-w-xl flex-col overflow-hidden rounded-md border border-border bg-surface shadow-[0_12px_36px_rgba(15,23,42,0.12)]"
                role="dialog"
                aria-modal="true"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-6 py-5">
                  <div>
                    <p className="text-xs text-muted">Cancel Menu</p>
                    <h3 className="mt-1 text-lg font-semibold text-foreground">
                      {pendingCancellationMenu.menuName}
                    </h3>
                    <p className="mt-2 text-sm text-muted">
                      This will remove only this pending menu from the
                      production batch.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closePendingCancellationModal}
                    disabled={Boolean(cancellingGroupKey)}
                    className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Close
                  </button>
                </div>

                <div className="space-y-5 px-6 py-5">
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="rounded-md border border-border bg-white p-4">
                      <p className="text-xs text-muted">Production date</p>
                      <p className="mt-2 text-sm font-medium text-foreground">
                        {pendingCancellationGroup.date}
                      </p>
                    </div>
                    <div className="rounded-md border border-border bg-white p-4">
                      <p className="text-xs text-muted">Production code</p>
                      <p className="mt-2 text-sm font-medium text-foreground">
                        {pendingCancellationGroup.productionCode ?? '-'}
                      </p>
                    </div>
                    <div className="rounded-md border border-border bg-white p-4">
                      <p className="text-xs text-muted">Menu ID</p>
                      <p className="mt-2 text-sm font-medium text-foreground">
                        {pendingCancellationMenu.recipeCode ?? '-'}
                      </p>
                    </div>
                  </div>

                  <p className="text-sm text-muted">
                    Are you sure you want to cancel this menu?
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border px-6 py-4">
                  <button
                    type="button"
                    onClick={closePendingCancellationModal}
                    disabled={Boolean(cancellingGroupKey)}
                    className="rounded-md border border-border bg-background px-4 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmPendingCancellation}
                    disabled={Boolean(cancellingGroupKey)}
                    className="rounded-md bg-danger px-4 py-2 text-xs font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {cancellingGroupKey ? 'Cancelling...' : 'Confirm cancel'}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {cancellationGroup && typeof document !== 'undefined'
        ? createPortal(
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/20 px-4 py-2 backdrop-blur-sm sm:p-4">
              <div
                className="flex w-full max-w-2xl flex-col overflow-hidden rounded-md border border-border bg-surface shadow-[0_12px_36px_rgba(15,23,42,0.12)]"
                role="dialog"
                aria-modal="true"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-6 py-5">
                  <div>
                    <p className="text-xs text-muted">Cancel Store Request</p>
                    <h3 className="mt-1 text-lg font-semibold text-foreground">
                      {cancellationMenu?.menuName ?? 'Selected menu'}
                    </h3>
                    <p className="mt-2 text-sm text-muted">
                      This superadmin override cancels this menu regardless of
                      approval or store request status. A reason is required.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeCancellationModal}
                    disabled={Boolean(cancellingGroupKey)}
                    className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Close
                  </button>
                </div>

                <div className="space-y-5 px-6 py-5">
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="rounded-md border border-border bg-white p-4">
                      <p className="text-xs text-muted">Production date</p>
                      <p className="mt-2 text-sm font-medium text-foreground">
                        {cancellationGroup.date}
                      </p>
                    </div>
                    <div className="rounded-md border border-border bg-white p-4">
                      <p className="text-xs text-muted">Production code</p>
                      <p className="mt-2 text-sm font-medium text-foreground">
                        {cancellationGroup.productionCode ?? '-'}
                      </p>
                    </div>
                    <div className="rounded-md border border-border bg-white p-4">
                      <p className="text-xs text-muted">Menus in batch</p>
                      <p className="mt-2 text-sm font-medium text-foreground">
                        {cancellationGroup.items.length}
                      </p>
                    </div>
                    <div className="rounded-md border border-border bg-white p-4">
                      <p className="text-xs text-muted">Menu</p>
                      <p className="mt-2 text-sm font-medium text-foreground">
                        {cancellationMenu?.menuName ?? '-'}
                      </p>
                    </div>
                    <div className="rounded-md border border-border bg-white p-4">
                      <p className="text-xs text-muted">Menu ID</p>
                      <p className="mt-2 text-sm font-medium text-foreground">
                        {cancellationMenu?.recipeCode ?? '-'}
                      </p>
                    </div>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-foreground">
                      Cancellation reason
                    </label>
                    <textarea
                      value={cancellationReason}
                      onChange={(event) => setCancellationReason(event.target.value)}
                      rows={4}
                      placeholder="Explain why this store request must be cancelled."
                      className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                    />
                    <p className="mt-2 text-xs text-muted">
                      The reason will be saved and shown in related store
                      request records.
                    </p>
                  </div>

                  {cancellationError ? (
                    <p className="text-xs font-medium text-red-600">
                      {cancellationError}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border px-6 py-4">
                  <button
                    type="button"
                    onClick={closeCancellationModal}
                    disabled={Boolean(cancellingGroupKey)}
                    className="rounded-md border border-border bg-background px-4 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmitCancellation}
                    disabled={Boolean(cancellingGroupKey)}
                    className="rounded-md bg-danger px-4 py-2 text-xs font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {cancellingGroupKey ? 'Cancelling...' : 'Confirm cancel'}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

export default ChefStoreRequest
