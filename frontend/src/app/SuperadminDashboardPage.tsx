import PageHeading from '../components/PageHeading'
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
      accent: 'bg-accent-blue',
    },
    {
      label: 'Active users',
      value: summary?.activeUsers ?? 0,
      accent: 'bg-accent-indigo',
    },
    {
      label: 'Menus scheduled today',
      value: summary?.menusToday ?? 0,
      accent: 'bg-accent-cyan',
    },
    {
      label: 'Pending approvals',
      value: summary?.pendingApprovals ?? 0,
      accent: 'bg-accent-blue',
    },
    {
      label: 'Store requests waiting',
      value: summary?.requestedStoreRequests ?? 0,
      accent: 'bg-accent-indigo',
    },
    {
      label: 'Pending recipe reviews',
      value: summary?.pendingRecipes ?? 0,
      accent: 'bg-accent-cyan',
    },
  ]

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <PageHeading className="text-2xl font-semibold" showBack={false}>Quick View</PageHeading>
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

        <section aria-label="Platform key metrics" className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
          <div className="-ml-px -mt-px grid sm:grid-cols-2 md:grid-cols-3">
            {metricCards.map((card) => (
              <div
                key={card.label}
                className="flex min-w-0 flex-col space-y-2 border-l border-t border-black bg-surface p-2"
              >
                <p className="flex items-start gap-2 text-sm font-medium text-foreground">
                  <span aria-hidden="true" className={`mt-0.5 h-4 w-2 shrink-0 ${card.accent}`} />
                  {card.label}
                </p>
                <div className="break-words text-[24px] font-semibold leading-tight tabular-nums text-foreground">
                  {card.value}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

    </div>
  )
}

export default SuperadminDashboardPage
