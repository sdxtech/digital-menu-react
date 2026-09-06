import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

const getProductionDateTimestamp = (value: string) => {
  const timestamp = new Date(`${value}T00:00:00`).getTime()
  return Number.isNaN(timestamp) ? 0 : timestamp
}

const formatCreatedDate = (value?: string) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

type RecordStatus =
  | 'sales-input'
  | 'pending'
  | 'requested'
  | 'fulfilled'
  | 'cancelled'
  | 'rejected'

const getGroupRecordStatus = (
  group: StoreRequestGroup,
  includePending: boolean,
): RecordStatus | null => {
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
  if (
    includePending &&
    group.items.some((item) => item.approvalStatus === 'pending')
  ) {
    return group.items.some((item) => item.salesInputBy?.trim())
      ? 'pending'
      : 'sales-input'
  }

  return null
}

const getRecordStatusLabel = (status: RecordStatus) => {
  if (status === 'sales-input') return 'Waiting for Sales Input'
  if (status === 'pending') return 'Waiting for Approval'
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

export const DateRangeFilter = ({
  id,
  label,
  from,
  to,
  sortDirection,
  onApply,
  onSort,
}: {
  id: string
  label: string
  from: string
  to: string
  sortDirection?: 'asc' | 'desc'
  onApply: (from: string, to: string) => void
  onSort: (direction: 'asc' | 'desc') => void
}) => {
  const [open, setOpen] = useState(false)
  const [draftFrom, setDraftFrom] = useState(from)
  const [draftTo, setDraftTo] = useState(to)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const invalidRange = Boolean(draftFrom && draftTo && draftFrom > draftTo)

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (event: MouseEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const closeDropdown = () => {
    setOpen(false)
    buttonRef.current?.focus()
  }

  return (
    <div
      ref={containerRef}
      className="relative max-w-full"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation()
          closeDropdown()
        }
      }}
    >
      <button
        ref={buttonRef}
        id={`${id}-toggle`}
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => {
          if (!open) {
            setDraftFrom(from)
            setDraftTo(to)
          }
          setOpen(!open)
        }}
        className="inline-flex min-h-10 max-w-full items-center gap-2 rounded-xl border border-border bg-white px-4 py-2 text-sm text-primary shadow-sm outline-none hover:bg-background focus-visible:border-accent-blue focus-visible:ring-4 focus-visible:ring-accent-blue/20"
      >
        <span className="text-left">
          <span className="block">{label}</span>
          {from || to ? (
            <span className="block text-xs">{from || 'Any date'} – {to || 'Any date'}</span>
          ) : null}
        </span>
        {sortDirection ? (
          <>
            <i className={`bi ${sortDirection === 'desc' ? 'bi-sort-down' : 'bi-sort-up'}`} aria-hidden="true" />
            <span className="sr-only">{sortDirection === 'desc' ? 'Newest to Oldest' : 'Oldest to Newest'}</span>
          </>
        ) : null}
        <i className={`bi bi-chevron-down transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open ? (
        <div
          id={`${id}-panel`}
          aria-labelledby={`${id}-toggle`}
          className="absolute left-0 top-full z-30 mt-2 w-64 max-w-[calc(100vw-3rem)] rounded-xl border border-border bg-white py-2 shadow-lg"
        >
          <div className="space-y-1 px-2 pb-2">
            {(['desc', 'asc'] as const).map((direction) => (
              <button
                key={direction}
                type="button"
                aria-pressed={sortDirection === direction}
                onClick={() => {
                  onSort(direction)
                  closeDropdown()
                }}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-background focus-visible:outline-accent-blue ${sortDirection === direction ? 'bg-accent-blue/10 font-medium text-primary' : 'text-muted'}`}
              >
                {direction === 'desc' ? 'Newest to Oldest' : 'Oldest to Newest'}
                {sortDirection === direction ? <i className="bi bi-check-lg" aria-hidden="true" /> : null}
              </button>
            ))}
          </div>
          <form
            className="space-y-3 border-t border-border px-4 pb-2 pt-3"
            onSubmit={(event) => {
              event.preventDefault()
              if (invalidRange) return
              onApply(draftFrom, draftTo)
              closeDropdown()
            }}
          >
            <p className="text-sm font-medium">Date Range</p>
            {[
              { name: 'from', label: 'From', value: draftFrom, setValue: setDraftFrom, max: draftTo || undefined },
              { name: 'to', label: 'To', value: draftTo, setValue: setDraftTo, min: draftFrom || undefined },
            ].map((field) => (
              <div key={field.name}>
                <label htmlFor={`${id}-${field.name}`} className="mb-1 block text-sm text-muted">{field.label}</label>
                <input
                  id={`${id}-${field.name}`}
                  aria-label={`${label} ${field.label}`}
                  type="date"
                  value={field.value}
                  min={field.min}
                  max={field.max}
                  onChange={(event) => field.setValue(event.target.value)}
                  aria-invalid={invalidRange}
                  aria-describedby={invalidRange ? `${id}-error` : undefined}
                  className="h-10 w-full min-w-0 rounded-md border border-border bg-white px-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                />
              </div>
            ))}
            {invalidRange ? (
              <p id={`${id}-error`} role="alert" className="text-xs text-red-600">From date must be on or before To date.</p>
            ) : null}
            <div className="flex items-center justify-between gap-2">
              <button type="submit" disabled={invalidRange} className="py-1 text-sm font-semibold text-green-600 hover:text-green-700 disabled:cursor-not-allowed disabled:opacity-50">
                Set Date Range
              </button>
              <button
                type="button"
                onClick={() => {
                  onApply('', '')
                  closeDropdown()
                }}
                className="py-1 text-xs text-muted hover:text-primary"
              >
                Clear
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  )
}

const UnitManagerMenuProductionRecordsPage = ({
  hideFulfillmentColumns = false,
  includePending = false,
  enableSiteSelection = false,
  title = 'Menu Production Records',
  description =
    'Track approved batches waiting for the Storekeeper, plus rejected, completed, and cancelled production history.',
}: {
  hideFulfillmentColumns?: boolean
  includePending?: boolean
  enableSiteSelection?: boolean
  title?: string
  description?: string
}) => {
  const { accessToken, user } = useAuth()
  const siteOptions = useMemo(
    () =>
      Array.from(
        new Set([...(user?.site ? [user.site] : []), ...(user?.sites ?? [])]),
      ).map((code) => ({
        code,
        name:
          user?.siteOptions?.find((site) => site.code === code)?.name ?? code,
      })),
    [user?.site, user?.siteOptions, user?.sites],
  )
  const [selectedSite, setSelectedSite] = useState('')
  const [productionDateFrom, setProductionDateFrom] = useState('')
  const [productionDateTo, setProductionDateTo] = useState('')
  const [createdDateFrom, setCreatedDateFrom] = useState('')
  const [createdDateTo, setCreatedDateTo] = useState('')
  const [clientName, setClientName] = useState('')
  const [dateSort, setDateSort] = useState('production-desc')
  const [records, setRecords] = useState<StoreRequestGroup[]>([])
  const [expandedGroups, setExpandedGroups] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const fetchRecords = useCallback(async () => {
    if (!accessToken) return
    if (enableSiteSelection && !selectedSite) {
      setRecords([])
      return
    }

    setLoading(true)
    setError('')

    try {
      const params = new URLSearchParams()
      if (enableSiteSelection) params.set('site', selectedSite)
      const query = params.toString()
      const data = await apiFetch<{ items: StoreRequestGroup[] }>(
        `/menu-productions/store-requests${query ? `?${query}` : ''}`,
        undefined,
        accessToken,
      )

      const handledGroups = [...(data.items ?? [])]
        .filter((group) => getGroupRecordStatus(group, includePending) !== null)
        .sort(
          (a, b) =>
            getProductionDateTimestamp(b.date) -
            getProductionDateTimestamp(a.date),
        )

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
  }, [accessToken, enableSiteSelection, includePending, selectedSite])

  useEffect(() => {
    if (!enableSiteSelection) return
    setSelectedSite((current) =>
      siteOptions.some((site) => site.code === current)
        ? current
        : siteOptions[0]?.code ?? '',
    )
  }, [enableSiteSelection, siteOptions])

  useEffect(() => {
    setPage(1)
    setExpandedGroups([])
  }, [selectedSite, productionDateFrom, productionDateTo, createdDateFrom, createdDateTo, clientName, dateSort])

  useEffect(() => {
    fetchRecords().catch(() => null)
  }, [fetchRecords])

  const invalidProductionRange = Boolean(
    productionDateFrom && productionDateTo && productionDateFrom > productionDateTo,
  )
  const invalidCreatedRange = Boolean(
    createdDateFrom && createdDateTo && createdDateFrom > createdDateTo,
  )

  const clientOptions = useMemo(() => {
    const clients = new Map<string, string>()
    records.forEach((group) => {
      group.items.forEach((item) => {
        const name = item.clientName?.trim()
        if (name && !clients.has(name.toLowerCase())) {
          clients.set(name.toLowerCase(), name)
        }
      })
    })
    return Array.from(clients.values()).sort((a, b) =>
      a.localeCompare(b, 'id', { sensitivity: 'base' }),
    )
  }, [records])

  const filteredRecords = useMemo(() => {
    if (invalidProductionRange || invalidCreatedRange) return []

    const normalizedClient = clientName.trim().toLowerCase()
    const filtered = records.filter((group) => {
      if (productionDateFrom && group.date < productionDateFrom) return false
      if (productionDateTo && group.date > productionDateTo) return false
      if (createdDateFrom || createdDateTo) {
        const submittedAt = getGroupSubmittedAt(group)
        if (!submittedAt) return false
        const createdDate = new Date(submittedAt)
        if (Number.isNaN(createdDate.getTime())) return false
        // Match the local calendar date shown in the Created date column.
        const date = `${createdDate.getFullYear()}-${String(createdDate.getMonth() + 1).padStart(2, '0')}-${String(createdDate.getDate()).padStart(2, '0')}`
        if (createdDateFrom && date < createdDateFrom) return false
        if (createdDateTo && date > createdDateTo) return false
      }
      return !normalizedClient || group.items.some((item) =>
        item.clientName?.trim().toLowerCase() === normalizedClient,
      )
    })

    const sortByCreated = dateSort.startsWith('created-')
    const direction = dateSort.endsWith('-asc') ? 1 : -1
    return filtered.sort((a, b) => {
      const aDate = sortByCreated
        ? new Date(getGroupSubmittedAt(a) ?? '').getTime()
        : getProductionDateTimestamp(a.date)
      const bDate = sortByCreated
        ? new Date(getGroupSubmittedAt(b) ?? '').getTime()
        : getProductionDateTimestamp(b.date)
      if (Number.isNaN(aDate)) return Number.isNaN(bDate) ? 0 : 1
      if (Number.isNaN(bDate)) return -1
      return (aDate - bDate) * direction
    })
  }, [records, invalidProductionRange, invalidCreatedRange, productionDateFrom, productionDateTo, createdDateFrom, createdDateTo, clientName, dateSort])

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(filteredRecords.length / RECORD_ITEMS_PER_PAGE))
    setPage((prev) => Math.min(prev, totalPages))
  }, [filteredRecords.length])

  const paginatedRecords = useMemo(
    () =>
      filteredRecords.slice(
        (page - 1) * RECORD_ITEMS_PER_PAGE,
        page * RECORD_ITEMS_PER_PAGE,
      ),
    [page, filteredRecords],
  )

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / RECORD_ITEMS_PER_PAGE))

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
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="mt-2 text-sm text-muted">
            {description}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {enableSiteSelection ? (
              <div className="w-full sm:w-60">
                <label className="sr-only" htmlFor="executive-production-site">
                  Site
                </label>
                <select
                  id="executive-production-site"
                  value={selectedSite}
                  onChange={(event) => {
                    setSelectedSite(event.target.value)
                    setClientName('')
                  }}
                  className="h-10 w-full rounded-xl border border-border bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                >
                  <option value="">Select site</option>
                  {siteOptions.map((site) => (
                    <option key={site.code} value={site.code}>
                      {site.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="w-full sm:w-60">
              <label htmlFor="production-record-client" className="sr-only">Client Name</label>
              <select
                id="production-record-client"
                value={clientName}
                onChange={(event) => setClientName(event.target.value)}
                disabled={loading || (enableSiteSelection && !selectedSite)}
                className="h-10 w-full rounded-xl border border-border bg-white px-3 py-2 text-sm shadow-sm outline-none disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-muted focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
              >
                <option value="">{loading ? 'Loading clients...' : 'All clients'}</option>
                {clientOptions.map((client) => (
                  <option key={client.toLowerCase()} value={client}>
                    {client}
                  </option>
                ))}
              </select>
            </div>
            <DateRangeFilter
              id="production-record-production"
              label="Production Date"
              from={productionDateFrom}
              to={productionDateTo}
              sortDirection={dateSort === 'production-desc' ? 'desc' : dateSort === 'production-asc' ? 'asc' : undefined}
              onApply={(from, to) => {
                setProductionDateFrom(from)
                setProductionDateTo(to)
              }}
              onSort={(direction) => setDateSort(`production-${direction}`)}
            />
            <DateRangeFilter
              id="production-record-created"
              label="Created Date"
              from={createdDateFrom}
              to={createdDateTo}
              sortDirection={dateSort === 'created-desc' ? 'desc' : dateSort === 'created-asc' ? 'asc' : undefined}
              onApply={(from, to) => {
                setCreatedDateFrom(from)
                setCreatedDateTo(to)
              }}
              onSort={(direction) => setDateSort(`created-${direction}`)}
            />
            <button
              type="button"
              onClick={() => {
                setProductionDateFrom('')
                setProductionDateTo('')
                setCreatedDateFrom('')
                setCreatedDateTo('')
                setClientName('')
                setDateSort('production-desc')
              }}
              className="h-10 rounded-lg border border-border bg-white px-3 py-2 text-xs font-medium text-primary hover:bg-background"
            >
              Reset filters
            </button>
          </div>
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
            summary={`Showing ${paginatedRecords.length} of ${filteredRecords.length} tracked production batches`}
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
                ) : filteredRecords.length === 0 ? (
                  <tr className="border-t border-border">
                    <td colSpan={6} className="px-5 py-10 text-center text-muted">
                      {error
                        ? error
                        : productionDateFrom || productionDateTo || createdDateFrom || createdDateTo || clientName.trim()
                        ? 'No production batches match the selected filters.'
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
                    const recordStatus = getGroupRecordStatus(group, includePending)
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
                                    {recordStatus === 'pending' ||
                                    recordStatus === 'sales-input'
                                      ? 'Planned ingredient summary'
                                      : recordStatus === 'rejected'
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
                                  {recordStatus !== 'requested' &&
                                  recordStatus !== 'pending' &&
                                  recordStatus !== 'sales-input' ? (
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
