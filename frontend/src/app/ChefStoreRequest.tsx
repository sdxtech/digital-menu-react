import { Fragment, useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useChefData } from '../lib/chef-data'
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
  date: string
  productionCode?: string
  items: StoreRequestMenu[]
  summary: StoreRequestIngredient[]
  missingRecipes: string[]
  fulfillment?: StoreRequestFulfillment
}

const ITEMS_PER_PAGE = 10

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

const buildSpreadsheetXml = (
  sheetName: string,
  rows: Array<Array<unknown>>,
) => {
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
 <Worksheet ss:Name="${xmlEscape(safeName)}">
  <Table>${rowXml}</Table>
 </Worksheet>
</Workbook>`
}

const downloadExcel = (
  filename: string,
  sheetName: string,
  rows: Array<Array<unknown>>,
) => {
  const xml = buildSpreadsheetXml(sheetName, rows)
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

const ChefStoreRequest = () => {
  const { accessToken } = useAuth()
  const { cancelPendingMenuProductionBatch } = useChefData()
  const [errorMessage, setErrorMessage] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<string[]>([])
  const [groups, setGroups] = useState<StoreRequestGroup[]>([])
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [cancellingGroupKey, setCancellingGroupKey] = useState<string | null>(null)

  const formatQuantity = (value: number) => {
    if (!Number.isFinite(value)) return '0'
    if (Number.isInteger(value)) return String(value)
    return value.toFixed(3).replace(/\.?0+$/, '')
  }

  const handleExportMenusByDate = (group: StoreRequestGroup) => {
    const header = [
      'Production Date',
      'Menu Name',
      'Category',
      'Portions',
      'Base Pax',
      'Approval Status',
      'Store Request Status',
      'Notes',
      'Product Code',
      'Ingredient Name',
      'Qty',
      'Unit',
    ]

    const rows: Array<Array<string>> = []
    group.items.forEach((menu) => {
      const ingredients = menu.ingredients ?? []
      const note = menu.missingRecipe
        ? 'Missing recipe'
        : ingredients.length === 0
          ? 'No ingredients'
          : ''
      const baseRow = [
        group.date,
        menu.menuName,
        menu.category,
        String(menu.portion),
        String(menu.portionSize ?? 1),
        getApprovalStatusLabel(menu.approvalStatus),
        getStoreRequestStatusLabel(menu.storeRequestStatus),
        note,
      ]

      if (ingredients.length === 0) {
        rows.push([...baseRow, '', '', '', ''])
        return
      }

      ingredients.forEach((ingredient) => {
        rows.push([
          ...baseRow,
          ingredient.productCode,
          ingredient.name,
          formatQuantity(ingredient.qty),
          formatUnitLabel(ingredient.unitOfMeasures),
        ])
      })
    })

    const safeDate = group.date.replace(/[\\/:*?"<>|]/g, '-')
    const safeProductionCode = (group.productionCode ?? 'no-code').replace(
      /[\\/:*?"<>|]/g,
      '-',
    )
    downloadExcel(
      `store-request-menu-${safeDate}-${safeProductionCode}.xls`,
      `Menus ${group.date}`,
      [header, ...rows],
    )
  }

  // FRONTEND VIEW: backend returns grouped store requests with multiplied ingredients.
  const fetchStoreRequests = useCallback(async () => {
    if (!accessToken) {
      setErrorMessage('Please log in first to load store requests.')
      return
    }

    setLoading(true)
    setErrorMessage('')
    try {
      const data = await apiFetch<{ items: StoreRequestGroup[] }>(
        '/menu-productions/store-requests',
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
  }, [accessToken])

  const handleCancelPendingGroup = async (group: StoreRequestGroup) => {
    const pendingItems = group.items.filter((item) => item.approvalStatus === 'pending')
    if (pendingItems.length === 0) return

    const productionCodeLabel = group.productionCode ?? 'this batch'
    const confirmed = window.confirm(
      `Cancel ${pendingItems.length} pending menu(s) from ${productionCodeLabel} for ${group.date}?`,
    )
    if (!confirmed) return

    const groupKey = getStoreRequestGroupKey(group)
    setCancellingGroupKey(groupKey)
    setErrorMessage('')
    setActionMessage('')

    try {
      await cancelPendingMenuProductionBatch({
        menuProductionIds: pendingItems.map((item) => item.id),
      })
      setActionMessage(
        `${pendingItems.length} pending menu${pendingItems.length > 1 ? 's were' : ' was'} cancelled from ${productionCodeLabel} for ${group.date}.`,
      )
      await fetchStoreRequests()
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
                <th className="px-5 py-4 font-semibold">Approval status</th>
                <th className="px-5 py-4 font-semibold">Reviewed by</th>
                <th className="px-5 py-4 font-semibold">Total menu</th>
                <th className="px-5 py-4 font-semibold">Storekeeper</th>
                <th className="px-5 py-4 font-semibold">Store request status</th>
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
                const pendingItems = items.filter(
                  (item) => item.approvalStatus === 'pending',
                )
                const summaryItems = aggregateStoreRequestSummary(group.summary ?? [])
                const isExpanded = expandedGroups.includes(groupKey)
                const hasApproved = items.some(
                  (item) => item.approvalStatus === 'approved',
                )
                const hasRejected = items.some(
                  (item) => item.approvalStatus === 'rejected',
                )
                const hasPendingReview = pendingItems.length > 0
                const hasRequested = items.some(
                  (item) => item.storeRequestStatus === 'requested',
                )
                const hasDelivered = items.some(
                  (item) => item.storeRequestStatus === 'fulfilled',
                )
                const hasCancelled = items.some(
                  (item) => item.storeRequestStatus === 'cancelled',
                )
                const hasPendingApproval = items.some(
                  (item) => item.storeRequestStatus === 'not-requested',
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
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          {hasPendingReview ? (
                            <span className="text-muted">Submitted</span>
                          ) : null}
                          {hasApproved ? (
                            <span className="text-primary">Approved</span>
                          ) : null}
                          {hasRejected ? (
                            <span className="text-danger">Rejected</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-sm text-muted">
                        {reviewedByLabel}
                      </td>
                      <td className="px-5 py-4 text-sm font-medium">{items.length}</td>
                      <td className="px-5 py-4 text-sm text-muted">
                        {handledByLabel}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          {hasRequested ? (
                            <span className="text-primary">Requested</span>
                          ) : null}
                          {hasDelivered ? (
                            <span className="text-success">Delivered</span>
                          ) : null}
                          {hasCancelled ? (
                            <span className="text-danger">Cancelled</span>
                          ) : null}
                          {hasPendingApproval ? (
                            <span className="text-muted">Pending approval</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap items-center gap-2">
                          {pendingItems.length > 0 ? (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                handleCancelPendingGroup(group).catch(() => null)
                              }}
                              disabled={cancellingGroupKey === groupKey}
                              className="rounded-md border border-danger bg-white px-3 py-1 text-xs font-semibold text-danger hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {cancellingGroupKey === groupKey ? 'Cancelling...' : 'Cancel'}
                            </button>
                          ) : null}
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
                        <td colSpan={9} className="px-5 py-5">
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

                                    {menu.storeRequestStatus === 'cancelled' ? (
                                      <div className="mt-4 rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
                                        Cancel reason:{' '}
                                        {menu.cancellationReason?.trim() || '-'}
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
    </div>
  )
}

export default ChefStoreRequest

