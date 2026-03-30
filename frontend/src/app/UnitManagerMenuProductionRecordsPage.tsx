import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import TablePagination from '../components/TablePagination'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'
import { aggregateStoreRequestSummary } from '../lib/store-request-summary'
import { getStoreRequestStatusLabel } from '../lib/status-labels'
import { formatUnitLabel } from '../lib/unit-of-measures'

const RECORD_ITEMS_PER_PAGE = 10

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
  recipeCode?: string
  menuName: string
  category: string
  portion: number
  storeRequestStatus: 'not-requested' | 'requested' | 'fulfilled' | 'cancelled'
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

const formatQuantity = (value: number) => {
  if (!Number.isFinite(value)) return '0'
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(3).replace(/\.?0+$/, '')
}

const UnitManagerMenuProductionRecordsPage = () => {
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
        '/menu-productions/store-requests?approvalStatus=approved',
        undefined,
        accessToken,
      )

      const handledGroups = [...(data.items ?? [])]
        .filter((group) =>
          group.items.some(
            (item) =>
              item.storeRequestStatus === 'fulfilled' ||
              item.storeRequestStatus === 'cancelled',
          ),
        )
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

  const getHandledByNames = (group: StoreRequestGroup) =>
    group.fulfillment?.completedBy?.trim()
      ? [group.fulfillment.completedBy.trim()]
      : Array.from(
          new Set(
            group.items
              .map((item) => item.fulfilledBy?.trim() || item.cancelledBy?.trim())
              .filter((value): value is string => Boolean(value)),
          ),
        )

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div>
          <h1 className="text-2xl font-semibold">Menu Production Records</h1>
          <p className="mt-2 text-sm text-muted">
            Review completed and cancelled store requests handled by the
            Storekeeper.
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
            summary={`Showing ${paginatedRecords.length} of ${records.length} handled production batches`}
          />
          <div className="mt-4 max-w-full overflow-x-auto rounded-md border border-border">
            <table className="dm-table min-w-full bg-white text-sm">
              <thead className="bg-background">
                <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                  <th className="w-16 px-4 py-3 font-semibold">No</th>
                  <th className="px-4 py-3 font-semibold">Production date</th>
                  <th className="px-4 py-3 font-semibold">Production code</th>
                  <th className="px-4 py-3 font-semibold">Chef</th>
                  <th className="px-4 py-3 font-semibold">Store request status</th>
                  <th className="px-4 py-3 font-semibold">Storekeeper</th>
                  <th className="px-4 py-3 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr className="border-t border-border">
                    <td colSpan={7} className="px-4 py-8 text-center text-muted">
                      Loading production records...
                    </td>
                  </tr>
                ) : records.length === 0 ? (
                  <tr className="border-t border-border">
                    <td colSpan={7} className="px-4 py-8 text-center text-muted">
                      {error ? error : 'No completed or cancelled store requests yet.'}
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
                  const handledBy = getHandledByNames(group)
                  const handledByLabel = handledBy.length ? handledBy.join(', ') : '-'
                  const summaryItems = aggregateStoreRequestSummary(group.summary)
                  const resolutionStatus =
                    group.fulfillment?.status ??
                    (group.items.some(
                        (item) => item.storeRequestStatus === 'cancelled',
                      )
                        ? 'cancelled'
                        : 'fulfilled')
                    const fulfillmentItems = group.fulfillment?.items ?? []

                    return (
                      <Fragment key={`record-${groupKey}`}>
                        <tr className="border-t border-border">
                          <td className="px-4 py-3 text-sm text-muted">
                            {(page - 1) * RECORD_ITEMS_PER_PAGE + index + 1}
                          </td>
                          <td className="px-4 py-3">{group.date}</td>
                          <td className="px-4 py-3 text-xs text-muted">
                            {group.productionCode ?? '-'}
                          </td>
                          <td className="px-4 py-3">{submittedByLabel}</td>
                          <td className="px-4 py-3">
                            <span
                              className={`rounded-full px-2 py-1 text-xs font-semibold ${
                                resolutionStatus === 'cancelled'
                                  ? 'bg-danger/10 text-danger'
                                  : 'bg-success/10 text-success'
                              }`}
                            >
                              {getStoreRequestStatusLabel(resolutionStatus)}
                            </span>
                          </td>
                          <td className="px-4 py-3">{handledByLabel}</td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => toggleExpandedGroup(groupKey)}
                              className="rounded-md border border-primary bg-primary-soft px-3 py-2 text-xs font-semibold text-primary hover:bg-primary-soft/80"
                            >
                              {isExpanded ? 'Hide details' : 'View details'}
                            </button>
                          </td>
                        </tr>
                        {isExpanded ? (
                          <tr className="border-t border-border bg-background">
                            <td colSpan={7} className="px-4 py-4">
                              <div className="grid gap-4 lg:grid-cols-12">
                                <div className="rounded-md border border-border bg-surface p-4 lg:col-span-5">
                                  <p className="text-xs text-muted">Menu list</p>
                                  <div className="mt-3 max-w-full overflow-x-auto rounded-md border border-border bg-white">
                                    <table className="dm-table min-w-full text-sm">
                                      <thead className="bg-background">
                                        <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                                          <th className="w-12 px-4 py-3 font-semibold">No</th>
                                          <th className="px-4 py-3 font-semibold">Recipe code</th>
                                          <th className="px-4 py-3 font-semibold">Menu</th>
                                          <th className="px-4 py-3 font-semibold">Category</th>
                                          <th className="px-4 py-3 font-semibold">Portion</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {group.items.map((item, itemIndex) => (
                                          <tr key={item.id} className="border-t border-border">
                                            <td className="px-4 py-3 text-sm text-muted">
                                              {itemIndex + 1}
                                            </td>
                                            <td className="px-4 py-3 font-medium">
                                              {item.recipeCode ?? '-'}
                                            </td>
                                            <td className="px-4 py-3">{item.menuName}</td>
                                            <td className="px-4 py-3">{item.category}</td>
                                            <td className="px-4 py-3">{item.portion}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>

                                <div className="rounded-md border border-border bg-surface p-4 lg:col-span-7">
                                  <p className="text-xs text-muted">
                                    {resolutionStatus === 'cancelled'
                                      ? 'Cancelled ingredient summary'
                                      : 'Planned vs actual issuance'}
                                  </p>
                                  <div className="mt-3 max-w-full overflow-x-auto rounded-md border border-border bg-white">
                                    <table className="dm-table min-w-full text-sm">
                                      <thead className="bg-background">
                                        <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                                          <th className="w-12 px-4 py-3 font-semibold">No</th>
                                          <th className="px-4 py-3 font-semibold">Product code</th>
                                          <th className="px-4 py-3 font-semibold">Ingredient name</th>
                                          <th className="px-4 py-3 font-semibold">Planned</th>
                                          <th className="px-4 py-3 font-semibold">Actual</th>
                                          <th className="px-4 py-3 font-semibold">Variance</th>
                                          <th className="px-4 py-3 font-semibold">Unit</th>
                                          <th className="px-4 py-3 font-semibold">Reason</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {resolutionStatus === 'fulfilled' &&
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
                                              <td className="px-4 py-3">{item.name}</td>
                                              <td className="px-4 py-3">
                                                {formatQuantity(item.plannedQty)}
                                              </td>
                                              <td className="px-4 py-3">
                                                {formatQuantity(item.actualQty)}
                                              </td>
                                              <td className="px-4 py-3">
                                                {formatQuantity(item.varianceQty)}
                                              </td>
                                              <td className="px-4 py-3">
                                                {formatUnitLabel(item.unitOfMeasures)}
                                              </td>
                                              <td className="px-4 py-3">{item.reason ?? '-'}</td>
                                            </tr>
                                          ))
                                        ) : summaryItems.length === 0 ? (
                                          <tr className="border-t border-border">
                                            <td
                                              colSpan={8}
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
                                              <td className="px-4 py-3">{item.name}</td>
                                              <td className="px-4 py-3">
                                                {formatQuantity(item.qty)}
                                              </td>
                                              <td className="px-4 py-3">-</td>
                                              <td className="px-4 py-3">-</td>
                                              <td className="px-4 py-3">
                                                {formatUnitLabel(item.unitOfMeasures)}
                                              </td>
                                              <td className="px-4 py-3">-</td>
                                            </tr>
                                          ))
                                        )}
                                      </tbody>
                                    </table>
                                  </div>
                                  <p className="mt-3 text-xs text-muted">
                                    Handled by: {handledByLabel}
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
