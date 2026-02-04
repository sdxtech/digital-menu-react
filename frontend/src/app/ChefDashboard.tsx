import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'

type DashboardSummary = {
  summary: {
    incomingOrders: number
    incomingOrdersDelta: number
    menusCompleted: number
    targetMenus: number
    avgTimeMinutes: number
    avgTimeDeltaMinutes: number
  }
  priority: Array<{ name: string; status: string; time: string }>
  shiftTimeline: Array<{ label: string; progress: string }>
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

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-muted">
          Dashboard
        </p>
        <h2 className="mt-2 text-2xl font-semibold">Today's Kitchen Summary</h2>
        {error ? (
          <p className="mt-2 text-xs font-medium text-red-600">{error}</p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-muted">
            Incoming orders
          </p>
          <p className="mt-3 text-3xl font-semibold">
            {summary?.incomingOrders ?? 0}
          </p>
          <p className="mt-2 text-xs text-muted">
            {summary?.incomingOrdersDelta ?? 0}% from yesterday
          </p>
        </div>
        <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-muted">
            Menus completed
          </p>
          <p className="mt-3 text-3xl font-semibold">
            {summary?.menusCompleted ?? 0}
          </p>
          <p className="mt-2 text-xs text-muted">
            Target {summary?.targetMenus ?? 0} menus
          </p>
        </div>
        <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-primary">
            Average time
          </p>
          <p className="mt-3 text-3xl font-semibold text-primary">
            {summary?.avgTimeMinutes ?? 0}m
          </p>
          <p className="mt-2 text-xs text-muted">
            {summary?.avgTimeDeltaMinutes ?? 0}m from last shift
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm lg:col-span-7">
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
            {(data?.priority ?? []).map((item) => (
              <div
                key={`${item.name}-${item.time}`}
                className="flex items-center justify-between rounded-2xl border border-border bg-background px-4 py-3 text-sm"
              >
                <div>
                  <p className="font-medium text-foreground">{item.name}</p>
                  <p className="text-xs text-muted">{item.status}</p>
                </div>
                <span className="text-xs font-semibold text-primary">
                  {item.time}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm lg:col-span-5">
          <p className="text-xs uppercase tracking-[0.2em] text-muted">
            Shift timeline
          </p>
          <h3 className="mt-2 text-lg font-semibold">
            Key ingredient prep
          </h3>
          <div className="mt-6 space-y-4">
            {(data?.shiftTimeline ?? []).map((task) => (
              <div
                key={task.label}
                className="rounded-2xl border border-border bg-background px-4 py-3 text-sm"
              >
                <p className="font-medium text-foreground">{task.label}</p>
                <p className="mt-1 text-xs text-muted">{task.progress}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default ChefDashboard
