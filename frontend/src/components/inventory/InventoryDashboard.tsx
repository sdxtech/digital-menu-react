import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type LabelProps } from 'recharts'
import { apiFetch } from '../../lib/api'
import {
  inventoryDate,
  inventoryLabels,
  inventoryQuantityLabel,
  type InventoryLine,
  type InventoryMovement,
  type InventoryStatus,
} from '../../lib/inventory'
import TablePagination from '../TablePagination'
import InventoryItemFilter from './InventoryItemFilter'

type Props = {
  site: string
  accessToken: string
  siteSelector?: ReactNode
  showSiteLabel?: boolean
}
type Trend = {
  totals: { stockIn: number; stockOut: number }
  items: Array<{ productCode: string; stockIn: number; stockOut: number }>
  hasData: boolean
}

const panel = 'space-y-4 rounded-lg border border-border bg-surface p-4 shadow-sm'
const input = 'rounded-md border border-border bg-background px-3 py-2 text-sm'
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' })
const chartItemLabel = (name: string) => name.length > 25 ? `${name.slice(0, 24)}…` : name
const itemAxisWidth = (chartWidth: number) => Math.min(144, Math.round(chartWidth * 0.28))
const performanceChartMargin = { left: 0, right: 12 }
const inventoryBarLabel = (quantity: number, unit?: string) =>
  quantity ? [inventoryQuantityLabel(quantity), unit].filter(Boolean).join(' ') : ''
const barLabelSpace = (label: string) => label ? label.length * 7 + 8 : 0

const renderInventoryBarLabel = ({ value, viewBox, parentViewBox }: LabelProps) => {
  if (typeof value !== 'string' || !value || !viewBox || !('width' in viewBox)) return null

  const { x, y, width, height } = viewBox
  const direction = width < 0 ? -1 : 1
  const end = x + width + direction * 5
  const left = end - (direction < 0 ? barLabelSpace(value) : 0)
  const bounds = parentViewBox && 'width' in parentViewBox ? parentViewBox : null
  const plotStart = bounds ? itemAxisWidth(bounds.width) + 5 : 0
  const moveLabel = bounds && (left < plotStart || left + barLabelSpace(value) > bounds.width)
  const available = bounds ? Math.max(1, bounds.width - plotStart - 2) : barLabelSpace(value)
  const labelWidth = Math.min(available, barLabelSpace(value))

  return (
    <text
      x={moveLabel ? Math.max(plotStart, Math.min(left, bounds.width - labelWidth - 2)) : end}
      y={moveLabel ? (direction < 0 ? y - 7 : y + height + 7) : y + height / 2}
      textAnchor={!moveLabel && direction < 0 ? 'end' : 'start'}
      textLength={moveLabel && barLabelSpace(value) > available ? available : undefined}
      lengthAdjust="spacingAndGlyphs"
      dominantBaseline="central"
      fontSize={11}
      fill="currentColor"
      pointerEvents="none"
    >
      {value}
    </text>
  )
}

const InventoryDashboard = ({ site, accessToken, siteSelector, showSiteLabel = true }: Props) => {
  const [selectedItem, setSelectedItem] = useState<InventoryLine | null>(null)
  const [historyPage, setHistoryPage] = useState(1)
  const [performanceWidth, setPerformanceWidth] = useState(500)
  const [balanceWidth, setBalanceWidth] = useState(500)
  const [from, setFrom] = useState(() => new Date(Date.parse(today()) - 29 * 86400000).toISOString().slice(0, 10))
  const [to, setTo] = useState(today)
  const days = (Date.parse(to) - Date.parse(from)) / 86400000 + 1
  const validRange = days >= 1 && days <= 366

  const stock = useQuery({
    queryKey: ['inventory-dashboard', site],
    staleTime: 0,
    enabled: Boolean(site),
    queryFn: ({ signal }) => apiFetch<InventoryStatus & { items: InventoryLine[] }>(
      `/inventory/dashboard?site=${encodeURIComponent(site)}`, { signal }, accessToken,
    ),
  })
  const items = stock.data?.items ?? []
  const itemParams: Record<string, string> = selectedItem
    ? { productCode: selectedItem.productCode }
    : {}
  const trendParams = new URLSearchParams({ ...itemParams, site, from, to })
  const historyParams = new URLSearchParams({ ...itemParams, site, page: String(historyPage), limit: '10' })
  const trend = useQuery({
    queryKey: ['inventory-dashboard-trend', trendParams.toString()],
    staleTime: 0,
    enabled: Boolean(stock.data?.active && validRange),
    queryFn: ({ signal }) => apiFetch<Trend>(
      `/inventory/dashboard/trend?${trendParams}`, { signal }, accessToken,
    ),
  })
  const history = useQuery({
    queryKey: ['inventory-dashboard-history', historyParams.toString()],
    staleTime: 0,
    enabled: Boolean(stock.data?.active && selectedItem),
    queryFn: ({ signal }) => apiFetch<{ items: InventoryMovement[]; total: number }>(
      `/inventory/dashboard/history?${historyParams}`, { signal }, accessToken,
    ),
  })

  const negativeBalances = items.filter((item) => item.quantity < 0).length
  const topBalances = items
    .filter((item) => item.quantity > 0)
    .sort((a, b) => b.quantity - a.quantity || a.productCode.localeCompare(b.productCode))
    .slice(0, 10)
  const itemsByCode = new Map(items.map((item) => [item.productCode, item]))
  const itemOptions = [...itemsByCode.values()].sort((a, b) =>
    a.name.localeCompare(b.name) || a.productCode.localeCompare(b.productCode),
  )
  const chooseItem = (item: InventoryLine | null) => {
    setSelectedItem(item)
    setHistoryPage(1)
  }
  const movementItems = selectedItem && trend.data?.hasData
    ? [{ productCode: selectedItem.productCode, ...trend.data.totals }]
    : trend.data?.items ?? []
  const performance = movementItems.map((item) => ({
    ...item,
    stockOut: item.stockOut ? -item.stockOut : 0,
    unit: itemsByCode.get(item.productCode)?.unitOfMeasures,
  }))
  const balanceLabelPadding = Math.max(32, ...topBalances.map((item) =>
    barLabelSpace(inventoryBarLabel(item.quantity, item.unitOfMeasures)),
  ))
  const performanceMax = Math.max(1, ...performance.map((item) => Math.max(item.stockIn, -item.stockOut)))
  const paddedLimit = performanceMax * 1.35
  const minTickStep = Math.max(1, paddedLimit / 4)
  const tickMagnitude = 10 ** Math.floor(Math.log10(minTickStep))
  const tickStep = [1, 2, 5, 10].map((scale) => scale * tickMagnitude)
    .find((step) => step >= minTickStep) ?? 10 * tickMagnitude
  const ticksPerSide = Math.ceil(paddedLimit / tickStep)
  const chartLimit = ticksPerSide * tickStep
  const performanceTicks = Array.from({ length: ticksPerSide * 2 + 1 }, (_, index) =>
    (index - ticksPerSide) * tickStep,
  )
  const performanceLabel = (code: string) => itemsByCode.get(code)?.name ?? code
  const siteFilter = siteSelector ?? (
    showSiteLabel && site ? <p className="text-sm text-muted">Site {site}</p> : null
  )

  return (
    <div className="space-y-4">
      {(siteFilter || stock.data?.active) && (
        <div className="grid min-w-0 auto-cols-[minmax(9rem,1fr)] grid-flow-col items-end gap-4 overflow-x-auto"
          role="group" aria-label="Inventory filters">
          {siteFilter}
          {stock.data?.active && (
            <>
              {itemOptions.length > 0 && (
                <InventoryItemFilter items={itemOptions} selected={selectedItem} onSelect={chooseItem} />
              )}
              <label className="grid min-w-0 gap-1 text-sm">
                From Date
                <input type="date" className={`${input} min-w-0 w-full`} value={from} onChange={(event) => setFrom(event.target.value)} />
              </label>
              <label className="relative grid min-w-0 gap-1 text-sm">
                To Date
                <span className="absolute -left-2 bottom-2 -translate-x-1/2 text-muted" aria-hidden="true">-</span>
                <input type="date" className={`${input} min-w-0 w-full`} value={to} onChange={(event) => setTo(event.target.value)} />
              </label>
            </>
          )}
        </div>
      )}
      {!site && <p className="text-sm text-muted">Select a site to view inventory.</p>}
      {site && stock.isPending && <p role="status" className="text-sm text-muted">Loading inventory…</p>}
      {stock.isError && <p role="alert" className="text-sm text-red-700">{stock.error.message}</p>}
      {stock.data?.active === false && <p className="text-sm text-muted">This site has no opening inventory yet.</p>}
      {stock.data?.active && (
        <>
          {!validRange && <p role="alert" className="text-sm text-red-700">Select a date range of 1 to 366 days.</p>}
          {negativeBalances > 0 && (
            <p role="status" className="text-sm text-amber-800">
              {negativeBalances} existing stock balances are below zero and need reconciliation.
            </p>
          )}

          <div className="grid min-w-0 grid-cols-2 gap-4">
            <section className={`${panel} min-w-0`} aria-label="Item performance">
              <div>
                <h2 className="font-semibold">Item Performance</h2>
                <p className="text-sm text-muted">{selectedItem?.name ?? 'Top 10 items by total movement quantity'}</p>
              </div>
              {validRange && trend.isPending && <p role="status" className="text-sm text-muted">Loading trend…</p>}
              {trend.isError && <p role="alert" className="text-sm text-red-700">{trend.error.message}</p>}
              {performance.length > 0 && (
                  <div className="min-w-0" style={{ height: performance.length * 50 + 70 }}>
                    <ResponsiveContainer width="100%" height="100%" onResize={setPerformanceWidth}>
                      <BarChart layout="vertical" data={performance} stackOffset="sign" margin={performanceChartMargin}>
                        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                        <XAxis type="number" domain={[-chartLimit, chartLimit]} ticks={performanceTicks}
                          tick={{ fontSize: 11 }} tickFormatter={inventoryQuantityLabel} />
                        <YAxis type="category" dataKey="productCode" width={itemAxisWidth(performanceWidth)} interval={0} tick={{ fontSize: 11 }}
                          tickFormatter={(code: string) => chartItemLabel(performanceLabel(code))} />
                        <Tooltip wrapperStyle={{ maxWidth: '100%' }} contentStyle={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}
                          labelFormatter={(code) => performanceLabel(String(code))}
                          formatter={(value) => inventoryQuantityLabel(Math.abs(Number(value)))} />
                        <Legend verticalAlign="top" />
                        <ReferenceLine x={0} stroke="#64748b" />
                        <Bar dataKey="stockIn" name="Stock In" stackId="movement" fill="#2563eb" barSize={20}>
                          <LabelList dataKey={(item: (typeof performance)[number]) => inventoryBarLabel(item.stockIn, item.unit)}
                            content={renderInventoryBarLabel} />
                        </Bar>
                        <Bar dataKey="stockOut" name="Stock Out" stackId="movement" fill="#f59e42" barSize={20}>
                          <LabelList dataKey={(item: (typeof performance)[number]) => inventoryBarLabel(item.stockOut, item.unit)}
                            content={renderInventoryBarLabel} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
              )}
              {trend.data && !trend.data.hasData && <p className="text-sm text-muted">No stock movements for this period.</p>}
            </section>

            <section className={`${panel} min-w-0`} aria-label="Top 10 Current Balance by Item">
              <div>
                <h2 className="font-semibold">Top 10 Current Balance by Item</h2>
                <p className="text-sm text-muted">Current stock for this site</p>
              </div>
              {topBalances.length ? (
                  <div className="min-w-0" style={{ height: topBalances.length * 42 + 40 }}>
                    <ResponsiveContainer width="100%" height="100%" onResize={setBalanceWidth}>
                      <BarChart layout="vertical" data={topBalances} margin={{ right: Math.min(balanceLabelPadding, balanceWidth * 0.22) }}>
                        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                        <XAxis type="number" domain={[0, 'auto']} allowDecimals={false} tickFormatter={inventoryQuantityLabel}
                          tick={{ fontSize: 11 }} minTickGap={12} />
                        <YAxis type="category" dataKey="name" width={itemAxisWidth(balanceWidth)} interval={0} tick={{ fontSize: 11 }}
                          tickFormatter={chartItemLabel} />
                        <Tooltip wrapperStyle={{ maxWidth: '100%' }} contentStyle={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}
                          formatter={(value, _name, entry) => {
                          const item = entry.payload as InventoryLine
                          return [`${inventoryQuantityLabel(Number(value))} ${item.unitOfMeasures}`, 'Balance']
                        }} />
                        <Bar dataKey="quantity" name="Balance" barSize={23}>
                          {topBalances.map((item, index) => (
                            <Cell key={`${item.productCode}-${item.unitOfMeasures}`} fill={`hsl(${148 - index * 12}, 72%, 39%)`} />
                          ))}
                          <LabelList dataKey={(item: InventoryLine) => inventoryBarLabel(item.quantity, item.unitOfMeasures)}
                            content={renderInventoryBarLabel} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
              ) : (
                <p className="text-sm text-muted">No items have a positive stock balance.</p>
              )}
            </section>
          </div>

          {selectedItem && (
            <section className={panel} aria-label="Item movement history">
              <h2 className="font-semibold">Item movement history</h2>
              {history.isPending && <p role="status" className="text-sm text-muted">Loading movement history…</p>}
              {history.isError && <p role="alert" className="text-sm text-red-700">{history.error.message}</p>}
              {history.data && (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-primary text-white">
                        <tr>{['Date (WIB)', 'Transaction', 'Reference', 'Quantity', 'UOM', 'User'].map((title) => <th key={title} scope="col" className="px-3 py-2">{title}</th>)}</tr>
                      </thead>
                      <tbody>
                        {history.data.items.map((entry) => (
                          <tr key={`${entry._id}-${entry.lineIndex}`} className="border-b border-border">
                            <td className="whitespace-nowrap px-3 py-2">{inventoryDate(entry.occurredAt)}</td>
                            <td className="px-3 py-2">{inventoryLabels[entry.kind]}</td>
                            <td className="px-3 py-2">{entry.poNumber || entry.productionCode || '—'}</td>
                            <td className="whitespace-nowrap px-3 py-2 tabular-nums">{entry.quantity > 0 ? '+' : ''}{inventoryQuantityLabel(entry.quantity)}</td>
                            <td className="whitespace-nowrap px-3 py-2">{entry.unitOfMeasures}</td>
                            <td className="px-3 py-2">{entry.actor || '—'}</td>
                          </tr>
                        ))}
                        {!history.data.items.length && <tr><td colSpan={6} className="px-3 py-4 text-muted">No movements found.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                  <TablePagination page={historyPage} totalPages={Math.ceil(history.data.total / 10)} onPageChange={setHistoryPage} summary={`${history.data.total} movements`} />
                </>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}

export default InventoryDashboard
