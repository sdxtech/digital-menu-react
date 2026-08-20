import { Fragment, useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { apiFetch } from '../lib/api'
import { useChefData } from '../lib/chef-data'
import { formatQuantity, formatSignedQuantity, quantitiesDiffer } from '../lib/quantity'
import { formatRecipeVersion } from '../lib/recipe-version'
import {
  aggregateStoreRequestSummary,
  aggregateStoreRequestSummaryByVendor,
} from '../lib/store-request-summary'
import { formatUnitLabel } from '../lib/unit-of-measures'
import { useAuth } from '../lib/auth'
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

type StoreFulfillmentIngredient = {
  productCode: string
  name: string
  unitOfMeasures: string
  plannedQty: number
  actualQty: number
  varianceQty: number
  vendor?: string
  vendorSite?: string
  price?: number
  ingredientCost?: number
  plannedPrice?: number
  actualPrice?: number
  variancePrice?: number
  reason?: string
}

type StoreRequestFulfillment = {
  status?: 'fulfilled' | 'cancelled'
  completedBy?: string
  completedAt?: string
  note?: string
  items: StoreFulfillmentIngredient[]
}

type StoreRequestMenu = {
  id: string
  productionCode?: string
  recipeId?: string
  recipeCode?: string
  recipeVersion?: number
  approvedAt?: string
  menuName: string
  clientName?: string
  category: string
  portion: number
  estimatedCost?: number
  estimatedCostPerPax?: number
  productionDate?: string
  storeRequestStatus?: 'not-requested' | 'requested' | 'fulfilled' | 'cancelled'
  portionSize?: number
  ingredients?: StoreRequestIngredient[]
  site?: string
  fulfilledBy?: string
  fulfilledAt?: string
  cancelledBy?: string
  cancelledAt?: string
  cancellationReason?: string
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

type ReconciliationRow = {
  id: string
  productCode: string
  name: string
  unitOfMeasures: string
  vendor?: string
  vendorSite?: string
  plannedQty: number
  actualQty: string
  plannedPrice?: number
  actualPrice: string
  reason: string
  isAdditional: boolean
}

const ITEMS_PER_PAGE = 10

type DateFilterKind = 'created' | 'production'
type DateSortOrder = 'none' | 'desc' | 'asc'

const matchesDateRange = (
  value: string | undefined,
  startDate: string,
  endDate: string,
) => {
  if (!startDate && !endDate) return true
  if (!value) return false
  const date = value.slice(0, 10)
  return (!startDate || date >= startDate) && (!endDate || date <= endDate)
}

const getGroupCreatedDate = (group: StoreRequestGroup) =>
  group.items.find((item) => item.approvedAt)?.approvedAt?.slice(0, 10) ?? ''

const getStoreRequestGroupKey = (group: {
  date: string
  productionCode?: string
  site?: string
}) =>
  `${group.site ?? 'no-site'}__${group.date}__${group.productionCode ?? 'no-code'}`

const mergeStoreRequestGroups = (groups: StoreRequestGroup[]) => {
  const groupedByBatch = new Map<string, StoreRequestGroup>()

  groups.forEach((group) => {
    const groupKey = getStoreRequestGroupKey(group)
    const existing = groupedByBatch.get(groupKey)
    if (!existing) {
      groupedByBatch.set(groupKey, {
        ...group,
        items: [...group.items],
        summary: [...(group.summary ?? [])],
        missingRecipes: [...(group.missingRecipes ?? [])],
      })
      return
    }

    existing.items.push(...group.items)
    existing.summary = aggregateStoreRequestSummary([
      ...(existing.summary ?? []),
      ...(group.summary ?? []),
    ])
    existing.missingRecipes = Array.from(
      new Set([...existing.missingRecipes, ...group.missingRecipes]),
    )
    if (!existing.fulfillment && group.fulfillment) {
      existing.fulfillment = group.fulfillment
    }
  })

  return Array.from(groupedByBatch.values()).sort((a, b) => {
    const byDate = b.date.localeCompare(a.date)
    if (byDate !== 0) return byDate
    return (b.productionCode ?? '').localeCompare(a.productionCode ?? '')
  })
}

const buildStoreRequestExportRows = (groups: StoreRequestGroup[]) => {
  const rows: SpreadsheetCell[][] = [
    [
      'No',
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
      const menuRows = ingredients.length > 0 ? ingredients : [undefined]
      menuRows.forEach((ingredient) => {
        rows.push([
          rowNumber,
          toSpreadsheetDate(group.date),
          group.site ?? '',
          menu.clientName ?? '',
          group.productionCode ?? '',
          menu.menuName,
          formatRecipeVersion(menu.recipeVersion),
          menu.recipeCode ?? menu.recipeId ?? '',
          menu.category,
          menu.portion,
          ingredient?.ingredientType ?? '',
          ingredient?.productCode ?? '',
          ingredient?.name ?? '',
          ingredient?.vendor ?? '',
          ingredient ? toSpreadsheetDecimal(formatQuantity(ingredient.qty)) : '',
          ingredient ? formatUnitLabel(ingredient.unitOfMeasures) : '',
          ingredient ? toSpreadsheetInteger(ingredient.price) : '',
          ingredient ? toSpreadsheetInteger(ingredient.ingredientCost) : '',
        ])
        rowNumber += 1
      })
    })
  })

  return rows
}

const buildIngredientSummaryExportRows = (groups: StoreRequestGroup[]) => [
  ['Production Date', 'Site', 'Client Name', 'Product Type', 'Product Code', 'Ingredient Name', 'Vendor', 'QTY', 'Unit'],
  ...groups.flatMap((group) =>
    aggregateStoreRequestSummaryByVendor(group).map((item) => [
      toSpreadsheetDate(group.date),
      group.site ?? '',
      group.items[0]?.clientName ?? '',
      item.ingredientType ?? '',
      item.productCode,
      item.name,
      item.vendor ?? '',
      toSpreadsheetDecimal(formatQuantity(item.qty)),
      formatUnitLabel(item.unitOfMeasures),
    ]),
  ),
] as SpreadsheetCell[][]

const buildEstimatedCostExportRows = (groups: StoreRequestGroup[]) => [
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
  ...groups.flatMap((group) =>
    group.items.map((menu) => {
      const estimatedTotalCost = Number.isFinite(menu.estimatedCost)
        ? menu.estimatedCost
        : undefined
      const estimatedCostPerPax = Number.isFinite(menu.estimatedCostPerPax)
        ? menu.estimatedCostPerPax
        : estimatedTotalCost !== undefined && menu.portion > 0
          ? estimatedTotalCost / menu.portion
          : undefined

      return [
      toSpreadsheetDate(group.date),
      group.site ?? '',
      menu.clientName ?? '',
      menu.menuName,
        formatRecipeVersion(menu.recipeVersion),
        menu.category,
        menu.portion,
        toSpreadsheetInteger(estimatedTotalCost),
        toSpreadsheetInteger(estimatedCostPerPax),
      ]
    }),
  ),
] as SpreadsheetCell[][]

const formatCreatedDate = (value?: string) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

const parseDotDecimal = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) {
    return { valid: false as const, reason: 'empty' as const }
  }
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
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
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
  plannedPrice: undefined,
  actualPrice: '',
  reason: '',
  isAdditional: true,
})

const normalizeReconciliationText = (value: string) => value.trim().toLowerCase()

const buildReconciliationItemKey = (
  productCode: string,
  name: string,
  unitOfMeasures: string,
  vendor?: string,
  vendorSite?: string,
) => {
  const identity = normalizeReconciliationText(productCode || name)
  const unit = normalizeReconciliationText(unitOfMeasures)
  if (!identity || !unit) return ''
  return `${identity}__${unit}__${normalizeReconciliationText(
    vendor ?? '',
  )}__${normalizeReconciliationText(vendorSite ?? '')}`
}

const StorekeeperPage = () => {
  const { accessToken, user } = useAuth()
  const { fulfillStoreRequestBatch, cancelStoreRequestBatch } = useChefData()
  const [loadError, setLoadError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [groups, setGroups] = useState<StoreRequestGroup[]>([])
  const [expandedGroups, setExpandedGroups] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [processingGroupKey, setProcessingGroupKey] = useState<string | null>(
    null,
  )
  const [loading, setLoading] = useState(false)
  const [reconciliationGroup, setReconciliationGroup] =
    useState<StoreRequestGroup | null>(null)
  const [reconciliationRows, setReconciliationRows] = useState<
    ReconciliationRow[]
  >([])
  const [reconciliationNote, setReconciliationNote] = useState('')
  const [reconciliationError, setReconciliationError] = useState('')
  const [cancellationGroup, setCancellationGroup] =
    useState<StoreRequestGroup | null>(null)
  const [cancellationMenu, setCancellationMenu] =
    useState<StoreRequestMenu | null>(null)
  const [cancellationReason, setCancellationReason] = useState('')
  const [cancellationError, setCancellationError] = useState('')
  const [bulkExportOpen, setBulkExportOpen] = useState(false)
  const [bulkExportStartDate, setBulkExportStartDate] = useState(() => {
    const today = new Date()
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`
  })
  const [bulkExportEndDate, setBulkExportEndDate] = useState(() => {
    const today = new Date()
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  })
  const [bulkExportError, setBulkExportError] = useState('')
  const [bulkExporting, setBulkExporting] = useState(false)
  const [activeDateFilter, setActiveDateFilter] =
    useState<DateFilterKind | null>(null)
  const [createdFilterStartDate, setCreatedFilterStartDate] = useState('')
  const [createdFilterEndDate, setCreatedFilterEndDate] = useState('')
  const [productionFilterStartDate, setProductionFilterStartDate] = useState('')
  const [productionFilterEndDate, setProductionFilterEndDate] = useState('')
  const [createdSortOrder, setCreatedSortOrder] =
    useState<DateSortOrder>('none')
  const [productionSortOrder, setProductionSortOrder] =
    useState<DateSortOrder>('none')

  // FRONTEND VIEW: backend returns grouped requests with ingredient summary.
  const fetchStoreRequests = useCallback(async () => {
    if (!accessToken) {
      setLoadError('Please log in first to load data.')
      return
    }

    setLoading(true)
    setLoadError('')
    try {
      const data = await apiFetch<{ items: StoreRequestGroup[] }>(
        '/menu-productions/store-requests?storeRequestStatus=requested&approvalStatus=approved',
        undefined,
        accessToken,
      )
      setGroups(data.items ?? [])
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to load data.'
      setLoadError(message)
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  useEffect(() => {
    fetchStoreRequests().catch(() => null)
  }, [fetchStoreRequests])

  const filteredGroups = groups.filter((group) => {
    const matchesCreatedDate = group.items.some((item) =>
      matchesDateRange(
        item.approvedAt,
        createdFilterStartDate,
        createdFilterEndDate,
      ),
    )
    const matchesProductionDate = matchesDateRange(
      group.date,
      productionFilterStartDate,
      productionFilterEndDate,
    )
    return matchesCreatedDate && matchesProductionDate
  }).sort((a, b) => {
    const sortByCreated = createdSortOrder !== 'none'
    const sortOrder = sortByCreated ? createdSortOrder : productionSortOrder
    if (sortOrder === 'none') return 0

    const aDate = sortByCreated ? getGroupCreatedDate(a) : a.date
    const bDate = sortByCreated ? getGroupCreatedDate(b) : b.date
    const comparison = aDate.localeCompare(bDate)
    return sortOrder === 'desc' ? -comparison : comparison
  })

  const clearStoreRequestNotification = useCallback(async (productionCode?: string) => {
    if (!accessToken || !user?.site) return

    const code = productionCode?.trim()

    await apiFetch(
      '/notifications/mark-role-read',
      {
        method: 'PATCH',
        body: JSON.stringify({
          siteCode: user.site,
          targetUserRole: 'storekeeper',
          componentKey: 'STORE_REQUEST_STOREKEEPER',
          ...(code ? { productionCode: code } : {}),
        }),
      },
      accessToken,
    )
    window.dispatchEvent(new CustomEvent('refresh-notifications'))
  }, [accessToken, user?.site])

  useEffect(() => {
    const nextTotalPages = Math.max(
      1,
      Math.ceil(filteredGroups.length / ITEMS_PER_PAGE),
    )
    setPage((prev) => Math.min(prev, nextTotalPages))
  }, [filteredGroups.length])

  const getGroupKey = (group: StoreRequestGroup) =>
    `${group.date}__${group.productionCode ?? 'no-code'}`

  const toReconciliationRows = (group: StoreRequestGroup): ReconciliationRow[] =>
    aggregateStoreRequestSummary(group.summary ?? []).map((item) => ({
      id: makeReconciliationRowId(),
      productCode: item.productCode,
      name: item.name,
      unitOfMeasures: item.unitOfMeasures,
      vendor: item.vendor,
      vendorSite: item.vendorSite,
      plannedQty: item.qty,
      actualQty: formatQuantity(item.qty),
      plannedPrice: Number.isFinite(Number(item.price))
        ? Number(item.price)
        : undefined,
      actualPrice: Number.isFinite(Number(item.price))
        ? String(Number(item.price))
        : '',
      reason: '',
      isAdditional: false,
    }))

  const handleExportMenusByDate = (group: StoreRequestGroup) => {
    const rows: SpreadsheetCell[][] = [
      [
        'No',
        'Production Date',
        'Client Name',
        'Production Code',
        'Menu Name',
        'Version',
        'Recipe Code',
        'Category',
        'Portion',
        'IT Code',
        'Ingredient Name',
        'Vendor',
        'QTY',
        'Unit',
      ],
    ]

    const vendorByIngredientKey = new Map<string, string>()
    const addVendorFallback = (item: {
      productCode: string
      name: string
      unitOfMeasures: string
      vendor?: string
    }) => {
      const vendor = item.vendor?.trim()
      if (!vendor) return
      const key = buildReconciliationItemKey(
        item.productCode,
        item.name,
        item.unitOfMeasures,
      )
      if (key && !vendorByIngredientKey.has(key)) {
        vendorByIngredientKey.set(key, vendor)
      }
    }
    aggregateStoreRequestSummary(group.summary ?? []).forEach(addVendorFallback)
    ;(group.fulfillment?.items ?? []).forEach(addVendorFallback)

    let rowNumber = 1
    group.items.forEach((menu) => {
      const ingredients = menu.ingredients ?? []
      if (ingredients.length === 0) {
        rows.push([
          rowNumber,
          toSpreadsheetDate(menu.productionDate ?? group.date),
          menu.clientName ?? '',
          menu.productionCode ?? group.productionCode ?? '',
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
        ])
        rowNumber += 1
        return
      }

      ingredients.forEach((ingredient) => {
        const ingredientKey = buildReconciliationItemKey(
          ingredient.productCode,
          ingredient.name,
          ingredient.unitOfMeasures,
        )
        const vendor =
          ingredient.vendor?.trim() ||
          (ingredientKey ? vendorByIngredientKey.get(ingredientKey) : '') ||
          ''

        rows.push([
          rowNumber,
          toSpreadsheetDate(menu.productionDate ?? group.date),
          menu.clientName ?? '',
          menu.productionCode ?? group.productionCode ?? '',
          menu.menuName,
          formatRecipeVersion(menu.recipeVersion),
          menu.recipeCode ?? menu.recipeId ?? '',
          menu.category,
          menu.portion,
          ingredient.productCode,
          ingredient.name,
          vendor,
          toSpreadsheetDecimal(formatQuantity(ingredient.qty)),
          formatUnitLabel(ingredient.unitOfMeasures),
        ])
        rowNumber += 1
      })
    })

    const summaryRows: SpreadsheetCell[][] = [
      ['Client Name', 'IT Code', 'Ingredient Name', 'Vendor', 'QTY', 'Unit'],
      ...aggregateStoreRequestSummaryByVendor(group).map((item) => [
        group.items[0]?.clientName ?? '',
        item.productCode,
        item.name,
        item.vendor ?? '',
        toSpreadsheetDecimal(formatQuantity(item.qty)),
        formatUnitLabel(item.unitOfMeasures),
      ]),
    ]

    const safeDate = group.date.replace(/[\\/:*?"<>|]/g, '-')
    const safeProductionCode = (group.productionCode ?? 'no-code').replace(
      /[\\/:*?"<>|]/g,
      '-',
    )
    downloadSpreadsheet(`store-request-${safeDate}-${safeProductionCode}.xlsx`, [
      { name: 'Store Request', rows },
      { name: 'Ingredient Summary', rows: summaryRows },
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
        site: group.site ?? user?.siteName ?? user?.site ?? '',
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

  const toggleExpanded = (groupKey: string) => {
    setExpandedGroups((prev) =>
      prev.includes(groupKey)
        ? prev.filter((item) => item !== groupKey)
        : [...prev, groupKey],
    )
  }

  const openReconciliationModal = (group: StoreRequestGroup) => {
    setActionMessage('')
    setLoadError('')
    setReconciliationGroup(group)
    setReconciliationRows(toReconciliationRows(group))
    setReconciliationNote('')
    setReconciliationError('')
  }

  const openCancellationModal = (
    group: StoreRequestGroup,
    menu: StoreRequestMenu,
  ) => {
    setActionMessage('')
    setLoadError('')
    setCancellationGroup(group)
    setCancellationMenu(menu)
    setCancellationReason('')
    setCancellationError('')
  }

  const closeReconciliationModal = () => {
    if (processingGroupKey) return
    setReconciliationGroup(null)
    setReconciliationRows([])
    setReconciliationNote('')
    setReconciliationError('')
  }

  const closeCancellationModal = () => {
    if (processingGroupKey) return
    setCancellationGroup(null)
    setCancellationMenu(null)
    setCancellationReason('')
    setCancellationError('')
  }

  const updateReconciliationRow = <K extends keyof ReconciliationRow>(
    rowId: string,
    field: K,
    value: ReconciliationRow[K],
  ) => {
    setReconciliationRows((prev) =>
      prev.map((row) =>
        row.id === rowId ? { ...row, [field]: value } : row,
      ),
    )
  }

  const handleAddReconciliationRow = () => {
    setReconciliationRows((prev) => [...prev, createAdditionalReconciliationRow()])
    setReconciliationError('')
  }

  const handleRemoveReconciliationRow = (rowId: string) => {
    setReconciliationRows((prev) => prev.filter((row) => row.id !== rowId))
    setReconciliationError('')
  }

  const getVarianceQty = (plannedQty: number, actualQtyText: string) => {
    const parsed = parseDotDecimal(actualQtyText)
    if (!parsed.valid) return null
    return parsed.value - plannedQty
  }

  const handleSubmitReconciliation = async () => {
    if (!reconciliationGroup) return

    const groupKey = getGroupKey(reconciliationGroup)
    const menuProductionIds = reconciliationGroup.items
      .map((item) => item.id)
      .filter(Boolean)

    if (menuProductionIds.length === 0) {
      setReconciliationError('Menu production data is missing for this batch.')
      return
    }

    if (reconciliationRows.length === 0) {
      setReconciliationError('No planned raw materials available to reconcile.')
      return
    }

    const payloadItems = []
    const seenKeys = new Set<string>()
    for (const row of reconciliationRows) {
      const productCode = row.productCode.trim()
      const name = row.name.trim()
      const unitOfMeasures = row.unitOfMeasures.trim()
      const fieldLabel = productCode || name

      if (row.isAdditional) {
        if (!productCode || !name || !unitOfMeasures) {
          setReconciliationError(
            'Additional ingredient rows must include product code, ingredient name, and unit.',
          )
          return
        }
      }

      const itemKey = buildReconciliationItemKey(
        productCode,
        name,
        unitOfMeasures,
        row.vendor,
        row.vendorSite,
      )
      if (!itemKey) {
        setReconciliationError(
          `Ingredient identity is incomplete for ${fieldLabel || 'an issuance row'}.`,
        )
        return
      }
      if (seenKeys.has(itemKey)) {
        setReconciliationError(
          `Duplicate ingredient found in actual issuance for ${fieldLabel}.`,
        )
        return
      }
      seenKeys.add(itemKey)

      const actualQtyText = row.actualQty.trim()
      if (!actualQtyText) {
        setReconciliationError(
          `Actual qty is required for ${fieldLabel || 'an ingredient'}.`,
        )
        return
      }

      const parsedActualQty = parseDotDecimal(actualQtyText)
      if (!parsedActualQty.valid) {
        if (parsedActualQty.reason === 'comma') {
          setReconciliationError(
            `Use dot decimal format for ${fieldLabel}, for example 0.5.`,
          )
          return
        }
        setReconciliationError(
          `Actual qty for ${fieldLabel} must be a valid number using dot decimals, for example 0.5.`,
        )
        return
      }

      const actualQty = parsedActualQty.value
      if (row.isAdditional && actualQty <= 0) {
        setReconciliationError(
          `Actual qty for added ingredient ${fieldLabel} must be greater than 0.`,
        )
        return
      }
      const actualPriceText = row.actualPrice.trim()
      let actualPrice: number | undefined
      if (actualPriceText) {
        const parsedActualPrice = parseDotDecimal(actualPriceText)
        if (!parsedActualPrice.valid) {
          if (parsedActualPrice.reason === 'comma') {
            setReconciliationError(
              `Use dot decimal format for actual price of ${fieldLabel}, for example 12500.5.`,
            )
            return
          }
          setReconciliationError(
            `Actual price for ${fieldLabel} must be a valid number using dot decimals, for example 12500.5.`,
          )
          return
        }
        actualPrice = parsedActualPrice.value
      }

      const reason = row.reason.trim()
      if (
        (quantitiesDiffer(actualQty, row.plannedQty) ||
          (actualPrice !== undefined &&
            row.plannedPrice !== undefined &&
            quantitiesDiffer(actualPrice, row.plannedPrice))) &&
        !reason
      ) {
        setReconciliationError(
          `Reason is required when actual qty or actual price differs for ${fieldLabel}.`,
        )
        return
      }

      payloadItems.push({
        productCode,
        name,
        unitOfMeasures,
        vendor: row.vendor,
        vendorSite: row.vendorSite,
        actualQty,
        ...(actualPrice !== undefined ? { actualPrice } : {}),
        reason: reason || undefined,
      })
    }

    setReconciliationError('')
    setLoadError('')
    setProcessingGroupKey(groupKey)
    try {
      await fulfillStoreRequestBatch({
        menuProductionIds,
        items: payloadItems,
        note: reconciliationNote.trim() || undefined,
      })
      await clearStoreRequestNotification(reconciliationGroup.productionCode)
      const label = reconciliationGroup.productionCode
        ? `${reconciliationGroup.date} (${reconciliationGroup.productionCode})`
        : reconciliationGroup.date
      setActionMessage(`Ingredient issuance for ${label} completed.`)
      await fetchStoreRequests()
      setExpandedGroups((prev) => prev.filter((item) => item !== groupKey))
      setReconciliationGroup(null)
      setReconciliationRows([])
      setReconciliationNote('')
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to complete ingredient issuance.'
      setReconciliationError(message)
      if (
        message.toLowerCase().includes('already completed') ||
        message.toLowerCase().includes('already processed') ||
        message.toLowerCase().includes('already completed or cancelled')
      ) {
        await fetchStoreRequests()
        setExpandedGroups((prev) => prev.filter((item) => item !== groupKey))
      }
    } finally {
      setProcessingGroupKey(null)
    }
  }

  const handleSubmitCancellation = async () => {
    if (!cancellationGroup || !cancellationMenu) return

    const reason = cancellationReason.trim()
    if (!reason) {
      setCancellationError('Cancellation reason is required.')
      return
    }

    const groupKey = getGroupKey(cancellationGroup)
    const menuProductionIds = cancellationMenu.id ? [cancellationMenu.id] : []

    if (menuProductionIds.length === 0) {
      setCancellationError('Menu production data is missing for this menu.')
      return
    }

    setCancellationError('')
    setLoadError('')
    setProcessingGroupKey(groupKey)
    try {
      await cancelStoreRequestBatch({
        menuProductionIds,
        reason,
      })
      await clearStoreRequestNotification(cancellationGroup.productionCode)
      setActionMessage(`Store request for ${cancellationMenu.menuName} cancelled.`)
      await fetchStoreRequests()
      setExpandedGroups((prev) => prev.filter((item) => item !== groupKey))
      setCancellationGroup(null)
      setCancellationMenu(null)
      setCancellationReason('')
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to cancel store request.'
      setCancellationError(message)
    } finally {
      setProcessingGroupKey(null)
    }
  }

  const totalPages = Math.max(1, Math.ceil(filteredGroups.length / ITEMS_PER_PAGE))
  const paginatedGroups = filteredGroups.slice(
    (page - 1) * ITEMS_PER_PAGE,
    page * ITEMS_PER_PAGE,
  )

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Store Request</h1>
          <button
            type="button"
            onClick={openBulkExportModal}
            disabled={loading}
            className="rounded-md border border-success bg-white px-4 py-2 text-xs font-semibold text-success shadow-sm hover:bg-success/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="flex items-center gap-2">
              <i className="bi bi-download text-sm" aria-hidden="true" />
              <span>Bulk Export</span>
            </span>
          </button>
        </div>
        <p className="text-sm text-muted">
          This data is auto-added after Unit Manager approval.
        </p>
        <div className="relative">
          <div className="flex flex-wrap items-center gap-2 pt-2">
          <button
            type="button"
            onClick={() => setActiveDateFilter((prev) => (prev === 'created' ? null : 'created'))}
            className={`rounded-md border px-3 py-2 text-xs font-semibold shadow-sm ${
              activeDateFilter === 'created'
                ? 'border-accent-blue bg-accent-blue text-white'
                : 'border-border bg-white text-primary hover:bg-background'
            }`}
          >
            <i className="bi bi-funnel mr-2" aria-hidden="true" />
            Created Date
          </button>
          <button
            type="button"
            onClick={() => setActiveDateFilter((prev) => (prev === 'production' ? null : 'production'))}
            className={`rounded-md border px-3 py-2 text-xs font-semibold shadow-sm ${
              activeDateFilter === 'production'
                ? 'border-accent-blue bg-accent-blue text-white'
                : 'border-border bg-white text-primary hover:bg-background'
            }`}
          >
            <i className="bi bi-funnel mr-2" aria-hidden="true" />
            Production Date
          </button>
          </div>
          {activeDateFilter ? (
            <div
              className="absolute left-0 top-full z-[110] mt-2 w-full max-w-2xl rounded-md border border-border bg-white p-4 shadow-[0_12px_36px_rgba(15,23,42,0.18)]"
              role="dialog"
              aria-label={`${activeDateFilter === 'created' ? 'Created' : 'Production'} date filter`}
            >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor={`${activeDateFilter}-filter-start-date`}
                  className="text-xs font-medium text-foreground"
                >
                  Start date
                </label>
                <input
                  id={`${activeDateFilter}-filter-start-date`}
                  type="date"
                  value={
                    activeDateFilter === 'created'
                      ? createdFilterStartDate
                      : productionFilterStartDate
                  }
                  max={
                    activeDateFilter === 'created'
                      ? createdFilterEndDate || undefined
                      : productionFilterEndDate || undefined
                  }
                  onChange={(event) => {
                    if (activeDateFilter === 'created') {
                      setCreatedFilterStartDate(event.target.value)
                    } else {
                      setProductionFilterStartDate(event.target.value)
                    }
                    setPage(1)
                  }}
                  className="mt-2 w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                />
              </div>
              <div>
                <label
                  htmlFor={`${activeDateFilter}-filter-end-date`}
                  className="text-xs font-medium text-foreground"
                >
                  End date
                </label>
                <input
                  id={`${activeDateFilter}-filter-end-date`}
                  type="date"
                  value={
                    activeDateFilter === 'created'
                      ? createdFilterEndDate
                      : productionFilterEndDate
                  }
                  min={
                    activeDateFilter === 'created'
                      ? createdFilterStartDate || undefined
                      : productionFilterStartDate || undefined
                  }
                  onChange={(event) => {
                    if (activeDateFilter === 'created') {
                      setCreatedFilterEndDate(event.target.value)
                    } else {
                      setProductionFilterEndDate(event.target.value)
                    }
                    setPage(1)
                  }}
                  className="mt-2 w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                />
              </div>
            </div>
            <div className="mt-4 max-w-sm">
              <label
                htmlFor={`${activeDateFilter}-sort-order`}
                className="text-xs font-medium text-foreground"
              >
                Sort by
              </label>
              <select
                id={`${activeDateFilter}-sort-order`}
                value={
                  activeDateFilter === 'created'
                    ? createdSortOrder
                    : productionSortOrder
                }
                onChange={(event) => {
                  const value = event.target.value as DateSortOrder
                  if (activeDateFilter === 'created') {
                    setCreatedSortOrder(value)
                    setProductionSortOrder('none')
                  } else {
                    setProductionSortOrder(value)
                    setCreatedSortOrder('none')
                  }
                  setPage(1)
                }}
                className="mt-2 w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
              >
                <option value="none">No sorting</option>
                <option value="desc">Newest to oldest</option>
                <option value="asc">Oldest to newest</option>
              </select>
            </div>
            <button
              type="button"
              onClick={() => {
                if (activeDateFilter === 'created') {
                  setCreatedFilterStartDate('')
                  setCreatedFilterEndDate('')
                } else {
                  setProductionFilterStartDate('')
                  setProductionFilterEndDate('')
                }
                setPage(1)
              }}
              className="mt-3 rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-primary"
            >
              Clear filter
            </button>
            </div>
          ) : null}
        </div>
        {loadError ? (
          <p className="text-xs font-medium text-red-600">{loadError}</p>
        ) : null}
        {actionMessage ? (
          <p className="text-xs font-medium text-primary">{actionMessage}</p>
        ) : null}
      </div>

      <div className="rounded-md border border-border bg-surface shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-t-md border-b border-border bg-white px-5 py-4 text-xs">
          <span className="text-muted">
            Showing {paginatedGroups.length} of {filteredGroups.length} production batches
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
                <th className="w-16 px-3 py-1.5 font-semibold">No</th>
                <th className="px-3 py-1.5 font-semibold">Created Date</th>
                <th className="px-3 py-1.5 font-semibold">Production date</th>
                <th className="px-3 py-1.5 font-semibold">Production code</th>
                <th className="px-3 py-1.5 font-semibold">Store request status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr className="border-t border-border">
                  <td colSpan={5} className="px-5 py-10 text-center text-muted">
                    Loading store requests...
                  </td>
                </tr>
              ) : filteredGroups.length === 0 ? (
                <tr className="border-t border-border">
                  <td colSpan={5} className="px-5 py-10 text-center text-muted">
                    {groups.length === 0
                      ? 'No production menus in store request yet.'
                      : 'No production menus match the selected filters.'}
                  </td>
                </tr>
              ) : (
                paginatedGroups.map((group, index) => {
                  const groupKey = getGroupKey(group)
                  const isExpanded = expandedGroups.includes(groupKey)
                  const summaryItems = aggregateStoreRequestSummary(
                    group.summary ?? [],
                  )

                  return (
                    <Fragment key={groupKey}>
                      <tr
                        className="cursor-pointer border-t border-border"
                        onClick={() => toggleExpanded(groupKey)}
                      >
                        <td className="px-3 py-1.5 text-sm text-muted">
                          {(page - 1) * ITEMS_PER_PAGE + index + 1}
                        </td>
                        <td className="px-3 py-1.5 text-sm text-muted">
                          {formatCreatedDate(
                            group.items.find((item) => item.approvedAt)?.approvedAt,
                          )}
                        </td>
                        <td className="px-3 py-1.5">{group.date}</td>
                        <td className="px-3 py-1.5 text-xs text-muted">
                          {group.productionCode ?? '-'}
                        </td>
                        <td className="px-3 py-1.5">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-2 text-sm">
                              <span>Requested</span>
                              <span className="rounded-full bg-primary-soft px-2 py-1 text-xs font-semibold text-primary">
                                {group.items.length} menus
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                toggleExpanded(groupKey)
                              }}
                              className="rounded-md border border-primary bg-primary-soft px-3 py-1 text-xs font-semibold text-primary hover:bg-primary-soft/80"
                            >
                              {isExpanded ? 'Hide details' : 'View details'}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded ? (
                        <tr className="border-t border-border bg-background">
                          <td colSpan={5} className="px-4 py-4">
                            <div className="space-y-6">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                  <p className="text-xs text-muted">
                                    Request details
                                  </p>
                                  <p className="mt-2 text-sm text-muted">
                                    Production date: {group.date}
                                  </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleExportMenusByDate(group)}
                                    className="rounded-md border border-success bg-white px-4 py-2 text-xs font-semibold text-success shadow-sm hover:bg-success/10"
                                  >
                                    <span className="flex items-center gap-2">
                                      <i className="bi bi-download text-sm" aria-hidden="true" />
                                      <span>Export</span>
                                    </span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openReconciliationModal(group)}
                                    disabled={
                                      processingGroupKey === groupKey ||
                                      group.items.length === 0 ||
                                      summaryItems.length === 0
                                    }
                                    className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    {processingGroupKey === groupKey
                                      ? 'Completing...'
                                      : 'Complete with actual qty'}
                                  </button>
                                </div>
                              </div>

                              <div className="space-y-4">
                                <div className="rounded-md border border-border bg-surface p-4">
                                  <p className="text-xs text-muted">
                                    Menu list
                                  </p>
                                  <div className="mt-3 max-w-full overflow-x-auto rounded-md border border-border bg-white">
                                    <table className="dm-table min-w-full text-sm">
                                      <thead className="bg-background">
                                        <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                                          <th className="w-12 px-3 py-1.5 font-semibold">
                                            No
                                          </th>
                                          <th className="px-3 py-1.5 font-semibold">
                                            Menu ID
                                          </th>
                                          <th className="px-3 py-1.5 font-semibold">
                                            Menu
                                          </th>
                                          <th className="px-3 py-1.5 font-semibold">
                                            Category
                                          </th>
                                          <th className="px-3 py-1.5 font-semibold">
                                            Portion
                                          </th>
                                          <th className="px-3 py-1.5 font-semibold">
                                            Action
                                          </th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {group.items.map((menu, idx) => (
                                            <tr
                                              key={menu.id}
                                              className="border-t border-border"
                                            >
                                              <td className="px-3 py-1.5 text-sm text-muted">
                                                {idx + 1}
                                              </td>
                                              <td className="px-3 py-1.5 font-medium">
                                                {menu.recipeCode ?? '-'}
                                              </td>
                                              <td className="px-3 py-1.5">
                                                {menu.menuName}
                                              </td>
                                              <td className="px-3 py-1.5">
                                                {menu.category}
                                              </td>
                                              <td className="px-3 py-1.5">
                                                {menu.portion}
                                              </td>
                                              <td className="px-3 py-1.5">
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    openCancellationModal(
                                                      group,
                                                      menu,
                                                    )
                                                  }
                                                  disabled={
                                                    processingGroupKey ===
                                                    groupKey
                                                  }
                                                  className="rounded-md border border-danger bg-white px-3 py-1 text-xs font-semibold text-danger hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-60"
                                                >
                                                  {processingGroupKey === groupKey
                                                    ? 'Cancelling...'
                                                    : 'Cancel request'}
                                                </button>
                                              </td>
                                            </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                  {group.missingRecipes.length > 0 ? (
                                    <p className="mt-3 text-xs text-danger">
                                      Recipe not found for:{' '}
                                      {group.missingRecipes.join(', ')}
                                    </p>
                                  ) : null}
                                </div>

                                <div className="rounded-md border border-border bg-surface p-4">
                                  <p className="text-xs text-muted">
                                    Ingredient summary
                                  </p>
                                  <div className="mt-3 max-w-full overflow-x-auto rounded-md border border-border bg-white">
                                    <table className="dm-table min-w-full text-sm">
                                      <thead className="bg-background">
                                        <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                                          <th className="w-12 px-3 py-1.5 font-semibold">
                                            No
                                          </th>
                                          <th className="px-3 py-1.5 font-semibold">
                                            Product code
                                          </th>
                                          <th className="px-3 py-1.5 font-semibold">
                                            Ingredient name
                                          </th>
                                          <th className="px-3 py-1.5 font-semibold">
                                            Qty
                                          </th>
                                          <th className="px-3 py-1.5 font-semibold">
                                            Unit
                                          </th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {summaryItems.length === 0 ? (
                                          <tr className="border-t border-border">
                                            <td
                                              colSpan={5}
                                              className="px-4 py-6 text-center text-muted"
                                            >
                                              No ingredients available to
                                              calculate.
                                            </td>
                                          </tr>
                                        ) : (
                                          summaryItems.map((item, idx) => (
                                            <tr
                                              key={`${item.productCode}-${item.unitOfMeasures}-${idx}`}
                                              className="border-t border-border"
                                            >
                                              <td className="px-3 py-1.5 text-sm text-muted">
                                                {idx + 1}
                                              </td>
                                              <td className="px-3 py-1.5">
                                                {item.productCode}
                                              </td>
                                              <td className="px-3 py-1.5">
                                                {item.name}
                                              </td>
                                              <td className="px-3 py-1.5">
                                                {formatQuantity(item.qty)}
                                              </td>
                                              <td className="px-3 py-1.5">
                                                {formatUnitLabel(
                                                  item.unitOfMeasures,
                                                )}
                                              </td>
                                            </tr>
                                          ))
                                        )}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
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
                aria-labelledby="storekeeper-bulk-export-title"
                onSubmit={(event) => {
                  event.preventDefault()
                  handleBulkExport().catch(() => null)
                }}
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-6 py-5">
                  <div>
                    <p className="text-xs text-muted">Store Request Export</p>
                    <h3
                      id="storekeeper-bulk-export-title"
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
                      <label htmlFor="storekeeper-bulk-export-start-date" className="text-sm font-medium text-foreground">
                        Start date
                      </label>
                      <input
                        id="storekeeper-bulk-export-start-date"
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
                      <label htmlFor="storekeeper-bulk-export-end-date" className="text-sm font-medium text-foreground">
                        End date
                      </label>
                      <input
                        id="storekeeper-bulk-export-end-date"
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
                    <p className="text-xs font-medium text-red-600">{bulkExportError}</p>
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
                      Use this when the warehouse cannot fulfill the request.
                      A reason is required before this menu can be cancelled.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeCancellationModal}
                    disabled={Boolean(processingGroupKey)}
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
                      placeholder="Explain why the store request must be cancelled, for example stock is unavailable in warehouse."
                      className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                    />
                    <p className="mt-2 text-xs text-muted">
                      This reason will be recorded in Storekeeper, Unit Manager,
                      and Chef pages.
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
                    disabled={Boolean(processingGroupKey)}
                    className="rounded-md border border-border bg-background px-4 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmitCancellation}
                    disabled={Boolean(processingGroupKey)}
                    className="rounded-md bg-danger px-4 py-2 text-xs font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {processingGroupKey ? 'Cancelling...' : 'Confirm cancel'}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {reconciliationGroup && typeof document !== 'undefined'
        ? createPortal(
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/20 px-4 py-2 backdrop-blur-sm sm:p-4">
          <div
            className="flex max-h-[96vh] w-full max-w-6xl flex-col overflow-hidden rounded-md border border-border bg-surface shadow-[0_12px_36px_rgba(15,23,42,0.12)]"
            role="dialog"
            aria-modal="true"
          >
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-6 py-5">
              <div>
                <p className="text-xs text-muted">Confirm Raw Material Delivery</p>
                <h3 className="mt-1 text-lg font-semibold text-foreground">
                  {reconciliationGroup.productionCode
                    ? `${reconciliationGroup.date} (${reconciliationGroup.productionCode})`
                    : reconciliationGroup.date}
                </h3>
                <p className="mt-2 text-sm text-muted">
                  Compare planned quantities with actual raw materials delivered
                  to kitchen.
                </p>
              </div>
              <button
                type="button"
                onClick={closeReconciliationModal}
                disabled={Boolean(processingGroupKey)}
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
                    {reconciliationGroup.date}
                  </p>
                </div>
                <div className="rounded-md border border-border bg-white p-4">
                  <p className="text-xs text-muted">Production code</p>
                  <p className="mt-2 text-sm font-medium text-foreground">
                    {reconciliationGroup.productionCode ?? '-'}
                  </p>
                </div>
                <div className="rounded-md border border-border bg-white p-4">
                  <p className="text-xs text-muted">Menus in batch</p>
                  <p className="mt-2 text-sm font-medium text-foreground">
                    {reconciliationGroup.items.length}
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
                      {reconciliationGroup.items.map((menu, index) => (
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
                    Actual qty is prefilled from planned qty and can still be
                    edited manually. Use dot decimal format like `0.5`.
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    Add an ingredient row when the planned ingredient is unavailable
                    and you need a substitute from the warehouse.
                  </p>
                </div>

                <div className="mt-4 max-w-full overflow-x-auto rounded-md border border-border bg-white">
                  <table className="dm-table min-w-full text-sm">
                    <thead className="bg-background">
                      <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                        <th className="w-12 px-3 py-1.5 font-semibold">No</th>
                        <th className="px-3 py-1.5 font-semibold">Product code</th>
                        <th className="px-3 py-1.5 font-semibold">Ingredient</th>
                        <th className="px-3 py-1.5 font-semibold">Planned qty</th>
                        <th className="px-3 py-1.5 font-semibold">Actual qty</th>
                        <th className="px-3 py-1.5 font-semibold">Variance</th>
                        <th className="px-3 py-1.5 font-semibold">Unit</th>
                        <th className="min-w-[220px] px-3 py-1.5 font-semibold">
                          Reason
                        </th>
                        <th className="w-24 px-3 py-1.5 font-semibold">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reconciliationRows.map((row, index) => {
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
                          <tr
                            key={row.id}
                            className="border-t border-border"
                          >
                            <td className="px-3 py-1.5 text-sm text-muted">
                              {index + 1}
                            </td>
                            <td className="px-3 py-1.5">
                              {row.isAdditional ? (
                                <input
                                  type="text"
                                  value={row.productCode}
                                  onChange={(event) =>
                                    updateReconciliationRow(
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
                                    updateReconciliationRow(
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
                                  updateReconciliationRow(
                                    row.id,
                                    'actualQty',
                                    event.target.value,
                                  )
                                }
                                placeholder="0"
                                className="w-28 rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                              />
                            </td>
                            <td className={`px-3 py-1.5 font-medium ${varianceClass}`}>
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
                                    updateReconciliationRow(
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
                                  updateReconciliationRow(
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
                                  onClick={() => handleRemoveReconciliationRow(row.id)}
                                  disabled={Boolean(processingGroupKey)}
                                  className="rounded-md border border-danger bg-white px-3 py-2 text-xs font-semibold text-danger hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  Remove
                                </button>
                              ) : (
                                <span className="text-xs text-muted">Planned</span>
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
                              onClick={handleAddReconciliationRow}
                              disabled={Boolean(processingGroupKey)}
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
                    value={reconciliationNote}
                    onChange={(event) => setReconciliationNote(event.target.value)}
                    rows={3}
                    placeholder="Optional note for this delivery batch"
                    className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                  />
                </div>

                {reconciliationError ? (
                  <p className="mt-4 text-xs font-medium text-red-600">
                    {reconciliationError}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border px-6 py-4">
              <button
                type="button"
                onClick={closeReconciliationModal}
                disabled={Boolean(processingGroupKey)}
                className="rounded-md border border-border bg-background px-4 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmitReconciliation}
                disabled={Boolean(processingGroupKey)}
                className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
              >
                {processingGroupKey ? 'Completing...' : 'Complete & send to kitchen'}
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

export default StorekeeperPage
