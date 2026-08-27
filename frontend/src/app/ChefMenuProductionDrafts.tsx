import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { MenuProduction } from '../lib/chef-data'

type MenuProductionApi = Omit<MenuProduction, 'id'> & {
  id?: string
  _id?: string
}

const formatUpdatedAt = (value?: string) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

const ChefMenuProductionDrafts = () => {
  const navigate = useNavigate()
  const { accessToken } = useAuth()
  const [items, setItems] = useState<MenuProductionApi[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchDrafts = useCallback(async () => {
    if (!accessToken) return
    setLoading(true)
    setError('')
    try {
      const data = await apiFetch<{ items?: MenuProductionApi[] }>(
        '/menu-productions/drafts',
        undefined,
        accessToken,
      )
      setItems(data.items ?? [])
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Failed to load menu production drafts.',
      )
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  useEffect(() => {
    fetchDrafts().catch(() => null)
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            Menu Production Drafts
          </h1>
          <p className="mt-1 text-sm text-muted">
            Continue production batches that have not been sent to Admin Site.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/chef/menu-cycle')}
          className="rounded-md bg-primary px-4 py-3 text-sm font-semibold text-white hover:bg-primary/90"
        >
          + Create menu production
        </button>
      </div>

      <div className="overflow-hidden rounded-md border border-border bg-surface shadow-sm">
        {error ? <p className="p-5 text-sm text-danger">{error}</p> : null}
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-primary text-white">
              <tr>
                <th className="px-5 py-3">NO</th>
                <th className="px-5 py-3">PRODUCTION CODE</th>
                <th className="px-5 py-3">PRODUCTION DATE</th>
                <th className="px-5 py-3">CLIENT</th>
                <th className="px-5 py-3">MENUS</th>
                <th className="px-5 py-3">LAST UPDATED</th>
                <th className="px-5 py-3">ACTION</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-muted">
                    Loading menu production drafts...
                  </td>
                </tr>
              ) : groups.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-muted">
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
                      <td className="px-5 py-4">{index + 1}</td>
                      <td className="px-5 py-4 font-medium text-foreground">
                        {productionCode}
                      </td>
                      <td className="px-5 py-4">{firstMenu?.productionDate ?? '-'}</td>
                      <td className="px-5 py-4">{firstMenu?.clientName ?? '-'}</td>
                      <td className="px-5 py-4">{menus.length}</td>
                      <td className="px-5 py-4 text-muted">
                        {formatUpdatedAt(lastUpdated)}
                      </td>
                      <td className="px-5 py-4">
                        <button
                          type="button"
                          onClick={() =>
                            navigate('/chef/menu-cycle', {
                              state: {
                                menuProductionDraft: { productionCode, menus },
                              },
                            })
                          }
                          className="rounded-md border border-primary px-3 py-2 text-xs font-semibold text-primary hover:bg-primary-soft"
                        >
                          Continue
                        </button>
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
