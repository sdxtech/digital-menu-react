import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import PageHeading from '../components/PageHeading'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'

type Values = {
  pax: number | null
  estimatedCost: number | null
  estimatedRevenue: number | null
  foodCostPercentage: number | null
}
type Metric = keyof Values
type Interval = 'daily' | 'weekly' | 'monthly'
type Trend = Values & { period: string; batches: number }
type AnalyticsData = {
  summary: Values & { approvedBatches: number; incompleteBatches: number }
  workflow: {
    totalBatches: number
    approval: {
      pendingSales: number
      submitted: number
      approved: number
      returned: number
    }
    storeRequest: {
      requested: number
      fulfilled: number
      cancelled: number
    }
  }
  trend: Trend[]
  sites: Array<{ code: string; name: string }>
}
type Filters = {
  startDate: string
  endDate: string
  site: string
  clientId: string
  interval: Interval
}

const numberFormat = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
})
const compactFormat = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})
const format = (value: number | null, metric?: Metric) =>
  value === null
    ? '—'
    : metric === 'foodCostPercentage'
      ? `${value.toFixed(2)}%`
      : numberFormat.format(value)

const initialFilters = (): Filters => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  const endDate = `${value('year')}-${value('month')}-${value('day')}`
  return {
    startDate: `${endDate.slice(0, 7)}-01`,
    endDate,
    site: '',
    clientId: '',
    interval: 'daily',
  }
}

const metrics: Array<{
  key: Metric
  label: string
  color: string
}> = [
  {
    key: 'foodCostPercentage',
    label: 'Food Cost %',
    color: '#2563eb',
  },
  { key: 'pax', label: 'Pax Calculation', color: '#7c3aed' },
  {
    key: 'estimatedCost',
    label: 'Estimated Cost',
    color: '#ea580c',
  },
  {
    key: 'estimatedRevenue',
    label: 'Estimated Revenue',
    color: '#059669',
  },
]

const TrendChart = ({
  points,
  metric,
  color,
  interval,
}: {
  points: Trend[]
  metric: Metric
  color: string
  interval: Interval
}) => {
  const valid = points.filter(
    (point) => point.batches > 0 && point[metric] !== null,
  )
  if (!valid.length)
    return (
      <p className="flex h-52 items-center justify-center text-sm text-muted">
        No approved data available.
      </p>
    )
  const isBarChart = metric === 'pax'
  const upperBound =
    Math.max(1, ...valid.map((point) => point[metric] ?? 0)) * 1.1
  const max = isBarChart ? Math.ceil(upperBound / 2) * 2 : upperBound
  const barWidth = Math.min(40, (520 / points.length) * 0.7)
  const x = (index: number) =>
    isBarChart
      ? 70 + ((index + 0.5) / points.length) * 520
      : 70 + (points.length > 1 ? index / (points.length - 1) : 0.5) * 520
  const y = (value: number) => 170 - (value / max) * 145
  const path = points
    .map((point, index) => {
      const value = point[metric]
      if (value === null || !point.batches) return ''
      const previous = points[index - 1]
      const command =
        previous && previous.batches > 0 && previous[metric] !== null
          ? 'L'
          : 'M'
      return `${command}${x(index)},${y(value)}`
    })
    .join(' ')
  const label = (period: string) =>
    interval === 'monthly' ? period : period.slice(5)
  const ticks = [
    ...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]),
  ]
  return (
    <svg
      viewBox="0 0 620 210"
      className="mt-3 w-full"
      role="img"
      aria-label={`${metrics.find((item) => item.key === metric)?.label} ${isBarChart ? 'bar chart' : 'trend'}`}
    >
      {[0, 0.5, 1].map((ratio) => (
        <g key={ratio}>
          <line
            x1="70"
            x2="590"
            y1={y(max * ratio)}
            y2={y(max * ratio)}
            stroke="currentColor"
            className="text-border"
          />
          <text
            x="60"
            y={y(max * ratio) + 4}
            textAnchor="end"
            fontSize="11"
            fill="currentColor"
            className="text-muted"
          >
            {compactFormat.format(max * ratio)}
            {metric === 'foodCostPercentage' ? '%' : ''}
          </text>
        </g>
      ))}
      {!isBarChart ? (
        <path d={path} stroke={color} strokeWidth="2.5" fill="none" />
      ) : null}
      {points.map((point, index) =>
        point[metric] !== null && point.batches > 0 ? (
          isBarChart ? (
            <rect
              key={point.period}
              x={x(index) - barWidth / 2}
              y={y(point[metric])}
              width={barWidth}
              height={170 - y(point[metric])}
              fill={color}
            >
              <title>
                {point.period}: {format(point[metric], metric)}
              </title>
            </rect>
          ) : (
            <circle
              key={point.period}
              cx={x(index)}
              cy={y(point[metric])}
              r="3"
              fill={color}
            >
              <title>
                {point.period}: {format(point[metric], metric)}
              </title>
            </circle>
          )
        ) : null,
      )}
      {ticks.map((index) => (
        <text
          key={index}
          x={x(index)}
          y="195"
          textAnchor="middle"
          fontSize="11"
          fill="currentColor"
          className="text-muted"
        >
          {label(points[index].period)}
        </text>
      ))}
    </svg>
  )
}

const SuperadminAnalyticsPage = () => {
  const { accessToken } = useAuth()
  const [filters, setFilters] = useState<Filters>(initialFilters)
  const [applied, setApplied] = useState<Filters>(filters)
  const [refresh, setRefresh] = useState(0)
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filterError, setFilterError] = useState('')
  const [clientOptions, setClientOptions] = useState<{
    site: string
    items: Array<{ clientId: string; name: string }>
  } | null>(null)
  const [clientError, setClientError] = useState('')

  useEffect(() => {
    if (!accessToken) return
    let active = true
    const controller = new AbortController()
    const loadClients = async () => {
      type ClientResponse = {
        items: Array<{ clientId: string; name: string }>
        totalPages?: number
      }
      const options = { signal: controller.signal }
      if (filters.site) {
        return (
          await apiFetch<ClientResponse>(
            `/clients/by-site/${encodeURIComponent(filters.site)}`,
            options,
            accessToken,
          )
        ).items
      }
      const first = await apiFetch<ClientResponse>(
        '/superadmin/clients?limit=100&page=1',
        options,
        accessToken,
      )
      const items = [...first.items]
      for (let page = 2; page <= (first.totalPages ?? 1); page++) {
        const response = await apiFetch<ClientResponse>(
          `/superadmin/clients?limit=100&page=${page}`,
          options,
          accessToken,
        )
        items.push(...response.items)
      }
      return items
    }
    loadClients()
      .then((items) => {
        if (active) {
          setClientOptions({ site: filters.site, items })
          setClientError('')
        }
      })
      .catch((err: unknown) => {
        if (active)
          setClientError(
            err instanceof Error ? err.message : 'Failed to load clients.',
          )
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [accessToken, filters.site, refresh])

  useEffect(() => {
    if (!accessToken) return
    let active = true
    const controller = new AbortController()
    const params = new URLSearchParams({
      ...applied,
    })
    apiFetch<AnalyticsData>(
      `/dashboard/superadmin/analytics?${params}`,
      { signal: controller.signal },
      accessToken,
    )
      .then((response) => {
        if (active) setData(response)
      })
      .catch((err: unknown) => {
        if (active)
          setError(
            err instanceof Error ? err.message : 'Failed to load analytics.',
          )
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [accessToken, applied, refresh])

  const beginLoading = () => {
    setLoading(true)
    setError('')
  }
  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const days =
      (Date.parse(filters.endDate) - Date.parse(filters.startDate)) / 86400000
    if (!Number.isFinite(days) || days < 0 || days > 365) {
      setFilterError(
        'Select a date range of up to 366 days in chronological order.',
      )
      return
    }
    setFilterError('')
    beginLoading()
    setApplied({ ...filters })
  }
  const inputClass =
    'mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm'
  const workflowCards = data
    ? [
        {
          title: 'Production Approval Status',
          icon: 'bi-clipboard-check',
          values: [
            ['Submitted', data.workflow.approval.submitted],
            ['Pending (Sales Input)', data.workflow.approval.pendingSales],
            ['Approved', data.workflow.approval.approved],
            ['Rejected', data.workflow.approval.returned],
          ] as const,
        },
        {
          title: 'Store Request Status',
          icon: 'bi-box-seam',
          values: [
            ['Requested', data.workflow.storeRequest.requested],
            ['Completed', data.workflow.storeRequest.fulfilled],
            ['Cancelled', data.workflow.storeRequest.cancelled],
          ] as const,
        },
      ]
    : []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <PageHeading className="text-2xl font-semibold" showBack={false}>
            Dynamic Analytics Dashboard
          </PageHeading>
          <p className="mt-1 text-sm text-muted">
            Monitor approved production costs, sales, and pax across sites.
          </p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => {
            beginLoading()
            setRefresh((value) => value + 1)
          }}
          className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-semibold text-primary disabled:opacity-50"
        >
          <i className="bi bi-arrow-clockwise mr-2" aria-hidden="true" />
          Refresh
        </button>
      </div>

      <form
        onSubmit={applyFilters}
        className="overflow-x-auto rounded-md border border-border bg-surface p-4 shadow-sm"
      >
        <div className="grid min-w-[960px] grid-cols-[1fr_1fr_1.5fr_1.5fr_1fr_auto] items-end gap-3">
          <label className="text-xs font-semibold">
            From date
            <input
              type="date"
              required
              value={filters.startDate}
              onChange={(event) =>
                setFilters({ ...filters, startDate: event.target.value })
              }
              className={inputClass}
            />
          </label>
          <label className="text-xs font-semibold">
            To date
            <input
              type="date"
              required
              value={filters.endDate}
              onChange={(event) =>
                setFilters({ ...filters, endDate: event.target.value })
              }
              className={inputClass}
            />
          </label>
          <label className="text-xs font-semibold">
            Site
            <select
              value={filters.site}
              onChange={(event) => {
                setFilters({
                  ...filters,
                  site: event.target.value,
                  clientId: '',
                })
                setClientOptions(null)
                setClientError('')
              }}
              className={inputClass}
            >
              <option value="">All sites</option>
              {data?.sites.map((site) => (
                <option key={site.code} value={site.code}>
                  {site.code} · {site.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold">
            Client
            <select
              value={filters.clientId}
              disabled={
                clientOptions?.site !== filters.site || Boolean(clientError)
              }
              onChange={(event) =>
                setFilters({ ...filters, clientId: event.target.value })
              }
              className={`${inputClass} disabled:opacity-50`}
            >
              <option value="">
                {clientOptions?.site === filters.site
                  ? 'All clients'
                  : clientError
                    ? 'Clients unavailable'
                    : 'Loading clients…'}
              </option>
              {clientOptions?.site === filters.site
                ? clientOptions.items.map((client) => (
                    <option key={client.clientId} value={client.clientId}>
                      {client.clientId} · {client.name}
                    </option>
                  ))
                : null}
            </select>
          </label>
          <label className="text-xs font-semibold">
            Interval
            <select
              value={filters.interval}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  interval: event.target.value as Interval,
                })
              }
              className={inputClass}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          <button
            type="submit"
            disabled={loading}
            className="whitespace-nowrap rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Apply filters
          </button>
        </div>
        {filterError ? (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {filterError}
          </p>
        ) : null}
        {clientError ? (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {clientError}
          </p>
        ) : null}
      </form>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {error} Use Refresh to try again.
        </p>
      ) : null}
      {loading ? (
        <p role="status" className="py-12 text-center text-sm text-muted">
          Loading analytics…
        </p>
      ) : null}
      {!loading && !error && data ? (
        <>
          <div className="flex gap-4 overflow-x-auto pb-1">
            {metrics.map((metric) => (
              <div
                key={metric.key}
                className="min-w-[210px] flex-1 rounded-md border border-border bg-surface p-2 shadow-sm"
              >
                <p className="text-sm font-bold">
                  {metric.key === 'foodCostPercentage'
                    ? 'Average Food Cost %'
                    : `Total ${metric.label}`}
                </p>
                <p className="mt-2 break-words text-2xl font-semibold tabular-nums">
                  {format(data.summary[metric.key], metric.key)}
                </p>
              </div>
            ))}
          </div>
          {data.summary.incompleteBatches > 0 ? (
            <p
              role="status"
              className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
            >
              {data.summary.incompleteBatches} approved batch(es) have
              incomplete or inconsistent cost/sales data. Affected totals appear
              as —.
            </p>
          ) : null}

          <section className="space-y-3">
            <div className="grid gap-4 lg:grid-cols-2">
              {workflowCards.map((card) => (
                <div
                  key={card.title}
                  className="rounded-md border border-border bg-surface p-5 shadow-sm"
                >
                  <h3 className="flex items-center gap-2 font-semibold">
                    <i
                      className={`bi ${card.icon} text-primary`}
                      aria-hidden="true"
                    />
                    {card.title}
                  </h3>
                  <dl className="mt-4 space-y-3 text-sm">
                    {card.values.map(([label, value]) => (
                      <div key={label} className="flex justify-between gap-4">
                        <dt className="text-muted">{label}</dt>
                        <dd className="font-semibold tabular-nums">
                          {numberFormat.format(value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold">
                {applied.interval === 'daily'
                  ? 'Daily'
                  : applied.interval === 'weekly'
                    ? 'Weekly'
                    : 'Monthly'}{' '}
                trends
              </h2>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {metrics.map((metric) => (
                <div
                  key={metric.key}
                  className="min-w-0 rounded-md border border-border bg-surface p-4 shadow-sm"
                >
                  <h3 className="text-sm font-semibold">{metric.label}</h3>
                  <TrendChart
                    points={data.trend}
                    metric={metric.key}
                    color={metric.color}
                    interval={applied.interval}
                  />
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}

export default SuperadminAnalyticsPage
