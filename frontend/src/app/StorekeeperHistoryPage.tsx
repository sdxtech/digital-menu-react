import { Fragment, useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { formatQuantity, formatSignedQuantity } from '../lib/quantity'
import { formatRecipeVersion } from '../lib/recipe-version'
import { getStoreRequestStatusLabel } from '../lib/status-labels'
import { formatUnitLabel } from '../lib/unit-of-measures'
import { useAuth } from '../lib/auth'

type StoreRequestIngredient = {
  productCode: string
  name: string
  unitOfMeasures: string
  qty: number
}

type StoreFulfillmentIngredient = {
  productCode: string
  name: string
  unitOfMeasures: string
  plannedQty: number
  actualQty: number
  varianceQty: number
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
  menuName: string
  category: string
  portion: number
  productionDate?: string
  storeRequestStatus?: 'not-requested' | 'requested' | 'fulfilled' | 'cancelled'
  ingredients?: StoreRequestIngredient[]
  fulfilledBy?: string
  fulfilledAt?: string
  cancelledBy?: string
  cancelledAt?: string
  cancellationReason?: string
}

type StoreRequestGroup = {
  date: string
  productionCode?: string
  items: StoreRequestMenu[]
  summary: StoreRequestIngredient[]
  missingRecipes: string[]
  fulfillment?: StoreRequestFulfillment
}

const ITEMS_PER_PAGE = 10

const getHistoryGroupKey = (group: { date: string; productionCode?: string }) =>
  `${group.date}__${group.productionCode ?? 'no-code'}`

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

const buildWorkbookXml = (sheetName: string, rows: Array<Array<unknown>>) => {
  const worksheetXml = buildWorksheetXml(sheetName, rows)

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
 ${worksheetXml}
</Workbook>`
}

const downloadExcel = (
  filename: string,
  sheetName: string,
  rows: Array<Array<unknown>>,
) => {
  const xml = buildWorkbookXml(sheetName, rows)
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

const buildHistoryIngredientKey = (
  productCode: string,
  name: string,
  unitOfMeasures: string,
) => {
  const normalizedCode = productCode.trim().toLowerCase()
  if (normalizedCode) return normalizedCode

  const normalizedName = name.trim().toLowerCase()
  const normalizedUnit = unitOfMeasures.trim().toLowerCase()
  if (!normalizedName) return ''
  return `${normalizedName}__${normalizedUnit}`
}

const StorekeeperHistoryPage = () => {
  const { accessToken } = useAuth()
  const [loadError, setLoadError] = useState('')
  const [groups, setGroups] = useState<StoreRequestGroup[]>([])
  const [expandedGroups, setExpandedGroups] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)

  const fetchHistory = useCallback(async () => {
    if (!accessToken) {
      setLoadError('Please log in first to load history.')
      return
    }

    setLoading(true)
    setLoadError('')
    try {
      const [fulfilledData, cancelledData] = await Promise.all([
        apiFetch<{ items: StoreRequestGroup[] }>(
          '/menu-productions/store-requests?storeRequestStatus=fulfilled&approvalStatus=approved',
          undefined,
          accessToken,
        ),
        apiFetch<{ items: StoreRequestGroup[] }>(
          '/menu-productions/store-requests?storeRequestStatus=cancelled&approvalStatus=approved',
          undefined,
          accessToken,
        ),
      ])
      const sorted = [
        ...(fulfilledData.items ?? []),
        ...(cancelledData.items ?? []),
      ].sort((a, b) =>
        b.date.localeCompare(a.date),
      )
      setGroups(sorted)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to load data.'
      setLoadError(message)
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  useEffect(() => {
    fetchHistory().catch(() => null)
  }, [fetchHistory])

  useEffect(() => {
    const nextTotalPages = Math.max(
      1,
      Math.ceil(groups.length / ITEMS_PER_PAGE),
    )
    setPage((prev) => Math.min(prev, nextTotalPages))
  }, [groups.length])

  const toggleExpanded = (groupKey: string) => {
    setExpandedGroups((prev) =>
      prev.includes(groupKey)
        ? prev.filter((item) => item !== groupKey)
        : [...prev, groupKey],
    )
  }

  const getCompletedByNames = (group: StoreRequestGroup) =>
    group.fulfillment?.completedBy?.trim()
      ? [group.fulfillment.completedBy.trim()]
      : Array.from(
          new Set(
            group.items
              .map((item) =>
                item.fulfilledBy?.trim() || item.cancelledBy?.trim(),
              )
              .filter((value): value is string => Boolean(value)),
          ),
        )

  const handleExportHistoryGroup = (group: StoreRequestGroup) => {
    const completedByLabel = getCompletedByNames(group).join(', ')
    const completedAtLabel = group.fulfillment?.completedAt
      ? new Date(group.fulfillment.completedAt).toLocaleString()
      : ''
    const resolutionStatus =
      group.fulfillment?.status ??
      (group.items.some((item) => item.storeRequestStatus === 'cancelled')
        ? 'cancelled'
        : 'fulfilled')
    const groupStatus = getStoreRequestStatusLabel(resolutionStatus)

    const fulfillmentMap = new Map<string, StoreFulfillmentIngredient>()
    ;(group.fulfillment?.items ?? []).forEach((item) => {
      const key = buildHistoryIngredientKey(
        item.productCode,
        item.name,
        item.unitOfMeasures,
      )
      if (!key) return

      const plannedQty = Number.isFinite(item.plannedQty) ? item.plannedQty : 0
      const actualQty = Number.isFinite(item.actualQty) ? item.actualQty : 0
      const varianceQty = Number.isFinite(item.varianceQty) ? item.varianceQty : 0
      const plannedPrice = Number.isFinite(Number(item.plannedPrice))
        ? Number(item.plannedPrice)
        : undefined
      const actualPrice = Number.isFinite(Number(item.actualPrice))
        ? Number(item.actualPrice)
        : undefined
      const variancePrice = Number.isFinite(Number(item.variancePrice))
        ? Number(item.variancePrice)
        : undefined
      const existing = fulfillmentMap.get(key)

      if (existing) {
        existing.plannedQty += plannedQty
        existing.actualQty += actualQty
        existing.varianceQty += varianceQty
        if (plannedPrice !== undefined) existing.plannedPrice = plannedPrice
        if (actualPrice !== undefined) existing.actualPrice = actualPrice
        if (variancePrice !== undefined) existing.variancePrice = variancePrice
        if (!existing.reason && item.reason?.trim()) existing.reason = item.reason
        if (!existing.productCode && item.productCode) {
          existing.productCode = item.productCode
        }
        if (!existing.name && item.name) existing.name = item.name
        if (!existing.unitOfMeasures && item.unitOfMeasures) {
          existing.unitOfMeasures = item.unitOfMeasures
        }
        return
      }

      fulfillmentMap.set(key, {
        productCode: item.productCode,
        name: item.name,
        unitOfMeasures: item.unitOfMeasures,
        plannedQty,
        actualQty,
        varianceQty,
        plannedPrice,
        actualPrice,
        variancePrice,
        reason: item.reason,
      })
    })

    const rows: Array<Array<unknown>> = [
      [
        'No',
        'Production Date',
        'Production Code',
        'Menu Name',
        'Version',
        'Recipe Code',
        'Category',
        'Store Request Status',
        'Portions',
        'Product Code',
        'Ingredient Name',
        'Planned Qty',
        'Actual Qty',
        'Variance',
        'Planned Price/Unit',
        'Actual Price/Unit',
        'Price Variance',
        'Unit',
        'Reason',
        'Completed By',
        'Completed At',
        'Batch Note',
      ],
    ]

    const consumedKeys = new Set<string>()
    let rowNumber = 1
    ;(group.items ?? []).forEach((menu) => {
      const ingredients = menu.ingredients ?? []
      if (ingredients.length === 0) {
        rows.push([
          rowNumber,
          menu.productionDate ?? group.date,
          menu.productionCode ?? group.productionCode ?? '',
          menu.menuName,
          formatRecipeVersion(menu.recipeVersion),
          menu.recipeCode ?? menu.recipeId ?? '',
          menu.category,
          getStoreRequestStatusLabel(menu.storeRequestStatus ?? 'fulfilled'),
          menu.portion,
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          completedByLabel,
          completedAtLabel,
          group.fulfillment?.note ?? '',
        ])
        rowNumber += 1
        return
      }

      ingredients.forEach((ingredient) => {
        const key = buildHistoryIngredientKey(
          ingredient.productCode,
          ingredient.name,
          ingredient.unitOfMeasures,
        )
        if (key) consumedKeys.add(key)
        const fulfillment = key ? fulfillmentMap.get(key) : undefined

        rows.push([
          rowNumber,
          menu.productionDate ?? group.date,
          menu.productionCode ?? group.productionCode ?? '',
          menu.menuName,
          formatRecipeVersion(menu.recipeVersion),
          menu.recipeCode ?? menu.recipeId ?? '',
          menu.category,
          getStoreRequestStatusLabel(menu.storeRequestStatus ?? 'fulfilled'),
          menu.portion,
          ingredient.productCode,
          ingredient.name,
          fulfillment
            ? formatQuantity(fulfillment.plannedQty)
            : formatQuantity(ingredient.qty),
          fulfillment ? formatQuantity(fulfillment.actualQty) : '',
          fulfillment ? formatQuantity(fulfillment.varianceQty) : '',
          fulfillment ? formatPrice(fulfillment.plannedPrice) : '',
          fulfillment ? formatPrice(fulfillment.actualPrice) : '',
          fulfillment ? formatPrice(fulfillment.variancePrice) : '',
          formatUnitLabel(
            fulfillment?.unitOfMeasures ?? ingredient.unitOfMeasures,
          ),
          fulfillment?.reason ?? '',
          completedByLabel,
          completedAtLabel,
          group.fulfillment?.note ?? '',
        ])
        rowNumber += 1
      })
    })

    Array.from(fulfillmentMap.entries()).forEach(([key, item]) => {
      if (consumedKeys.has(key)) return

      rows.push([
        rowNumber,
        group.date,
        group.productionCode ?? '',
        '',
        '',
        '',
        '',
        groupStatus,
        '',
        item.productCode,
        item.name,
        formatQuantity(item.plannedQty),
        formatQuantity(item.actualQty),
        formatQuantity(item.varianceQty),
        formatPrice(item.plannedPrice),
        formatPrice(item.actualPrice),
        formatPrice(item.variancePrice),
        formatUnitLabel(item.unitOfMeasures),
        item.reason ?? '',
        completedByLabel,
        completedAtLabel,
        group.fulfillment?.note ?? '',
      ])
      rowNumber += 1
    })

    if (rows.length === 1) {
      rows.push([
        1,
        group.date,
        group.productionCode ?? '',
        '',
        '',
        '',
        groupStatus,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        completedByLabel,
        completedAtLabel,
        group.fulfillment?.note ?? '',
      ])
    }

    const safeDate = group.date.replace(/[\\/:*?"<>|]/g, '-')
    const safeProductionCode = (group.productionCode ?? 'no-code').replace(
      /[\\/:*?"<>|]/g,
      '-',
    )
    downloadExcel(
      `issuance-history-${safeDate}-${safeProductionCode}.xls`,
      'Issuance History',
      rows,
    )
  }

  const totalPages = Math.max(1, Math.ceil(groups.length / ITEMS_PER_PAGE))
  const paginatedGroups = groups.slice(
    (page - 1) * ITEMS_PER_PAGE,
    page * ITEMS_PER_PAGE,
  )

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Issuance History</h1>
        <p className="text-sm text-muted">
          This data contains completed ingredient issuances and cancelled store
          requests.
        </p>
        {loadError ? (
          <p className="text-xs font-medium text-red-600">{loadError}</p>
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
                <th className="w-16 px-3 py-1.5 font-semibold">No</th>
                <th className="px-3 py-1.5 font-semibold">Production date</th>
                <th className="px-3 py-1.5 font-semibold">Production code</th>
                <th className="px-3 py-1.5 font-semibold">Total menu</th>
                <th className="px-3 py-1.5 font-semibold">Issuance status</th>
                <th className="px-3 py-1.5 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr className="border-t border-border">
                  <td colSpan={6} className="px-5 py-10 text-center text-muted">
                    Loading issuance history...
                  </td>
                </tr>
              ) : groups.length === 0 ? (
                <tr className="border-t border-border">
                  <td colSpan={6} className="px-5 py-10 text-center text-muted">
                    No completed or cancelled store request history yet.
                  </td>
                </tr>
              ) : (
                paginatedGroups.map((group, index) => {
                  const groupKey = getHistoryGroupKey(group)
                  const isExpanded = expandedGroups.includes(groupKey)
                  const summaryItems = group.summary ?? []
                  const fulfillmentItems = group.fulfillment?.items ?? []
                  const completedBy = getCompletedByNames(group)
                  const resolutionStatus =
                    group.fulfillment?.status ??
                    (group.items.some(
                      (item) => item.storeRequestStatus === 'cancelled',
                    )
                      ? 'cancelled'
                      : 'fulfilled')
                  const resolutionLabel =
                    getStoreRequestStatusLabel(resolutionStatus)

                  return (
                    <Fragment key={groupKey}>
                      <tr
                        className="cursor-pointer border-t border-border"
                        onClick={() => toggleExpanded(groupKey)}
                      >
                        <td className="px-3 py-1.5 text-sm text-muted">
                          {(page - 1) * ITEMS_PER_PAGE + index + 1}
                        </td>
                        <td className="px-3 py-1.5">{group.date}</td>
                        <td className="px-3 py-1.5 text-xs text-muted">
                          {group.productionCode ?? '-'}
                        </td>
                        <td className="px-3 py-1.5 text-sm font-medium">
                          {group.items.length}
                        </td>
                        <td className="px-3 py-1.5">
                          <div className="flex items-center gap-2 text-sm">
                            <span>{resolutionLabel}</span>
                          </div>
                        </td>
                        <td className="px-3 py-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                handleExportHistoryGroup(group)
                              }}
                              className="rounded-md border border-success bg-white px-3 py-1 text-xs font-semibold text-success hover:bg-success/10"
                            >
                              Export
                            </button>
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
                          <td colSpan={6} className="px-4 py-4">
                            <div className="space-y-6">
                              <div>
                                <p className="text-xs text-muted">
                                  History details
                                </p>
                                <p className="mt-2 text-sm text-muted">
                                  Production date: {group.date}
                                </p>
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
                                            Menu
                                          </th>
                                          <th className="px-3 py-1.5 font-semibold">
                                            Category
                                          </th>
                                          <th className="px-3 py-1.5 font-semibold">
                                            Portion
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
                                            <td className="px-3 py-1.5">
                                              {menu.menuName}
                                            </td>
                                            <td className="px-3 py-1.5">
                                              {menu.category}
                                            </td>
                                            <td className="px-3 py-1.5">
                                              {menu.portion}
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
                                    {resolutionStatus === 'cancelled'
                                      ? 'Cancelled ingredient summary'
                                      : fulfillmentItems.length > 0
                                        ? 'Planned vs actual issuance'
                                        : 'Ingredient summary'}
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
                                            Planned
                                          </th>
                                          <th className="px-3 py-1.5 font-semibold">
                                            Actual
                                          </th>
                                          <th className="px-3 py-1.5 font-semibold">
                                            Variance
                                          </th>
                                          <th className="px-3 py-1.5 font-semibold">
                                            Planned Price/Unit
                                          </th>
                                          <th className="px-3 py-1.5 font-semibold">
                                            Actual Price/Unit
                                          </th>
                                          <th className="px-3 py-1.5 font-semibold">
                                            Price variance
                                          </th>
                                          <th className="px-3 py-1.5 font-semibold">
                                            Unit
                                          </th>
                                          <th className="px-3 py-1.5 font-semibold">
                                            Reason
                                          </th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {fulfillmentItems.length > 0 ? (
                                          fulfillmentItems.map((item, idx) => {
                                            const varianceClass =
                                              Math.abs(item.varianceQty) <= 0.000001
                                                ? 'text-muted'
                                                : item.varianceQty > 0
                                                  ? 'text-primary'
                                                  : 'text-danger'

                                            return (
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
                                                  {formatQuantity(item.plannedQty)}
                                                </td>
                                                <td className="px-3 py-1.5">
                                                  {formatQuantity(item.actualQty)}
                                                </td>
                                                <td
                                                  className={`px-3 py-1.5 font-medium ${varianceClass}`}
                                                >
                                                  {formatSignedQuantity(
                                                    item.varianceQty,
                                                  )}
                                                </td>
                                                <td className="px-3 py-1.5 font-medium">
                                                  {formatPrice(item.plannedPrice)}
                                                </td>
                                                <td className="px-3 py-1.5 font-medium">
                                                  {formatPrice(item.actualPrice)}
                                                </td>
                                                <td className="px-3 py-1.5 font-medium">
                                                  {formatPrice(item.variancePrice)}
                                                </td>
                                                <td className="px-3 py-1.5">
                                                  {formatUnitLabel(
                                                    item.unitOfMeasures,
                                                  )}
                                                </td>
                                                <td className="px-3 py-1.5">
                                                  {item.reason ?? '-'}
                                                </td>
                                              </tr>
                                            )
                                          })
                                        ) : summaryItems.length === 0 ? (
                                          <tr className="border-t border-border">
                                            <td
                                              colSpan={11}
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
                                              <td className="px-3 py-1.5">-</td>
                                              <td className="px-3 py-1.5">-</td>
                                              <td className="px-3 py-1.5">
                                                {formatUnitLabel(
                                                  item.unitOfMeasures,
                                                )}
                                              </td>
                                              <td className="px-3 py-1.5">-</td>
                                            </tr>
                                          ))
                                        )}
                                      </tbody>
                                    </table>
                                  </div>
                                  <p className="mt-3 text-xs text-muted">
                                    Handled by:{' '}
                                    {completedBy.length > 0
                                      ? completedBy.join(', ')
                                      : '-'}
                                  </p>
                                  <p className="mt-2 text-xs text-muted">
                                    Handled at:{' '}
                                    {group.fulfillment?.completedAt
                                      ? new Date(
                                          group.fulfillment.completedAt,
                                        ).toLocaleString()
                                      : '-'}
                                  </p>
                                  {group.fulfillment?.note ? (
                                    <p className="mt-2 text-xs text-muted">
                                      {resolutionStatus === 'cancelled'
                                        ? 'Cancellation reason: '
                                        : 'Note: '}
                                      {group.fulfillment.note}
                                    </p>
                                  ) : null}
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
    </div>
  )
}

export default StorekeeperHistoryPage
