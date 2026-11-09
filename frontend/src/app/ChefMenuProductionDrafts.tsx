import TablePagination from '../components/TablePagination'
import PageHeading from '../components/PageHeading'
import { formatCreatedDate, formatProductionDate } from '../lib/date-format'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { MenuProduction } from '../lib/chef-data'

type MenuProductionApi = Omit<MenuProduction, 'id'> & {
  id?: string
  _id?: string
}

const ChefMenuProductionDrafts = () => {
  const navigate = useNavigate()
  const { accessToken, user } = useAuth()
  const isSuperadmin = user?.role === 'superadmin'
  const columnCount = isSuperadmin ? 9 : 7
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [items, setItems] = useState<MenuProductionApi[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const draftRequestId = useRef(0)
  const [deletingCode, setDeletingCode] = useState<string | null>(null)

  const fetchDrafts = useCallback(async (signal?: AbortSignal) => {
    const requestId = ++draftRequestId.current
    if (!accessToken) return
    setLoading(true)
    setError('')
    try {
      const data = await apiFetch<{ items?: MenuProductionApi[]; total: number }>(
        `/menu-productions/drafts?page=${page}&limit=10`,
        { signal },
        accessToken,
      )
      if (requestId !== draftRequestId.current || signal?.aborted) return
      setItems(data.items ?? [])
      setTotal(data.total)
      setPage((current) => Math.min(current, Math.max(1, Math.ceil(data.total / 10))))
    } catch (reason) {
      if (requestId !== draftRequestId.current || signal?.aborted) return
      setItems([])
      setError(
        reason instanceof Error
          ? reason.message
          : 'Failed to load menu production drafts.',
      )
    } finally {
      if (requestId === draftRequestId.current && !signal?.aborted) setLoading(false)
    }
  }, [accessToken, page])

  useEffect(() => {
    const controller = new AbortController()
    fetchDrafts(controller.signal).catch(() => null)
    return () => controller.abort()
  }, [fetchDrafts])

  const groups = useMemo(() => {
    const byCode = new Map<string, MenuProductionApi[]>()
    items.forEach((item) => {
      const code = item.productionCode?.trim()
      if (!code) return
      byCode.set(code, [...(byCode.get(code) ?? []), item])
    })
    return Array.from(byCode.entries())
  }, [items])

  const deleteDraft = async (productionCode: string) => {
    if (!accessToken || deletingCode) return
    if (!window.confirm(`Delete production draft "${productionCode}" and all its menus?`)) return
    setDeletingCode(productionCode)
    setError('')
    try {
      await apiFetch(
        `/menu-productions/drafts/${encodeURIComponent(productionCode)}`,
        { method: 'DELETE' },
        accessToken,
      )
      await fetchDrafts()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to delete menu production draft.')
    } finally {
      setDeletingCode(null)
    }
  }

  return (
    <div className="space-y-2">
      <div>
        <PageHeading className="text-2xl font-semibold text-foreground">
          Menu Production Drafts
        </PageHeading>
      </div>

      <div className="rounded-md border border-border bg-surface shadow-sm">
        {!isSuperadmin ? (
          <div className="flex flex-wrap items-center justify-end gap-3 border-b border-border px-5 py-4">
            <button
              type="button"
              onClick={() => navigate('/chef/menu-cycle')}
              className="rounded-md bg-primary px-4 py-3 text-sm font-semibold text-white hover:bg-primary/90"
            >
              + Create menu production
            </button>
          </div>
        ) : null}
        <TablePagination page={page} totalPages={Math.max(1, Math.ceil(total / 10))} onPageChange={setPage} loading={loading}
          summary={`Showing ${groups.length} of ${total} production drafts`} className="border-b border-border px-5 py-4" />
        {error ? <p className="p-5 text-sm text-danger">{error}</p> : null}
        <div className="overflow-x-auto">
          <table className="dm-table min-w-full bg-white text-sm">
            <thead className="bg-background">
              <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                <th className="w-[48px] px-2 py-3 text-center font-semibold">No</th>
                <th className="px-4 py-3 font-semibold">Production Code</th>
                <th className="px-4 py-3 font-semibold">Production Date</th>
                <th className="px-4 py-3 font-semibold">Client</th>
                {isSuperadmin ? <th className="px-4 py-3 font-semibold">Site</th> : null}
                {isSuperadmin ? <th className="px-4 py-3 font-semibold">Owner</th> : null}
                <th className="px-4 py-3 font-semibold">Menus</th>
                <th className="px-4 py-3 font-semibold">Last Updated</th>
                <th className="px-4 py-3 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={columnCount} className="px-5 py-10 text-center text-muted">
                    Loading menu production drafts...
                  </td>
                </tr>
              ) : groups.length === 0 ? (
                <tr>
                  <td colSpan={columnCount} className="px-5 py-10 text-center text-muted">
                    No menu production drafts yet.
                  </td>
                </tr>
              ) : (
                groups.map(([productionCode, menus], index) => {
                  const firstMenu = menus[0]
                  const lastUpdated = menus.reduce<string | undefined>(
                    (latest, menu) =>
                      !latest || (menu.updatedAt ?? '') > latest
                        ? menu.updatedAt
                        : latest,
                    undefined,
                  )
                  return (
                    <tr key={productionCode} className="border-t border-border">
                      <td className="px-2 py-3 text-center text-muted">{(page - 1) * 10 + index + 1}</td>
                      <td className="px-4 py-3 text-muted">
                        {productionCode}
                      </td>
                      <td className="px-4 py-3">{formatProductionDate(firstMenu?.productionDate)}</td>
                      <td className="px-4 py-3">{firstMenu?.clientName ?? '-'}</td>
                      {isSuperadmin ? <td className="px-4 py-3">{firstMenu?.site ?? '-'}</td> : null}
                      {isSuperadmin ? <td className="px-4 py-3">{firstMenu?.createdByName || firstMenu?.createdBy || '-'}</td> : null}
                      <td className="px-4 py-3">{menus.length}</td>
                      <td className="px-4 py-3 text-muted">
                        {formatCreatedDate(lastUpdated)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={deletingCode !== null}
                            onClick={() =>
                              navigate(isSuperadmin ? '/superadmin/menu-management?tab=menu-production' : '/chef/menu-cycle', {
                                state: {
                                  menuProductionDraft: { productionCode, menus },
                                },
                              })
                            }
                            className="rounded-md border border-primary px-3 py-2 text-xs font-semibold text-primary hover:bg-primary-soft disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Continue
                          </button>
                          <button
                            type="button"
                            disabled={deletingCode !== null}
                            onClick={() => void deleteDraft(productionCode)}
                            className="inline-flex items-center gap-2 rounded-md border border-red-600 bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <i className="bi bi-trash3" aria-hidden="true" />
                            {deletingCode === productionCode ? 'Deleting...' : 'Delete'}
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
      </div>
    </div>
  )
}

export default ChefMenuProductionDrafts
