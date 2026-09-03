import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import TablePagination from '../components/TablePagination'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'
import {
  calculateFoodCostPercentage,
  formatFoodCostPercentage,
} from '../lib/food-cost'
import { summarizePortionsByGroup } from '../lib/menu-production-quantity'
import { formatQuantity } from '../lib/quantity'
import { formatRecipeVersion } from '../lib/recipe-version'
import {
  aggregateStoreRequestSummary,
  aggregateStoreRequestSummaryByVendor,
} from '../lib/store-request-summary'
import {
  getApprovalStatusLabel,
  getStoreRequestStatusLabel,
} from '../lib/status-labels'
import { formatUnitLabel } from '../lib/unit-of-measures'
import {
  downloadSpreadsheet,
  toSpreadsheetDate,
  toSpreadsheetDecimal,
  type SpreadsheetCell,
} from '../lib/spreadsheet-export'

const RECORD_ITEMS_PER_PAGE = 10

type StoreRequestIngredient = {
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
  submittedByName?: string
  reviewedBy?: string
  salesInputBy?: string
  submittedAt?: string
  approvedAt?: string
  recipeCode?: string
  recipeVersion?: number
  menuName: string
  clientName?: string
  category: string
  group?: string
  portion: number
  estimatedCost?: number
  estimatedCostPerPax?: number
  sellingPricePerPax?: number
  sellingQuantity?: number
  estimatedRevenue?: number
  approvalStatus: 'pending' | 'approved' | 'rejected'
  storeRequestStatus: 'not-requested' | 'requested' | 'fulfilled' | 'cancelled'
  ingredients?: StoreRequestIngredient[]
  fulfilledBy?: string
  cancelledBy?: string
}

type StoreRequestGroup = {
  date: string
  productionCode?: string
  items: StoreRequestMenu[]
  summary: StoreRequestIngredient[]
  fulfillment?: StoreRequestFulfillment
}

const getGroupKey = (group: StoreRequestGroup) =>
  `${group.date}__${group.productionCode ?? 'no-code'}`

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

type RecordStatus = 'requested' | 'fulfilled' | 'cancelled' | 'rejected'

const getGroupRecordStatus = (group: StoreRequestGroup): RecordStatus | null => {
  const hasFulfilled = group.items.some(
    (item) => item.storeRequestStatus === 'fulfilled',
  )
  const hasCancelled = group.items.some(
    (item) => item.storeRequestStatus === 'cancelled',
  )
  const hasRequested = group.items.some(
    (item) =>
      item.approvalStatus === 'approved' &&
      item.storeRequestStatus === 'requested',
  )
  const hasRejected = group.items.some((item) => item.approvalStatus === 'rejected')

  if (group.fulfillment?.status === 'cancelled' || hasCancelled) {
    return 'cancelled'
  }
  if (group.fulfillment?.status === 'fulfilled' || hasFulfilled) {
    return 'fulfilled'
  }
  if (hasRejected) {
    return 'rejected'
  }
  if (hasRequested) {
    return 'requested'
  }

  return null
}

const getRecordStatusLabel = (status: RecordStatus) => {
  if (status === 'requested') return 'Waiting for Storekeeper'
  if (status === 'rejected') return 'Returned to Chef'
  return getStoreRequestStatusLabel(status)
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

const buildIngredientKey = (
  productCode?: string,
  name?: string,
  unitOfMeasures?: string,
  vendor?: string,
  vendorSite?: string,
) => {
  const baseKey = `${String(productCode || name || '').trim().toLowerCase()}__${String(
    unitOfMeasures ?? '',
  )
    .trim()
    .toLowerCase()}`
  const normalizedVendor = vendor?.trim().toLowerCase() ?? ''
  if (!normalizedVendor || normalizedVendor === 'multiple') return baseKey
  return `${baseKey}__${normalizedVendor}__${vendorSite?.trim().toLowerCase() ?? ''}`
}

const UnitManagerMenuProductionRecordsPage = ({
  hideFulfillmentColumns = false,
}: {
  hideFulfillmentColumns?: boolean
}) => {
  const { accessToken } = useAuth()
  const [records, setRecords] = useState<StoreRequestGroup[]>([])
  const [expandedGroups, setExpandedGroups] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const fetchRecords = useCallback(async () => {
    if (!accessToken) return

    setLoading(true)
    setError('')

    try {
      const data = await apiFetch<{ items: StoreRequestGroup[] }>(
        '/menu-productions/store-requests',
        undefined,
        accessToken,
      )

      const handledGroups = [...(data.items ?? [])]
        .filter((group) => getGroupRecordStatus(group) !== null)
        .sort((a, b) => b.date.localeCompare(a.date))

      setRecords(handledGroups)
    } catch (fetchError) {
      const message =
        fetchError instanceof Error
          ? fetchError.message
          : 'Failed to load production records.'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  useEffect(() => {
    fetchRecords().catch(() => null)
  }, [fetchRecords])

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(records.length / RECORD_ITEMS_PER_PAGE))
    setPage((prev) => Math.min(prev, totalPages))
  }, [records.length])

  const paginatedRecords = useMemo(
    () =>
      records.slice(
        (page - 1) * RECORD_ITEMS_PER_PAGE,
        page * RECORD_ITEMS_PER_PAGE,
      ),
    [page, records],
  )

  const totalPages = Math.max(1, Math.ceil(records.length / RECORD_ITEMS_PER_PAGE))

  const toggleExpandedGroup = (groupKey: string) => {
    setExpandedGroups((prev) =>
      prev.includes(groupKey)
        ? prev.filter((item) => item !== groupKey)
        : [...prev, groupKey],
    )
  }

  const handleExportRecordGroup = (group: StoreRequestGroup) => {
    const rows: SpreadsheetCell[][] = [
      [
        'No',
        'Created Date',
        'Production Date',
        'Client Name',
        'Production Code',
        'Group By',
        'Menu Name',
        'Version',
        'Category',
        'Recipe Code',
        'Portion',
        'IT Code',
        'Ingredient Name',
        'Vendor',
        'QTY Planned',
        'QTY Actual',
        'Variance',
        'Unit Of Measures',
        'Reviewed By',
        'Approval Status',
        'Store Request Status',
        'Completed By',
        'Completed At',
        'Reason',
      ],
    ]

    const fulfillmentByKey = new Map(
      (group.fulfillment?.items ?? []).map((item) => [
        buildIngredientKey(
          item.productCode,
          item.name,
          item.unitOfMeasures,
          item.vendor,
          item.vendorSite,
        ),
        item,
      ]),
    )
    const completedAt = toSpreadsheetDate(group.fulfillment?.completedAt)
    const completedBy = group.fulfillment?.completedBy ?? ''

    let rowNumber = 1
    group.items.forEach((menu) => {
      const menuIngredients = menu.ingredients ?? []
      const approvedBy = menu.reviewedBy ?? ''
      const approvalStatus = getApprovalStatusLabel(menu.approvalStatus)
      const storeRequestStatus = getStoreRequestStatusLabel(
        menu.storeRequestStatus,
      )

      if (menuIngredients.length === 0) {
        rows.push([
          rowNumber,
          formatCreatedDate(menu.submittedAt),
          toSpreadsheetDate(group.date),
          menu.clientName ?? '',
          group.productionCode ?? '',
          menu.group ?? '',
          menu.menuName,
          formatRecipeVersion(menu.recipeVersion),
          menu.category,
          menu.recipeCode ?? '',
          menu.portion,
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          approvedBy,
          approvalStatus,
          storeRequestStatus,
          completedBy,
          completedAt,
          '',
        ])
        rowNumber += 1
        return
      }

      menuIngredients.forEach((ingredient) => {
        const ingredientKey = buildIngredientKey(
          ingredient.productCode,
          ingredient.name,
          ingredient.unitOfMeasures,
          ingredient.vendor,
          ingredient.vendorSite,
        )
        const fulfillmentItem =
          fulfillmentByKey.get(ingredientKey) ??
          fulfillmentByKey.get(
            buildIngredientKey(
              ingredient.productCode,
              ingredient.name,
              ingredient.unitOfMeasures,
            ),
          )
        rows.push([
          rowNumber,
          formatCreatedDate(menu.submittedAt),
          toSpreadsheetDate(group.date),
          menu.clientName ?? '',
          group.productionCode ?? '',
          menu.group ?? '',
          menu.menuName,
          formatRecipeVersion(menu.recipeVersion),
          menu.category,
          menu.recipeCode ?? '',
          menu.portion,
          ingredient.productCode,
          ingredient.name,
          ingredient.vendor ?? fulfillmentItem?.vendor ?? '',
          toSpreadsheetDecimal(formatQuantity(ingredient.qty)),
          fulfillmentItem
            ? toSpreadsheetDecimal(formatQuantity(fulfillmentItem.actualQty))
            : '',
          fulfillmentItem
            ? toSpreadsheetDecimal(formatQuantity(fulfillmentItem.varianceQty))
            : '',
          formatUnitLabel(ingredient.unitOfMeasures),
          approvedBy,
          approvalStatus,
          storeRequestStatus,
          completedBy,
          completedAt,
          fulfillmentItem?.reason ?? '',
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
    downloadSpreadsheet(
      `menu-production-record-${safeDate}-${safeProductionCode}.xlsx`,
      [
        { name: 'Menu Production Record', rows },
        { name: 'Ingredient Summary', rows: summaryRows },
      ],
    )
  }

  const getReviewedByNames = (group: StoreRequestGroup) =>
    Array.from(
      new Set(
        group.items
          .map((item) => item.reviewedBy?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    )

  const getHandledByNames = (group: StoreRequestGroup) => {
    return group.fulfillment?.completedBy?.trim()
      ? [group.fulfillment.completedBy.trim()]
      : Array.from(
          new Set(
            group.items
              .map((item) => item.fulfilledBy?.trim() || item.cancelledBy?.trim())
              .filter((value): value is string => Boolean(value)),
          ),
        )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div>
          <h1 className="text-2xl font-semibold">Menu Production Records</h1>
          <p className="mt-2 text-sm text-muted">
            Track approved batches waiting for the Storekeeper, plus rejected,
            completed, and cancelled production history.
          </p>
          {error ? (
            <p className="mt-2 text-xs font-medium text-red-600">{error}</p>
          ) : null}
        </div>

        <div className="rounded-md border border-border bg-surface p-6 shadow-sm">
          <TablePagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            loading={loading}
            summary={`Showing ${paginatedRecords.length} of ${records.length} tracked production batches`}
          />
          <div className="mt-4 max-w-full overflow-x-auto rounded-md border border-border">
            <table className="dm-table min-w-full bg-white text-sm">
              <thead className="bg-background">
                <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                  <th className="w-16 px-5 py-4 font-semibold">No</th>
                  <th className="px-5 py-4 font-semibold">Created date</th>
                  <th className="px-5 py-4 font-semibold">Production date</th>
                  <th className="px-5 py-4 font-semibold">Production code</th>
                  <th className="px-5 py-4 font-semibold">Client name</th>
                  <th className="px-5 py-4 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr className="border-t border-border">
                    <td colSpan={6} className="px-5 py-10 text-center text-muted">
                      Loading production records...
                    </td>
                  </tr>
                ) : records.length === 0 ? (
                  <tr className="border-t border-border">
                    <td colSpan={6} className="px-5 py-10 text-center text-muted">
                      {error
                        ? error
                        : 'No approved, rejected, completed, or cancelled production batches yet.'}
                    </td>
                  </tr>
                ) : (
                  paginatedRecords.map((group, index) => {
                    const groupKey = getGroupKey(group)
                    const isExpanded = expandedGroups.includes(groupKey)
                    const submittedByNames = Array.from(
                      new Set(
                        group.items
                          .map((item) => item.submittedByName?.trim())
                          .filter((value): value is string => Boolean(value)),
                      ),
                    )
                    const submittedByLabel = submittedByNames.length
                      ? submittedByNames.join(', ')
                      : '-'
                    const recordStatus = getGroupRecordStatus(group)
                    if (!recordStatus) return null
                    const reviewedByNames = getReviewedByNames(group)
                    const reviewedByLabel = reviewedByNames.length
                      ? reviewedByNames.join(', ')
                      : '-'
                    const handledBy =
                      recordStatus === 'requested' || recordStatus === 'rejected'
                        ? []
                        : getHandledByNames(group)
                    const storekeeperLabel =
                      recordStatus === 'requested' || recordStatus === 'rejected'
                          ? '-'
                          : handledBy.length
                            ? handledBy.join(', ')
                            : '-'
                    const items = group.items
                    const hasApproved = items.some(
                      (item) => item.approvalStatus === 'approved',
                    )
                    const hasRejected = items.some(
                      (item) => item.approvalStatus === 'rejected',
                    )
                    const hasPendingReview = items.some(
                      (item) => item.approvalStatus === 'pending',
                    )
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
                    const approvalStatusSummary = [
                      hasPendingReview ? 'Submitted' : '',
                      hasApproved ? 'Approved' : '',
                      hasRejected ? 'Returned to Chef' : '',
                    ]
                      .filter(Boolean)
                      .join(', ')
                    const storeRequestStatusSummary = [
                      hasRequested ? 'Requested' : '',
                      hasDelivered ? 'Completed' : '',
                      hasCancelled ? 'Cancelled' : '',
                      hasPendingApproval ? 'Pending approval' : '',
                    ]
                      .filter(Boolean)
                      .join(', ')
                    const summaryItems = aggregateStoreRequestSummary(group.summary)
                    const fulfillmentItems = group.fulfillment?.items ?? []
                    const totalEstimatedCost = items.reduce(
                      (total, item) =>
                        total +
                        (Number.isFinite(Number(item.estimatedCost))
                          ? Number(item.estimatedCost)
                          : 0),
                      0,
                    )
                    const totalEstimatedCostPerPax = items.reduce(
                      (total, item) => {
                        const estimatedCost = Number.isFinite(
                          Number(item.estimatedCost),
                        )
                          ? Number(item.estimatedCost)
                          : undefined
                        const costPerPax = Number.isFinite(
                          Number(item.estimatedCostPerPax),
                        )
                          ? Number(item.estimatedCostPerPax)
                          : estimatedCost !== undefined && item.portion > 0
                            ? estimatedCost / item.portion
                            : 0
                        return total + costPerPax
                      },
                      0,
                    )
                    const firstMenu = items[0]
                    const sellingPricePerPax = Number.isFinite(
                      Number(firstMenu?.sellingPricePerPax),
                    )
                      ? Number(firstMenu?.sellingPricePerPax)
                      : undefined
                    const sellingQuantity = Number.isFinite(
                      Number(firstMenu?.sellingQuantity),
                    )
                      ? Number(firstMenu?.sellingQuantity)
                      : undefined
                    const estimatedRevenue =
                      sellingPricePerPax !== undefined &&
                      sellingQuantity !== undefined
                        ? sellingPricePerPax * sellingQuantity
                        : Number.isFinite(Number(firstMenu?.estimatedRevenue))
                          ? Number(firstMenu?.estimatedRevenue)
                          : undefined
                    const foodCostPercentage = calculateFoodCostPercentage(
                      totalEstimatedCost,
                      estimatedRevenue,
                    )
                    const portionSummary = summarizePortionsByGroup(items)

                    return (
                      <Fragment key={`record-${groupKey}`}>
                        <tr
                          className="cursor-pointer border-t border-border"
                          onClick={() => toggleExpandedGroup(groupKey)}
                        >
                          <td className="px-5 py-4 text-sm text-muted">
                            {(page - 1) * RECORD_ITEMS_PER_PAGE + index + 1}
                          </td>
                          <td className="px-5 py-4 text-sm text-muted">
                            {formatCreatedDate(getGroupSubmittedAt(group))}
                          </td>
                      <td className="px-5 py-4">{group.date}</td>
                      <td className="px-5 py-4 text-xs text-muted">
                        {group.productionCode ?? '-'}
                      </td>
                      <td className="px-5 py-4">{group.items[0]?.clientName ?? '-'}</td>
                          <td className="px-5 py-4">
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  toggleExpandedGroup(groupKey)
                                }}
                                className="rounded-md border border-primary bg-primary-soft px-3 py-1 text-xs font-semibold text-primary hover:bg-primary-soft/80"
                              >
                                {isExpanded ? 'Hide details' : 'View details'}
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  handleExportRecordGroup(group)
                                }}
                                className="rounded-md border border-success bg-white px-3 py-1 text-xs font-semibold text-success shadow-sm hover:bg-success/10"
                              >
                                <span className="flex items-center gap-2">
                                  <i
                                    className="bi bi-download text-sm"
                                    aria-hidden="true"
                                  />
                                  <span>Export</span>
                                </span>
                              </button>
                            </div>
                          </td>
                        </tr>
                        {isExpanded ? (
                          <tr className="border-t border-border bg-background">
                            <td colSpan={6} className="px-5 py-5">
                              <div className="space-y-4">
                                <section className="border-b border-border pb-4">
                                  <h3 className="text-sm font-semibold text-foreground">
                                    Production information
                                  </h3>
                                  <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                                    <div className="rounded-md border border-border bg-white px-3 py-2">
                                      <dt className="text-xs font-medium text-muted">
                                        Batch status
                                      </dt>
                                      <dd className="mt-1 font-semibold text-foreground">
                                        {getRecordStatusLabel(recordStatus)}
                                      </dd>
                                    </div>
                                    <div className="rounded-md border border-border bg-white px-3 py-2">
                                      <dt className="text-xs font-medium text-muted">
                                        Approval status
                                      </dt>
                                      <dd className="mt-1 font-semibold text-foreground">
                                        {approvalStatusSummary || '-'}
                                      </dd>
                                    </div>
                                    <div className="rounded-md border border-border bg-white px-3 py-2">
                                      <dt className="text-xs font-medium text-muted">
                                        Store request status
                                      </dt>
                                      <dd className="mt-1 font-semibold text-foreground">
                                        {storeRequestStatusSummary || '-'}
                                      </dd>
                                    </div>
                                    <div className="rounded-md border border-border bg-white px-3 py-2">
                                      <dt className="text-xs font-medium text-muted">
                                        Total menu
                                      </dt>
                                      <dd className="mt-1 font-semibold text-foreground">
                                        {items.length}
                                      </dd>
                                    </div>
                                    <div className="rounded-md border border-border bg-white px-3 py-2">
                                      <dt className="text-xs font-medium text-muted">
                                        Submitted by
                                      </dt>
                                      <dd className="mt-1 font-semibold text-foreground">
                                        {submittedByLabel}
                                      </dd>
                                    </div>
                                    <div className="rounded-md border border-border bg-white px-3 py-2">
                                      <dt className="text-xs font-medium text-muted">
                                        Admin
                                      </dt>
                                      <dd className="mt-1 font-semibold text-foreground">
                                        {firstMenu?.salesInputBy?.trim() || '-'}
                                      </dd>
                                    </div>
                                    <div className="rounded-md border border-border bg-white px-3 py-2">
                                      <dt className="text-xs font-medium text-muted">
                                        Client
                                      </dt>
                                      <dd className="mt-1 font-semibold text-foreground">
                                        {firstMenu?.clientName?.trim() || '-'}
                                      </dd>
                                    </div>
                                    <div className="rounded-md border border-border bg-white px-3 py-2">
                                      <dt className="text-xs font-medium text-muted">
                                        Reviewed by
                                      </dt>
                                      <dd className="mt-1 font-semibold text-foreground">
                                        {reviewedByLabel}
                                      </dd>
                                    </div>
                                    <div className="rounded-md border border-border bg-white px-3 py-2">
                                      <dt className="text-xs font-medium text-muted">
                                        Storekeeper
                                      </dt>
                                      <dd className="mt-1 font-semibold text-foreground">
                                        {storekeeperLabel}
                                      </dd>
                                    </div>
                                  </dl>
                                </section>

                                <div className="rounded-md border border-border bg-surface p-4">
                                  <p className="text-xs text-muted">Menu list</p>
                                  <div className="mt-3 max-w-full overflow-x-auto rounded-md border border-black bg-white">
                                    <table className="dm-table min-w-full text-sm">
                                      <thead className="bg-background">
                                        <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                                          <th className="w-12 px-4 py-3 font-semibold">No</th>
                                          <th className="px-4 py-3 font-semibold">Group By</th>
                                          <th className="px-4 py-3 font-semibold">Menu</th>
                                          <th className="px-4 py-3 font-semibold">Portion</th>
                                          <th className="px-4 py-3 font-semibold">
                                            Estimated Cost
                                          </th>
                                          <th className="px-4 py-3 font-semibold">
                                            Cost Contribution (%)
                                          </th>
                                          <th className="px-4 py-3 font-semibold">
                                            Cost/Pax
                                          </th>
                                          <th className="px-4 py-3 font-semibold">Approval status</th>
                                          <th className="px-4 py-3 font-semibold">Store status</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {group.items.map((item, itemIndex) => {
                                          const estimatedCost = Number.isFinite(
                                            Number(item.estimatedCost),
                                          )
                                            ? Number(item.estimatedCost)
                                            : undefined
                                          const estimatedCostPerPax =
                                            Number.isFinite(
                                              Number(item.estimatedCostPerPax),
                                            )
                                              ? Number(item.estimatedCostPerPax)
                                              : estimatedCost !== undefined &&
                                                  item.portion > 0
                                                ? estimatedCost / item.portion
                                                : undefined

                                          return (
                                            <tr
                                              key={item.id}
                                              className="border-t border-border"
                                            >
                                              <td className="px-4 py-3 text-sm text-muted">
                                                {itemIndex + 1}
                                              </td>
                                              <td className="px-4 py-3">
                                                {item.group ?? '-'}
                                              </td>
                                              <td className="px-4 py-3">
                                                <p className="font-semibold text-foreground">
                                                  {item.menuName}
                                                </p>
                                                <p className="mt-1 text-xs text-muted">
                                                  {item.recipeCode ?? '-'} ·{' '}
                                                  {item.category || '-'}
                                                </p>
                                              </td>
                                              <td className="px-4 py-3">
                                                {item.portion}
                                              </td>
                                              <td className="px-4 py-3 font-medium">
                                                {formatPrice(estimatedCost)}
                                              </td>
                                              <td className="px-4 py-3 font-medium">
                                                {formatFoodCostPercentage(
                                                  estimatedCost,
                                                  estimatedRevenue,
                                                )}
                                              </td>
                                              <td className="px-4 py-3 font-medium">
                                                {formatPrice(estimatedCostPerPax)}
                                              </td>
                                              <td className="px-4 py-3">
                                                {getApprovalStatusLabel(
                                                  item.approvalStatus,
                                                )}
                                              </td>
                                              <td className="px-4 py-3">
                                                {getStoreRequestStatusLabel(
                                                  item.storeRequestStatus,
                                                )}
                                              </td>
                                            </tr>
                                          )
                                        })}
                                      </tbody>
                                      <tfoot className="bg-[#ccd9ec]">
                                        <tr className="border-t-2 border-primary">
                                          <td
                                            colSpan={4}
                                            className="px-4 py-3 text-center text-xs font-bold uppercase tracking-[0.12em]"
                                          >
                                            Total
                                          </td>
                                          <td className="px-4 py-3 font-bold">
                                            {formatPrice(totalEstimatedCost)}
                                          </td>
                                          <td className="px-4 py-3 font-bold">
                                            {foodCostPercentage === undefined
                                              ? '-'
                                              : `${foodCostPercentage.toFixed(2)}%`}
                                          </td>
                                          <td className="px-4 py-3 font-bold">
                                            {formatPrice(
                                              totalEstimatedCostPerPax,
                                            )}
                                          </td>
                                          <td colSpan={2} />
                                        </tr>
                                        {portionSummary.groups.length > 0 ? (
                                          <tr
                                            aria-hidden="true"
                                            className="border-y border-black"
                                          >
                                            <td
                                              colSpan={9}
                                              className="h-2 p-0"
                                              style={{
                                                backgroundColor:
                                                  'var(--dm-primary)',
                                              }}
                                            />
                                          </tr>
                                        ) : null}
                                        {portionSummary.groups.map((item) => (
                                          <tr
                                            key={`record-group-portion-${item.name}`}
                                            className="border-t border-border"
                                          >
                                            <td
                                              colSpan={4}
                                              className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.12em]"
                                            >
                                              {item.name} Qty
                                            </td>
                                            <td
                                              colSpan={5}
                                              className="px-4 py-3 font-semibold"
                                            >
                                              {formatQuantity(item.portion)}
                                            </td>
                                          </tr>
                                        ))}
                                        <tr className="border-t border-border">
                                          <td
                                            colSpan={4}
                                            className="px-4 py-3 text-right text-xs font-bold uppercase tracking-[0.12em]"
                                          >
                                            Total Qty
                                          </td>
                                          <td
                                            colSpan={5}
                                            className="px-4 py-3 font-bold"
                                          >
                                            {formatQuantity(portionSummary.total)}
                                          </td>
                                        </tr>
                                        <tr
                                          aria-hidden="true"
                                          className="border-y border-black"
                                        >
                                          <td
                                            colSpan={9}
                                            className="h-2 p-0"
                                            style={{
                                              backgroundColor:
                                                'var(--dm-primary)',
                                            }}
                                          />
                                        </tr>
                                        <tr className="border-t border-border">
                                          <td
                                            colSpan={4}
                                            className="px-4 py-3 text-center text-xs font-bold uppercase tracking-[0.12em]"
                                          >
                                            Selling Price/Pax
                                          </td>
                                          <td
                                            colSpan={5}
                                            className="px-4 py-3 font-bold"
                                          >
                                            {formatPrice(sellingPricePerPax)}
                                          </td>
                                        </tr>
                                        <tr className="border-t border-border">
                                          <td
                                            colSpan={4}
                                            className="px-4 py-3 text-center text-xs font-bold uppercase tracking-[0.12em]"
                                          >
                                            Pax Calculation
                                          </td>
                                          <td
                                            colSpan={5}
                                            className="px-4 py-3 font-bold"
                                          >
                                            {sellingQuantity ?? '-'}
                                          </td>
                                        </tr>
                                        <tr className="border-t border-border">
                                          <td
                                            colSpan={4}
                                            className="px-4 py-3 text-center text-xs font-bold uppercase tracking-[0.12em]"
                                          >
                                            Estimated Revenue
                                          </td>
                                          <td
                                            colSpan={5}
                                            className="px-4 py-3 font-bold"
                                          >
                                            {formatPrice(estimatedRevenue)}
                                          </td>
                                        </tr>
                                        <tr className="border-t border-border">
                                          <td
                                            colSpan={4}
                                            className="px-4 py-3 text-center text-xs font-bold uppercase tracking-[0.12em]"
                                          >
                                            Food Cost Percentage
                                          </td>
                                          <td
                                            colSpan={5}
                                            className="px-4 py-3 font-bold"
                                          >
                                            {foodCostPercentage === undefined
                                              ? '-'
                                              : `${foodCostPercentage.toFixed(2)}%`}
                                          </td>
                                        </tr>
                                      </tfoot>
                                    </table>
                                  </div>
                                </div>

                                <div className="rounded-md border border-border bg-surface p-4">
                                  <p className="text-xs text-muted">
                                    {recordStatus === 'rejected'
                                      ? 'Returned production summary'
                                      : recordStatus === 'requested'
                                      ? 'Requested ingredient summary'
                                      : recordStatus === 'cancelled'
                                      ? 'Cancelled ingredient summary'
                                      : 'Planned vs actual issuance'}
                                  </p>
                                  <div className="mt-3 max-w-full overflow-x-auto rounded-md border border-border bg-white">
                                    <table className="dm-table min-w-full text-sm">
                                      <thead className="bg-background">
                                        <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                                          <th className="w-12 px-4 py-3 font-semibold">No</th>
                                          <th className="px-4 py-3 font-semibold">Product code</th>
                                          <th className="min-w-32 max-w-64 px-4 py-3 font-semibold !whitespace-normal">
                                            Ingredient name
                                          </th>
                                          <th className="px-4 py-3 font-semibold">Vendor</th>
                                          <th className="px-4 py-3 font-semibold">Price</th>
                                          <th className="px-4 py-3 font-semibold">Ingredient Cost</th>
                                          <th className="px-4 py-3 font-semibold">
                                            {hideFulfillmentColumns ? 'QTY' : 'Planned'}
                                          </th>
                                          {!hideFulfillmentColumns ? (
                                            <>
                                              <th className="px-4 py-3 font-semibold">Actual</th>
                                              <th className="px-4 py-3 font-semibold">Variance</th>
                                              <th className="px-4 py-3 font-semibold">Planned Price/Unit</th>
                                              <th className="px-4 py-3 font-semibold">Actual Price/Unit</th>
                                              <th className="px-4 py-3 font-semibold">Price Variance</th>
                                            </>
                                          ) : null}
                                          <th className="px-4 py-3 font-semibold">Unit</th>
                                          {!hideFulfillmentColumns ? (
                                            <th className="px-4 py-3 font-semibold">Reason</th>
                                          ) : null}
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {recordStatus === 'fulfilled' &&
                                        fulfillmentItems.length > 0 ? (
                                          fulfillmentItems.map((item, itemIndex) => (
                                            <tr
                                              key={`${item.productCode}-${item.unitOfMeasures}-${itemIndex}`}
                                              className="border-t border-border"
                                            >
                                              <td className="px-4 py-3 text-sm text-muted">
                                                {itemIndex + 1}
                                              </td>
                                              <td className="px-4 py-3">{item.productCode}</td>
                                              <td className="min-w-32 max-w-64 break-words px-4 py-3 !whitespace-normal">
                                                {item.name}
                                              </td>
                                              <td className="px-4 py-3">
                                                {item.vendor ?? '-'}
                                              </td>
                                              <td className="px-4 py-3 font-medium">
                                                {formatPrice(item.price)}
                                              </td>
                                              <td className="px-4 py-3 font-medium">
                                                {formatPrice(item.ingredientCost)}
                                              </td>
                                              <td className="px-4 py-3">
                                                {formatQuantity(item.plannedQty)}
                                              </td>
                                              {!hideFulfillmentColumns ? (
                                                <>
                                                  <td className="px-4 py-3">
                                                    {formatQuantity(item.actualQty)}
                                                  </td>
                                                  <td className="px-4 py-3">
                                                    {formatQuantity(item.varianceQty)}
                                                  </td>
                                                  <td className="px-4 py-3 font-medium">
                                                    {formatPrice(item.plannedPrice)}
                                                  </td>
                                                  <td className="px-4 py-3 font-medium">
                                                    {formatPrice(item.actualPrice)}
                                                  </td>
                                                  <td className="px-4 py-3 font-medium">
                                                    {formatPrice(item.variancePrice)}
                                                  </td>
                                                </>
                                              ) : null}
                                              <td className="px-4 py-3">
                                                {formatUnitLabel(item.unitOfMeasures)}
                                              </td>
                                              {!hideFulfillmentColumns ? (
                                                <td className="px-4 py-3">{item.reason ?? '-'}</td>
                                              ) : null}
                                            </tr>
                                          ))
                                        ) : summaryItems.length === 0 ? (
                                          <tr className="border-t border-border">
                                            <td
                                              colSpan={hideFulfillmentColumns ? 8 : 14}
                                              className="px-4 py-6 text-center text-muted"
                                            >
                                              No ingredients available to display.
                                            </td>
                                          </tr>
                                        ) : (
                                          summaryItems.map((item, itemIndex) => (
                                            <tr
                                              key={`${item.productCode}-${item.unitOfMeasures}-${itemIndex}`}
                                              className="border-t border-border"
                                            >
                                              <td className="px-4 py-3 text-sm text-muted">
                                                {itemIndex + 1}
                                              </td>
                                              <td className="px-4 py-3">{item.productCode}</td>
                                              <td className="min-w-32 max-w-64 break-words px-4 py-3 !whitespace-normal">
                                                {item.name}
                                              </td>
                                              <td className="px-4 py-3">
                                                {item.vendor ?? '-'}
                                              </td>
                                              <td className="px-4 py-3 font-medium">
                                                {formatPrice(item.price)}
                                              </td>
                                              <td className="px-4 py-3 font-medium">
                                                {formatPrice(item.ingredientCost)}
                                              </td>
                                              <td className="px-4 py-3">
                                                {formatQuantity(item.qty)}
                                              </td>
                                              {!hideFulfillmentColumns ? (
                                                <>
                                                  <td className="px-4 py-3">-</td>
                                                  <td className="px-4 py-3">-</td>
                                                  <td className="px-4 py-3">-</td>
                                                  <td className="px-4 py-3">-</td>
                                                  <td className="px-4 py-3">-</td>
                                                </>
                                              ) : null}
                                              <td className="px-4 py-3">
                                                {formatUnitLabel(item.unitOfMeasures)}
                                              </td>
                                              {!hideFulfillmentColumns ? (
                                                <td className="px-4 py-3">-</td>
                                              ) : null}
                                            </tr>
                                          ))
                                        )}
                                      </tbody>
                                    </table>
                                  </div>
                                  {recordStatus !== 'requested' ? (
                                    <p className="mt-2 text-xs text-muted">
                                      {`${recordStatus === 'rejected' ? 'Reviewed at' : 'Handled at'}: ${
                                        recordStatus !== 'rejected' &&
                                        group.fulfillment?.completedAt
                                          ? new Date(
                                              group.fulfillment.completedAt,
                                            ).toLocaleString()
                                          : '-'
                                      }`}
                                    </p>
                                  ) : null}
                                  {group.fulfillment?.note ? (
                                    <p className="mt-2 text-xs text-muted">
                                      {recordStatus === 'cancelled'
                                        ? 'Cancellation reason: '
                                        : 'Storekeeper note: '}
                                      {group.fulfillment.note}
                                    </p>
                                  ) : null}
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
    </div>
  )
}

export default UnitManagerMenuProductionRecordsPage
