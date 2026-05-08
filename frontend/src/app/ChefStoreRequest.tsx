import { Fragment, useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useChefData } from '../lib/chef-data'
import { formatQuantity, formatSignedQuantity, quantitiesDiffer } from '../lib/quantity'
import { aggregateStoreRequestSummary } from '../lib/store-request-summary'
import { getApprovalStatusLabel, getStoreRequestStatusLabel } from '../lib/status-labels'
import { formatUnitLabel } from '../lib/unit-of-measures'

type StoreRequestIngredient = {
  productCode: string
  name: string
  unitOfMeasures: string
  qty: number
}

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
  recipeId?: string
  recipeCode?: string
  menuName: string
  category: string
  portion: number
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

type StoreRequestSiteOption = {
  code: string
  name: string
}

type ChefStoreRequestProps = {
  requireSiteSelection?: boolean
  siteOptions?: StoreRequestSiteOption[]
  enableStoreRequestCancellation?: boolean
  enableStoreRequestCompletion?: boolean
  actionMode?: 'buttons' | 'select'
}

const getStoreRequestGroupKey = (group: {
  date: string
  productionCode?: string
}) => `${group.date}__${group.productionCode ?? 'no-code'}`

const mergeStoreRequestGroups = (groups: StoreRequestGroup[]) => {
  const groupedByBatch = new Map<
    string,
    {
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

const xmlEscape = (value: unknown) => {
  const text = value === null || value === undefined ? '' : String(value)
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

const sanitizeWorksheetName = (value: string) => {
  const cleaned = value.replace(/[\\/:*?[\]]/g, '-')
  return cleaned.length > 31 ? cleaned.slice(0, 31) : cleaned
}

const buildWorksheetXml = (sheetName: string, rows: Array<Array<unknown>>) => {
  const safeName = sanitizeWorksheetName(sheetName)
  const rowXml = rows
    .map((row, index) => {
      const rowStyle = index === 0 ? ' ss:StyleID="Header"' : ''
      const cells = row
        .map((cell) => {
          const isNumber = typeof cell === 'number' && Number.isFinite(cell)
          const type = isNumber ? 'Number' : 'String'
          const value = isNumber ? String(cell) : xmlEscape(cell)
          return `<Cell><Data ss:Type="${type}">${value}</Data></Cell>`
        })
        .join('')
      return `<Row${rowStyle}>${cells}</Row>`
    })
    .join('')

  return `<Worksheet ss:Name="${xmlEscape(safeName)}">
  <Table>${rowXml}</Table>
 </Worksheet>`
}

const buildWorkbookXml = (
  sheets: Array<{ name: string; rows: Array<Array<unknown>> }>,
) => {
  const worksheetsXml = sheets
    .map((sheet) => buildWorksheetXml(sheet.name, sheet.rows))
    .join('')

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Header">
   <Font ss:Bold="1"/>
   <Interior ss:Color="#D9E1F2" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
  </Style>
 </Styles>
 ${worksheetsXml}
</Workbook>`
}

const downloadExcel = (
  filename: string,
  sheets: Array<{ name: string; rows: Array<Array<unknown>> }>,
) => {
  const xml = buildWorkbookXml(sheets)
  const blob = new Blob([xml], {
    type: 'application/vnd.ms-excel;charset=utf-8;',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

const ChefStoreRequest = ({
  requireSiteSelection = false,
  siteOptions = [],
  enableStoreRequestCancellation = false,
  enableStoreRequestCompletion = false,
  actionMode = 'buttons',
}: ChefStoreRequestProps = {}) => {
  const { accessToken } = useAuth()
  const {
    cancelPendingMenuProductionBatch,
    cancelStoreRequestBatch,
    fulfillStoreRequestBatch,
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

  const handleExportMenusByDate = (group: StoreRequestGroup) => {
    const rows: Array<Array<unknown>> = [
      [
        'No',
        'Production Date',
        'Production Code',
        'Menu Name',
        'Recipe Code',
        'Category',
        'Portion',
        'IT Code',
        'Ingredient Name',
        'QTY',
        'Unit',
      ],
    ]

    let rowNumber = 1
    group.items.forEach((menu) => {
      const ingredients = menu.ingredients ?? []
      if (ingredients.length === 0) {
        rows.push([
          rowNumber,
          group.date,
          group.productionCode ?? '',
          menu.menuName,
          menu.recipeCode ?? menu.recipeId ?? '',
          menu.category,
          menu.portion,
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
          group.date,
          group.productionCode ?? '',
          menu.menuName,
          menu.recipeCode ?? menu.recipeId ?? '',
          menu.category,
          menu.portion,
          ingredient.productCode,
          ingredient.name,
          formatQuantity(ingredient.qty),
          formatUnitLabel(ingredient.unitOfMeasures),
        ])
        rowNumber += 1
      })
    })

    const summaryRows: Array<Array<unknown>> = [
      ['IT Code', 'Ingredient Name', 'QTY', 'Unit'],
      ...aggregateStoreRequestSummary(group.summary ?? []).map((item) => [
        item.productCode,
        item.name,
        formatQuantity(item.qty),
        formatUnitLabel(item.unitOfMeasures),
      ]),
    ]

    const safeDate = group.date.replace(/[\\/:*?"<>|]/g, '-')
    const safeProductionCode = (group.productionCode ?? 'no-code').replace(
      /[\\/:*?"<>|]/g,
      '-',
    )
    downloadExcel(`store-request-${safeDate}-${safeProductionCode}.xls`, [
      { name: 'Store Request', rows },
      { name: 'Ingredient Summary', rows: summaryRows },
    ])
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
  }, [fetchStoreRequests])

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
        <h1 className="text-2xl font-semibold">Store Request</h1>
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
                <th className="px-5 py-4 font-semibold">Production date</th>
                <th className="px-5 py-4 font-semibold">Production code</th>
                <th className="px-5 py-4 font-semibold">Reviewed by</th>
                <th className="px-5 py-4 font-semibold">Total menu</th>
                <th className="px-5 py-4 font-semibold">Storekeeper</th>
                <th className="px-5 py-4 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr className="border-t border-border">
                  <td colSpan={7} className="px-5 py-10 text-center text-muted">
                    Loading store requests...
                  </td>
                </tr>
              ) : groups.length === 0 ? (
                <tr className="border-t border-border">
                  <td colSpan={7} className="px-5 py-10 text-center text-muted">
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
                      <td className="px-5 py-4">{date}</td>
                      <td className="px-5 py-4 text-xs text-muted">
                        {group.productionCode ?? '-'}
                      </td>
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
                            className="rounded-md border border-border bg-background px-3 py-1 text-xs font-semibold text-foreground hover:bg-white"
                          >
                            {isExpanded ? 'Hide details' : 'View details'}
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
                        <td colSpan={7} className="px-5 py-5">
                          <div className="space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-xs font-bold text-muted">
                                  Menu details
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
                              </div>
                            </div>

                            {items.map((menu) => {
                              const ingredients = menu.ingredients ?? []
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
                                  className="rounded-md border border-border bg-background px-4 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
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
                  <button
                    type="button"
                    onClick={closeCompletionModal}
                    disabled={Boolean(cancellingGroupKey)}
                    className="rounded-md border border-border bg-background px-4 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmitCompletion}
                    disabled={Boolean(cancellingGroupKey)}
                    className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {cancellingGroupKey ? 'Saving...' : 'Save actual qty'}
                  </button>
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

