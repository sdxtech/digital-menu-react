import { useCallback, useEffect, useMemo, useState } from 'react'
import TablePagination from '../components/TablePagination'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'
import { getApprovalStatusLabel } from '../lib/status-labels'

type Menu = {
  id: string
  menuName: string
  approvalStatus: 'pending' | 'approved' | 'rejected'
  sellingPricePerPax?: number
  sellingQuantity?: number
  estimatedRevenue?: number
  reviewedBy?: string
  rejectionReason?: string
}

type Group = {
  date: string
  productionCode?: string
  items: Menu[]
}

const GROUPS_PER_PAGE = 10

const hasSalesDetails = (item: Menu) =>
  Number.isFinite(Number(item.sellingPricePerPax)) &&
  Number.isFinite(Number(item.sellingQuantity))

const formatPrice = (value?: number) =>
  value === undefined || !Number.isFinite(value)
    ? '-'
    : new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        maximumFractionDigits: 0,
      }).format(value)

const AdminSiteMenuProductionHistoryPage = () => {
  const { accessToken } = useAuth()
  const [groups, setGroups] = useState<Group[]>([])
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const fetchHistory = useCallback(async () => {
    if (!accessToken) return
    setLoading(true)
    setError('')
    try {
      const data = await apiFetch<{ items?: Group[] }>(
        '/menu-productions/store-requests',
        undefined,
        accessToken,
      )
      const submitted = (data.items ?? [])
        .filter(
          (group) =>
            group.items.length > 0 && group.items.every(hasSalesDetails),
        )
        .sort((a, b) => b.date.localeCompare(a.date))
      setGroups(submitted)
      setPage(1)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to load history.')
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  useEffect(() => {
    fetchHistory().catch(() => null)
  }, [fetchHistory])

  const visibleGroups = useMemo(
    () => groups.slice((page - 1) * GROUPS_PER_PAGE, page * GROUPS_PER_PAGE),
    [groups, page],
  )
  const totalPages = Math.max(1, Math.ceil(groups.length / GROUPS_PER_PAGE))

  return (
    <section className="space-y-5 pb-10">
      <div>
        <h1 className="text-2xl font-semibold">Menu Production History</h1>
        <p className="mt-1 text-sm text-muted">
          Production batches whose sales details have been submitted to the Unit Manager.
        </p>
        {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
      </div>

      <div className="rounded-md border border-border bg-surface p-6 shadow-sm">
        <TablePagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          summary={`Showing ${visibleGroups.length} of ${groups.length} submitted batches`}
        />
        <div className="mt-4 overflow-x-auto rounded-md border border-border">
          <table className="dm-table min-w-full bg-white text-sm">
            <thead className="bg-background">
              <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                <th className="px-4 py-3">Production date</th>
                <th className="px-4 py-3">Production code</th>
                <th className="px-4 py-3">Menus</th>
                <th className="px-4 py-3">Selling price/pax</th>
                <th className="px-4 py-3">Pax</th>
                <th className="px-4 py-3">Estimated revenue</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Reviewed by</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-muted">Loading history...</td></tr>
              ) : visibleGroups.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-muted">No submitted production history yet.</td></tr>
              ) : (
                visibleGroups.map((group) => {
                  const first = group.items[0]
                  const statuses = Array.from(new Set(group.items.map((item) => item.approvalStatus)))
                  return (
                    <tr key={`${group.date}__${group.productionCode ?? 'no-code'}`} className="border-t border-border">
                      <td className="px-4 py-3">{group.date}</td>
                      <td className="px-4 py-3 font-medium">{group.productionCode ?? '-'}</td>
                      <td className="px-4 py-3">{group.items.length}</td>
                      <td className="px-4 py-3">{formatPrice(first.sellingPricePerPax)}</td>
                      <td className="px-4 py-3">{first.sellingQuantity ?? '-'}</td>
                      <td className="px-4 py-3">{formatPrice(first.estimatedRevenue)}</td>
                      <td className="px-4 py-3">
                        {statuses.map((status) => getApprovalStatusLabel(status)).join(', ')}
                      </td>
                      <td className="px-4 py-3">{first.reviewedBy ?? '-'}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

export default AdminSiteMenuProductionHistoryPage
