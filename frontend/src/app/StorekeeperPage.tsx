import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useChefData } from '../lib/chef-data'
import { formatUnitLabel } from '../lib/unit-of-measures'
import { useAuth } from '../lib/auth'

type StoreRequestIngredient = {
  productCode: string
  name: string
  unitOfMeasures: string
  qty: number
}

type StoreRequestMenu = {
  id: string
  menuName: string
  category: string
  portion: number
}

type StoreRequestGroup = {
  date: string
  items: StoreRequestMenu[]
  summary: StoreRequestIngredient[]
  missingRecipes: string[]
}

const StorekeeperPage = () => {
  const { accessToken } = useAuth()
  const { markStoreFulfilled } = useChefData()
  const [loadError, setLoadError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [groups, setGroups] = useState<StoreRequestGroup[]>([])
  const [loading, setLoading] = useState(false)

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

  const formatQuantity = (value: number) => {
    if (!Number.isFinite(value)) return '0'
    if (Number.isInteger(value)) return String(value)
    return value.toFixed(3).replace(/\.?0+$/, '')
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
        <p className="text-xs uppercase tracking-[0.3em] text-muted">
          Store Request
        </p>
        <h2 className="mt-2 text-xl font-semibold">
          Production menus to prepare
        </h2>
        <p className="mt-3 text-sm text-muted">
          This data is auto-added after Unit Manager approval.
        </p>
        {loadError ? (
          <p className="mt-3 text-xs font-medium text-red-600">{loadError}</p>
        ) : null}
        {actionMessage ? (
          <p className="mt-3 text-xs font-medium text-primary">{actionMessage}</p>
        ) : null}
      </div>

      {loading ? (
        <div className="rounded-3xl border border-border bg-surface p-6 text-sm text-muted shadow-sm">
          Loading store requests...
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-3xl border border-border bg-surface p-6 text-sm text-muted shadow-sm">
          No production menus in store request yet.
        </div>
      ) : (
        groups.map((group) => (
          <div
            key={group.date}
            className="rounded-3xl border border-border bg-surface p-6 shadow-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-muted">
                  Production date
                </p>
                <h3 className="mt-2 text-lg font-semibold">{group.date}</h3>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold text-primary">
                  {group.items.length} menus
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    setActionMessage('')
                    setLoadError('')
                    try {
                      await Promise.all(
                        group.items.map((menu) => markStoreFulfilled(menu.id)),
                      )
                      setActionMessage(
                        `Ingredient issuance for ${group.date} completed.`,
                      )
                      fetchStoreRequests().catch(() => null)
                    } catch (error) {
                      const message =
                        error instanceof Error
                          ? error.message
                          : 'Failed to complete ingredient issuance.'
                      setLoadError(message)
                    }
                  }}
                  className="rounded-2xl bg-primary px-4 py-2 text-xs font-semibold text-white shadow-sm"
                >
                  Complete & send to kitchen
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-12">
              <div className="rounded-2xl border border-border bg-background p-4 lg:col-span-5">
                <p className="text-xs uppercase tracking-[0.2em] text-muted">
                  Menu list
                </p>
                <div className="mt-3 overflow-x-auto rounded-2xl border border-border bg-white">
                  <table className="min-w-full text-sm">
                    <thead className="bg-background">
                      <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                        <th className="w-12 px-4 py-3 font-semibold">No</th>
                        <th className="px-4 py-3 font-semibold">Menu</th>
                        <th className="px-4 py-3 font-semibold">Category</th>
                        <th className="px-4 py-3 font-semibold">Portion</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map((menu, index) => (
                        <tr key={menu.id} className="border-t border-border">
                          <td className="px-4 py-3 text-sm text-muted">
                            {index + 1}
                          </td>
                          <td className="px-4 py-3">{menu.menuName}</td>
                          <td className="px-4 py-3">{menu.category}</td>
                          <td className="px-4 py-3">{menu.portion}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {group.missingRecipes.length > 0 ? (
                  <p className="mt-3 text-xs text-danger">
                    Recipe not found for: {group.missingRecipes.join(', ')}
                  </p>
                ) : null}
              </div>

              <div className="rounded-2xl border border-border bg-background p-4 lg:col-span-7">
                <p className="text-xs uppercase tracking-[0.2em] text-muted">
                  Ingredient summary
                </p>
                <div className="mt-3 overflow-x-auto rounded-2xl border border-border bg-white">
                  <table className="min-w-full text-sm">
                    <thead className="bg-background">
                      <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                        <th className="w-12 px-4 py-3 font-semibold">No</th>
                        <th className="px-4 py-3 font-semibold">Product code</th>
                        <th className="px-4 py-3 font-semibold">
                          Ingredient name
                        </th>
                        <th className="px-4 py-3 font-semibold">Qty</th>
                        <th className="px-4 py-3 font-semibold">Unit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.summary.length === 0 ? (
                        <tr className="border-t border-border">
                          <td
                            colSpan={5}
                            className="px-4 py-6 text-center text-muted"
                          >
                            No ingredients available to calculate.
                          </td>
                        </tr>
                      ) : (
                        group.summary.map((item, index) => (
                          <tr
                            key={`${item.productCode}-${item.unitOfMeasures}`}
                            className="border-t border-border"
                          >
                            <td className="px-4 py-3 text-sm text-muted">
                              {index + 1}
                            </td>
                            <td className="px-4 py-3">{item.productCode}</td>
                            <td className="px-4 py-3">{item.name}</td>
                            <td className="px-4 py-3">
                              {formatQuantity(item.qty)}
                            </td>
                            <td className="px-4 py-3">
                              {formatUnitLabel(item.unitOfMeasures)}
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
        ))
      )}
    </div>
  )
}

export default StorekeeperPage
