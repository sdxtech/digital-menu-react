import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'

type DashboardSummary = {
  summary: {
    menusToday: number
    menusTodayDelta: number
    approvedToday: number
    pendingToday: number
    storeRequestedToday: number
    storeFulfilledToday: number
  }
  priority: Array<{ name: string; status: string; value: string }>
  progress: Array<{ label: string; value: string }>
}

const ChefDashboard = () => {
  const { accessToken } = useAuth()
  const [data, setData] = useState<DashboardSummary | null>(null)
  const [error, setError] = useState('')

  // FRONTEND VIEW: fetch dashboard data from backend.
  const fetchDashboard = useCallback(async () => {
    if (!accessToken) return
    try {
      const response = await apiFetch<DashboardSummary>(
        '/dashboard/chef',
        undefined,
        accessToken,
      )
      setData(response)
      setError('')
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load dashboard data.'
      setError(message)
    }
  }, [accessToken])

  useEffect(() => {
    fetchDashboard().catch(() => null)
  }, [fetchDashboard])

  const summary = data?.summary
  const formatDelta = (value?: number) => {
    if (value === undefined || Number.isNaN(value)) return '0% vs yesterday'
    const sign = value > 0 ? '+' : ''
    return `${sign}${value}% vs yesterday`
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          {error ? (
            <p className="mt-2 text-xs font-medium text-red-600">{error}</p>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-md border border-border bg-surface p-6 shadow-sm">
            <p className="text-xs uppercase tracking-[0.2em] text-muted">
              Menus scheduled today
            </p>
            <p className="mt-3 text-3xl font-semibold">
              {summary?.menusToday ?? 0}
            </p>
            <p className="mt-2 text-xs text-muted">
              {formatDelta(summary?.menusTodayDelta)}
            </p>
          </div>
          <div className="rounded-md border border-border bg-surface p-6 shadow-sm">
            <p className="text-xs uppercase tracking-[0.2em] text-muted">
              Menus approved today
            </p>
            <p className="mt-3 text-3xl font-semibold">
              {summary?.approvedToday ?? 0}
            </p>
            <p className="mt-2 text-xs text-muted">
              Pending {summary?.pendingToday ?? 0} menus
            </p>
          </div>
          <div className="rounded-md border border-border bg-surface p-6 shadow-sm">
            <p className="text-xs uppercase tracking-[0.2em] text-primary">
              Store requests pending
            </p>
            <p className="mt-3 text-3xl font-semibold text-primary">
              {summary?.storeRequestedToday ?? 0}
            </p>
            <p className="mt-2 text-xs text-muted">
              Fulfilled {summary?.storeFulfilledToday ?? 0} menus
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="rounded-md border border-border bg-surface p-6 shadow-sm lg:col-span-7">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted">
                Priority
              </p>
              <h3 className="mt-2 text-lg font-semibold">
                Menus that must be ready
              </h3>
            </div>
            <span className="rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary">
              {data?.priority.length ?? 0} items
            </span>
          </div>
          <div className="mt-6 space-y-4">
            {(data?.priority ?? []).length === 0 ? (
              <div className="rounded-md border border-border bg-background px-4 py-3 text-sm text-muted">
                No menus scheduled for today yet.
              </div>
            ) : (
              (data?.priority ?? []).map((item) => (
                <div
                  key={`${item.name}-${item.value}`}
                  className="flex items-center justify-between rounded-md border border-border bg-background px-4 py-3 text-sm"
                >
                  <div>
                    <p className="font-medium text-foreground">{item.name}</p>
                    <p className="text-xs text-muted">{item.status}</p>
                  </div>
                  <span className="text-xs font-semibold text-primary">
                    {item.value}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-md border border-border bg-surface p-6 shadow-sm lg:col-span-5">
          <p className="text-xs uppercase tracking-[0.2em] text-muted">
            Production progress
          </p>
          <h3 className="mt-2 text-lg font-semibold">
            Today's status
          </h3>
          <div className="mt-6 space-y-4">
            {(data?.progress ?? []).length === 0 ? (
              <div className="rounded-md border border-border bg-background px-4 py-3 text-sm text-muted">
                No progress data yet.
              </div>
            ) : (
              (data?.progress ?? []).map((task) => (
                <div
                  key={task.label}
                  className="rounded-md border border-border bg-background px-4 py-3 text-sm"
                >
                  <p className="font-medium text-foreground">{task.label}</p>
                  <p className="mt-1 text-xs text-muted">{task.value}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default ChefDashboard
