import PageHeading from '../components/PageHeading'
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
        err instanceof Error ? err.message : 'Failed to load Quick View data.'
      setError(message)
    }
  }, [accessToken])

  useEffect(() => {
    fetchDashboard().catch(() => null)
  }, [fetchDashboard])

  const summary = data?.summary
  const formatDelta = (value?: number) => {
    if (value === undefined || Number.isNaN(value)) return '0%'
    const sign = value > 0 ? '+' : ''
    return `${sign}${value}%`
  }

  const metrics = [
    {
      label: 'Menus scheduled today',
      value: summary?.menusToday ?? 0,
      detailValue: formatDelta(summary?.menusTodayDelta),
      detailLabel: 'vs yesterday',
      detailIcon: (summary?.menusTodayDelta ?? 0) > 0
        ? 'bi-arrow-up'
        : (summary?.menusTodayDelta ?? 0) < 0 ? 'bi-arrow-down' : 'bi-dash',
      detailTone: (summary?.menusTodayDelta ?? 0) > 0
        ? 'text-success'
        : (summary?.menusTodayDelta ?? 0) < 0 ? 'text-danger' : 'text-muted',
      accent: 'bg-accent-blue',
    },
    {
      label: 'Menus approved today',
      value: summary?.approvedToday ?? 0,
      detailValue: summary?.pendingToday ?? 0,
      detailLabel: 'Menus submitted',
      detailIcon: 'bi-dash',
      detailTone: 'text-muted',
      accent: 'bg-accent-indigo',
    },
    {
      label: 'Store requests pending',
      value: summary?.storeRequestedToday ?? 0,
      detailValue: summary?.storeFulfilledToday ?? 0,
      detailLabel: 'Menus fulfilled',
      detailIcon: 'bi-dash',
      detailTone: 'text-muted',
      accent: 'bg-accent-cyan',
    },
  ]

  return (
    <div className="min-w-0 space-y-4">
      <div className="space-y-1">
        <PageHeading className="text-2xl font-semibold" showBack={false}>Quick View</PageHeading>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg border border-danger bg-surface px-4 py-3 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <section aria-label="Today's key metrics" className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
        <div className="-ml-px -mt-px grid md:grid-cols-3">
          {metrics.map((metric) => (
            <div key={metric.label} className="flex min-w-0 flex-col border-l border-t border-black bg-surface">
              <div className="flex-1 space-y-2 p-2">
                <p className="flex items-start gap-2 text-sm font-medium text-foreground">
                  <span aria-hidden="true" className={`mt-0.5 h-4 w-2 shrink-0 ${metric.accent}`} />
                  {metric.label}
                </p>
                <div className="break-words text-[24px] font-semibold leading-tight tabular-nums text-foreground">
                  {metric.value}
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-border p-2 text-xs leading-5">
                <span className={`inline-flex shrink-0 items-center gap-2 font-normal tabular-nums ${metric.detailTone}`}>
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-background">
                    <i aria-hidden="true" className={`bi ${metric.detailIcon}`} />
                  </span>
                  {metric.detailValue}
                </span>
                <span className="min-w-0 break-words text-right font-normal text-foreground">{metric.detailLabel}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid items-stretch gap-4 lg:grid-cols-2">
        <section aria-labelledby="chef-priority-heading" className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
          <div className="flex min-h-8 items-center justify-between gap-3 border-b border-border p-2 sm:px-4">
            <div className="min-w-0">
              <h2 id="chef-priority-heading" className="text-sm font-semibold text-foreground">
                Priority
              </h2>
              <p className="mt-1 text-xs leading-5 text-muted">
                Menus that must be ready
              </p>
            </div>
            <span className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium tabular-nums text-muted">
              {data?.priority.length ?? 0} items
            </span>
          </div>
          <div className="flex flex-1 flex-col p-4 sm:p-5">
            {(data?.priority ?? []).length === 0 ? (
              <div className="flex min-h-48 flex-1 items-center justify-center rounded-md bg-background p-5 text-center text-sm leading-6 text-muted">
                No menus scheduled for today yet.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {(data?.priority ?? []).map((item) => (
                  <li
                    key={`${item.name}-${item.value}`}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-4 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0 flex-1 basis-40">
                      <p className="break-words text-sm font-medium leading-6 text-foreground">{item.name}</p>
                      <p className="mt-1 break-words text-xs leading-5 text-muted">{item.status}</p>
                    </div>
                    <span className="max-w-full break-words rounded-md bg-primary-soft px-2 py-1 text-xs font-medium leading-5 tabular-nums text-primary">
                      {item.value}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section aria-labelledby="chef-progress-heading" className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
          <div className="flex min-h-8 items-center border-b border-border p-2 sm:px-4">
            <div className="min-w-0">
              <h2 id="chef-progress-heading" className="text-sm font-semibold text-foreground">
                Production progress
              </h2>
              <p className="mt-1 text-xs leading-5 text-muted">
                Today's status
              </p>
            </div>
          </div>
          <div className="flex flex-1 flex-col p-4 sm:p-5">
            {(data?.progress ?? []).length === 0 ? (
              <div className="flex min-h-48 flex-1 items-center justify-center rounded-md bg-background p-5 text-center text-sm leading-6 text-muted">
                No progress data yet.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {(data?.progress ?? []).map((task) => (
                  <li
                    key={task.label}
                    className="min-w-0 py-4 first:pt-0 last:pb-0"
                  >
                    <p className="break-words text-sm font-medium leading-6 text-foreground">{task.label}</p>
                    <p className="mt-1 break-words text-xs leading-5 tabular-nums text-muted">{task.value}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

export default ChefDashboard
