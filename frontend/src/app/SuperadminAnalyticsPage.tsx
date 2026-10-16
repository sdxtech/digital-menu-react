import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
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
type ClientPax = { clientKey: string; client: string; pax: number | null }
type Trend = Values & {
  period: string
  batches: number
  paxByClient: ClientPax[]
}
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

const buildPaxSeries = (points: Trend[], topClientsOnly: boolean) => {
  const clients = new Map<string, { label: string; total: number }>()
  for (const point of points) {
    if (!point.batches) continue
    for (const client of point.paxByClient ?? []) {
      const current = clients.get(client.clientKey)
      clients.set(client.clientKey, {
        label: client.client,
        total: (current?.total ?? 0) + (client.pax ?? 0),
      })
    }
  }
  const ranked = [...clients].sort(([keyA, a], [keyB, b]) =>
    (topClientsOnly ? b.total - a.total : 0) || keyA.localeCompare(keyB),
  )
  const visible = topClientsOnly ? ranked.slice(0, 3) : ranked
  const result = visible.map(([key, client], index) => ({
    key,
    label: client.label,
    color: `hsl(${(index * 137.508 + 265) % 360}, 65%, 48%)`,
    value: (point: Trend) => {
      if (!point.batches) return null
      const entry = (point.paxByClient ?? []).find((item) => item.clientKey === key)
      return entry ? entry.pax : 0
    },
  }))
  if (topClientsOnly && ranked.length > 3) {
    const otherKeys = new Set(ranked.slice(3).map(([key]) => key))
    result.push({
      key: 'others',
      label: 'Others',
      color: '#64748b',
      value: (point: Trend) => {
        if (!point.batches) return null
        const others = (point.paxByClient ?? []).filter((item) => otherKeys.has(item.clientKey))
        return others.some((item) => item.pax === null)
          ? null
          : others.reduce((total, item) => total + (item.pax ?? 0), 0)
      },
    })
  }
  return result
}

const orderPaxSeries = (series: ReturnType<typeof buildPaxSeries>, point: Trend) =>
  [...series].sort((a, b) => {
    if (a.key === 'others') return 1
    if (b.key === 'others') return -1
    return (b.value(point) ?? -1) - (a.value(point) ?? -1) || a.key.localeCompare(b.key)
  })

const TrendChart = ({
  points,
  series,
  interval,
  topClientsOnly,
}: {
  points: Trend[]
  series: typeof metrics
  interval: Interval
  topClientsOnly: boolean
}) => {
  const metric = series[0].key
  const isBarChart = series.length === 1 && metric === 'pax'
  const chartSizeClass = series.length > 1
    ? 'mb-6 h-[420px] md:h-[480px]'
    : 'h-72'
  const chartSeries = isBarChart
    ? buildPaxSeries(points, topClientsOnly)
    : series.map((item) => ({
        ...item,
        value: (point: Trend) => point[item.key],
      }))
  const chartData = points.map((point) => ({
    ...point,
    pax: point.batches > 0 ? point.pax : null,
    foodCostPercentage: point.batches > 0 ? point.foodCostPercentage : null,
    estimatedCost: point.batches > 0 ? point.estimatedCost : null,
    estimatedRevenue: point.batches > 0 ? point.estimatedRevenue : null,
    paxStack: isBarChart && topClientsOnly
      ? orderPaxSeries(chartSeries, point).reverse().map((item) => ({
          key: item.key,
          color: item.color,
          value: item.value(point),
        }))
      : [],
  }))
  if (!chartData.some((point) => chartSeries.some((item) => item.value(point) !== null)))
    return (
      <p className={`flex items-center justify-center text-sm text-muted ${chartSizeClass}`}>
        No approved data available.
      </p>
    )

  const Chart = isBarChart ? BarChart : LineChart
  return (
    <div
      className={`mt-4 min-w-0 text-xs text-muted ${chartSizeClass}`}
      role="img"
      aria-label={`${series.map((item) => item.label).join(' and ')} ${isBarChart ? 'stacked bar chart by client' : 'trend'}`}
    >
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <Chart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid
            stroke="currentColor"
            className="text-border"
            strokeDasharray="3 3"
            vertical={false}
          />
          <XAxis
            dataKey="period"
            tickFormatter={(period: string) =>
              interval === 'monthly' ? period : period.slice(5)
            }
            minTickGap={32}
            tickLine={false}
            stroke="currentColor"
          />
          <YAxis
            width={64}
            tickFormatter={(value: number) =>
              `${compactFormat.format(value)}${metric === 'foodCostPercentage' ? '%' : ''}`
            }
            allowDecimals={metric !== 'pax'}
            tickLine={false}
            axisLine={false}
            stroke="currentColor"
          />
          <Tooltip
            shared
            filterNull={false}
            cursor={isBarChart
              ? { fill: 'currentColor', fillOpacity: 0.06 }
              : { stroke: 'currentColor', strokeDasharray: '3 3' }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const point = chartData.find((item) => item.period === label)
              if (!point) return null
              const tooltipSeries = isBarChart && topClientsOnly
                ? orderPaxSeries(chartSeries, point)
                : chartSeries
              return (
                <div className="rounded-md border border-border bg-surface p-3 text-sm text-foreground shadow-md">
                  <p className="mb-2 font-semibold">{String(label)}</p>
                  {tooltipSeries.map((item) => (
                    <p key={item.key} className="flex justify-between gap-6">
                      <span style={{ color: item.color }}>{item.label}</span>
                      <span className="font-semibold tabular-nums">
                        {item.value(point) !== null &&
                        (item.key === 'estimatedCost' || item.key === 'estimatedRevenue')
                          ? 'Rp '
                          : ''}
                        {format(item.value(point), metric)}
                      </span>
                    </p>
                  ))}
                  {isBarChart ? (
                    <p className="mt-2 flex justify-between gap-6 border-t border-border pt-2 font-semibold">
                      <span>Total pax</span>
                      <span className="tabular-nums">{format(point.pax)}</span>
                    </p>
                  ) : null}
                </div>
              )
            }}
          />
          {isBarChart || series.length > 1 ? (
            <Legend
              wrapperStyle={{ paddingTop: 12 }}
              content={() => (
                <ul className={`flex flex-wrap justify-center gap-y-1 ${isBarChart ? 'gap-x-4' : 'gap-x-6 text-base font-bold'}`}>
                  {chartSeries.map((item) => (
                    <li key={item.key} className={`flex items-center ${isBarChart ? 'gap-1.5' : 'gap-2'}`}>
                      <span
                        className={isBarChart ? 'h-2.5 w-2.5' : 'h-1 w-10 rounded-full'}
                        style={{ backgroundColor: item.color }}
                        aria-hidden="true"
                      />
                      <span style={isBarChart ? undefined : { color: item.color }}>{item.label}</span>
                    </li>
                  ))}
                </ul>
              )}
            />
          ) : null}
          {chartSeries.map((item, index) => isBarChart ? (
            <Bar
              key={topClientsOnly ? `pax-rank-${index}` : item.key}
              dataKey={topClientsOnly
                ? (point: (typeof chartData)[number]) => point.paxStack[index]?.value ?? null
                : item.value}
              stackId="pax"
              name={topClientsOnly ? undefined : item.label}
              fill={item.color}
              maxBarSize={40}
              isAnimationActive={false}
            >
              {topClientsOnly ? chartData.map((point) => (
                <Cell key={point.period} fill={point.paxStack[index]?.color ?? item.color} />
              )) : null}
            </Bar>
          ) : (
            <Line
              key={item.key}
              dataKey={item.key}
              name={item.label}
              type="monotone"
              stroke={item.color}
              strokeWidth={2.5}
              dot={{ r: 2 }}
              activeDot={{ r: 5 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </Chart>
      </ResponsiveContainer>
    </div>
  )
}

const SuperadminAnalyticsPage = () => {
  const { accessToken } = useAuth()
  const [filters, setFilters] = useState<Filters>(initialFilters)
  const [applied, setApplied] = useState<Filters>(filters)
  const [filterError, setFilterError] = useState('')
  const clientsQuery = useQuery({
    queryKey: ['analytics', 'clients', filters.site],
    enabled: Boolean(accessToken),
    queryFn: async ({ signal }) => {
      type ClientResponse = {
        items: Array<{ clientId: string; name: string }>
        totalPages?: number
      }
      if (filters.site) {
        const response = await apiFetch<ClientResponse>(
          `/clients/by-site/${encodeURIComponent(filters.site)}`,
          { signal },
          accessToken ?? undefined,
        )
        return { site: filters.site, items: response.items }
      }
      const first = await apiFetch<ClientResponse>(
        '/superadmin/clients?limit=100&page=1',
        { signal },
        accessToken ?? undefined,
      )
      const items = [...first.items]
      for (let page = 2; page <= (first.totalPages ?? 1); page++) {
        const response = await apiFetch<ClientResponse>(
          `/superadmin/clients?limit=100&page=${page}`,
          { signal },
          accessToken ?? undefined,
        )
        items.push(...response.items)
      }
      return { site: filters.site, items }
    },
  })
  const analyticsQuery = useQuery({
    queryKey: ['analytics', 'superadmin', applied],
    enabled: Boolean(accessToken),
    queryFn: ({ signal }) =>
      apiFetch<AnalyticsData>(
        `/dashboard/superadmin/analytics?${new URLSearchParams({ ...applied })}`,
        { signal },
        accessToken ?? undefined,
      ),
  })
  const data = analyticsQuery.data
  const loading = analyticsQuery.isPending || analyticsQuery.isFetching
  const error = analyticsQuery.error?.message ?? ''
  const clientOptions = clientsQuery.data
  const clientError = clientsQuery.error?.message ?? ''
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
    if (Object.keys(filters).every(
      (key) => filters[key as keyof Filters] === applied[key as keyof Filters],
    )) {
      void analyticsQuery.refetch()
    } else {
      setApplied({ ...filters })
    }
  }
  const inputClass =
    'mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm'
  const workflowCards = data
    ? [
        {
          title: 'Production Approval Status',
          icon: 'bi-clipboard-check',
          values: [
            ['Submitted', data.workflow.approval.submitted, 'bg-gray-100 text-gray-700'],
            ['Pending (Sales Input)', data.workflow.approval.pendingSales, 'bg-yellow-100 text-yellow-800'],
            ['Approved', data.workflow.approval.approved, 'bg-green-100 text-green-800'],
            ['Rejected', data.workflow.approval.returned, 'bg-red-100 text-red-800'],
          ] as const,
        },
        {
          title: 'Store Request Status',
          icon: 'bi-box-seam',
          values: [
            ['Requested', data.workflow.storeRequest.requested, 'bg-gray-100 text-gray-700'],
            ['Completed', data.workflow.storeRequest.fulfilled, 'bg-green-100 text-green-800'],
            ['Cancelled', data.workflow.storeRequest.cancelled, 'bg-red-100 text-red-800'],
          ] as const,
        },
      ]
    : []

  return (
    <div className="space-y-6 pb-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <PageHeading className="text-2xl font-semibold" showBack={false}>
            Dashboard
          </PageHeading>
          <p className="mt-1 text-sm text-muted">
            Monitor approved production costs, sales, and pax across sites.
          </p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => {
            void analyticsQuery.refetch()
            void clientsQuery.refetch()
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
                    ? 'Average Food Cost (%)'
                    : `Total ${metric.label}`}
                  {metric.key === 'estimatedCost' || metric.key === 'estimatedRevenue'
                    ? ' (IDR)'
                    : metric.key === 'pax'
                      ? ' (Pax)'
                      : ''}
                </p>
                <p className="mt-2 break-words !text-[32px] !leading-10 font-semibold tabular-nums">
                  {metric.key === 'foodCostPercentage' && data.summary.foodCostPercentage !== null
                    ? data.summary.foodCostPercentage.toFixed(2)
                    : format(data.summary[metric.key], metric.key)}
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
                    {card.values.map(([label, value, badgeClass]) => (
                      <div key={label} className="flex items-center justify-between gap-4">
                        <dt className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${badgeClass}`}>
                          {label}
                        </dt>
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
              {[
                ...metrics
                  .filter(
                    (metric) =>
                      metric.key === 'foodCostPercentage' ||
                      metric.key === 'pax',
                  )
                  .map((metric) => ({ label: metric.label, series: [metric] })),
                {
                  label: 'Estimated Cost & Revenue',
                  series: metrics.filter(
                    (metric) =>
                      metric.key === 'estimatedCost' ||
                      metric.key === 'estimatedRevenue',
                  ),
                },
              ].map((chart) => (
                <div
                  key={chart.label}
                  className={`min-w-0 rounded-md border border-border bg-surface p-4 shadow-sm ${chart.series.length > 1 ? 'lg:col-span-2' : ''}`}
                >
                  <h3 className="text-sm font-semibold">{chart.label}</h3>
                  <TrendChart
                    points={data.trend}
                    series={chart.series}
                    interval={applied.interval}
                    topClientsOnly={!applied.clientId}
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
