import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'

type SuperadminDashboardData = {
  summary: {
    activeSites: number
    inactiveSites: number
    activeUsers: number
    unassignedUsers: number
    menusToday: number
    pendingApprovals: number
    requestedStoreRequests: number
    fulfilledStoreRequests: number
    pendingRecipes: number
  }
}

const SuperadminDashboardPage = () => {
  const { accessToken } = useAuth()
  const [data, setData] = useState<SuperadminDashboardData | null>(null)
  const [error, setError] = useState('')

  const fetchDashboard = useCallback(async () => {
    if (!accessToken) return

    try {
      const response = await apiFetch<SuperadminDashboardData>(
        '/dashboard/superadmin',
        undefined,
        accessToken,
      )
      setData(response)
      setError('')
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load Quick View data.'
      setError(message)
    }
  }, [accessToken])

  useEffect(() => {
    fetchDashboard().catch(() => null)
  }, [fetchDashboard])

  const summary = data?.summary

  const metricCards = [
    {
      label: 'Active sites',
      value: summary?.activeSites ?? 0,
      icon: 'bi-buildings',
    },
    {
      label: 'Active users',
      value: summary?.activeUsers ?? 0,
      icon: 'bi-people',
    },
    {
      label: 'Menus scheduled today',
      value: summary?.menusToday ?? 0,
      icon: 'bi-calendar2-check',
    },
    {
      label: 'Pending approvals',
      value: summary?.pendingApprovals ?? 0,
      icon: 'bi-hourglass-split',
    },
    {
      label: 'Store requests waiting',
      value: summary?.requestedStoreRequests ?? 0,
      icon: 'bi-box-seam',
    },
    {
      label: 'Pending recipe reviews',
      value: summary?.pendingRecipes ?? 0,
      icon: 'bi-journal-check',
    },
  ]

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Quick View</h1>
            <p className="mt-1 text-sm text-muted">
              Monitor platform activity across users, sites, and production flow.
            </p>
            {error ? (
              <p className="mt-2 text-xs font-medium text-red-600">{error}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => fetchDashboard()}
            className="rounded-md border border-border bg-background px-4 py-2 text-xs font-semibold text-primary"
          >
            <span className="flex items-center gap-2">
              <i className="bi bi-arrow-clockwise text-sm" aria-hidden="true" />
              <span>Refresh</span>
            </span>
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {metricCards.map((card) => (
            <div
              key={card.label}
              className="rounded-md border border-border bg-surface p-6 shadow-sm"
            >
              <p className="text-xs text-foreground">{card.label}</p>
              <div className="mt-3 flex items-center justify-between gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                  <i className={`bi ${card.icon} text-xl`} aria-hidden="true" />
                </div>
                <div className="text-[30px] font-semibold leading-none text-foreground">
                  {card.value}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default SuperadminDashboardPage
