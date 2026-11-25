import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import {
  inventoryDate,
  inventoryQuantityLabel,
  inventoryTransactionType,
  type InventoryMovement,
  type InventoryEntry,
  type InventoryStockLine,
  type InventoryStatus,
} from '../../lib/inventory'
import { downloadSpreadsheet } from '../../lib/spreadsheet-export'
import TablePagination from '../TablePagination'
import LoadingTableBody from '../LoadingTableBody'
import OpeningInventory from './OpeningInventory'
import InventoryReceiptForm from './InventoryReceiptForm'

type Props = {
  site: string
  accessToken: string
  isSuperadmin: boolean
  siteSelector?: React.ReactNode
}
const movementHeaders = ['No', 'Date', 'No. PO', 'Production Code', 'Product Code', 'Name', 'QTY', 'UOM', 'Transaction Type', 'User']
const movementTableHeaders = [...movementHeaders, 'Action']
const movementDate = (entry: InventoryMovement) => `${inventoryDate(entry.occurredAt)} WIB`
const movementUser = (entry: InventoryMovement) =>
  entry.actor.replace(/\s*\([a-f\d]{24}\)\s*$/i, '').trim() || '-'

type Tab = 'stock' | 'movements'
const inputClass =
  'rounded-md border border-border bg-background px-3 py-2 text-sm'

const InventoryWorkspace = ({ site, accessToken, isSuperadmin, siteSelector }: Props) => {
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const locationState = location.state as { inventoryMessage?: string } | null
  const tab: Tab = searchParams.get('view') === 'movements' ? 'movements' : 'stock'
  const [status, setStatus] = useState<InventoryStatus | null>(null)
  const [balances, setBalances] = useState<InventoryStockLine[]>([])
  const [entries, setEntries] = useState<InventoryMovement[]>([])
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [stockTo, setStockTo] = useState(() => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' }))
  const [stockFrom, setStockFrom] = useState(() => {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' })
    return new Date(Date.parse(today) - 6 * 86400000).toISOString().slice(0, 10)
  })
  const stockDates: string[] = []
  const rangeDays = (Date.parse(stockTo) - Date.parse(stockFrom)) / 86400000 + 1
  if (rangeDays > 0 && rangeDays <= 366) {
    for (let day = Date.parse(stockTo); day >= Date.parse(stockFrom); day -= 86400000)
      stockDates.push(new Date(day).toISOString().slice(0, 10))
  }
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(Boolean(site))
  const [error, setError] = useState('')
  const [message, setMessage] = useState(() => locationState?.inventoryMessage ?? '')
  const [opening, setOpening] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [reversing, setReversing] = useState<Pick<InventoryEntry, '_id'> | null>(null)
  const [editingId, setEditingId] = useState('')
  const [editReceipt, setEditReceipt] = useState<InventoryEntry | null>(null)
  const [editError, setEditError] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [reverseError, setReverseError] = useState('')
  const [resetConfirmation, setResetConfirmation] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)
  const [resetError, setResetError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    setBalances([])
    setEntries([])
    setTotal(0)
    if (!site) {
      setStatus(null)
      setLoading(false)
      return () => controller.abort()
    }
    if (tab === 'stock' && (!stockFrom || !stockTo || stockFrom > stockTo || rangeDays > 366)) {
      setError('Select a valid date range of at most 366 days.')
      setLoading(false)
      return () => controller.abort()
    }
    if (tab !== 'stock' && from && to && from > to) {
      setError('Start date must not be after end date.')
      setLoading(false)
      return () => controller.abort()
    }
    const params = new URLSearchParams({
      site,
      search,
      page: String(page),
      limit: '20',
    })
    if (tab !== 'stock') {
      params.set('view', 'lines')
      if (from) params.set('from', from)
      if (to) params.set('to', to)
    } else {
      params.set('from', stockFrom)
      params.set('to', stockTo)
    }
    const load = async () => {
      try {
        const current = await apiFetch<InventoryStatus>(
          `/inventory/status?site=${encodeURIComponent(site)}`,
          { signal: controller.signal },
          accessToken,
        )
        if (controller.signal.aborted) return
        setStatus(current)
        if (!current.active) return
        if (tab === 'stock') {
          const result = await apiFetch<{
            items: InventoryStockLine[]
            total: number
          }>(
            `/inventory/balances?${params}`,
            { signal: controller.signal },
            accessToken,
          )
          if (!controller.signal.aborted) {
            setBalances(result.items)
            setTotal(result.total)
          }
        } else {
          const result = await apiFetch<{
            items: InventoryMovement[]
            total: number
          }>(
            `/inventory/${tab}?${params}`,
            { signal: controller.signal },
            accessToken,
          )
          if (!controller.signal.aborted) {
            setEntries(result.items)
            setTotal(result.total)
          }
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : 'Failed to load inventory.',
          )
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    const timer = window.setTimeout(() => {
      void load()
    }, 200)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [accessToken, site, tab, search, from, to, stockFrom, stockTo, rangeDays, page, revision])

  useEffect(() => {
    const controller = new AbortController()
    setEditReceipt(null)
    setEditError('')
    if (!editingId) return () => controller.abort()
    const loadReceipt = async () => {
      try {
        const receipt = await apiFetch<InventoryEntry>(
          `/inventory/receipts/${editingId}?site=${encodeURIComponent(site)}`,
          { signal: controller.signal }, accessToken,
        )
        if (receipt.reversedAt) throw new Error('This receipt has already been cancelled or edited. Refresh the movement list.')
        if (!controller.signal.aborted) setEditReceipt(receipt)
      } catch (error) {
        if (!controller.signal.aborted) setEditError(error instanceof Error ? error.message : 'Failed to load receipt.')
      }
    }
    void loadReceipt()
    return () => controller.abort()
  }, [editingId, site, accessToken])

  const reverse = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!reversing || !reason.trim() || saving) return
    setSaving(true)
    setReverseError('')
    try {
      await apiFetch(
        `/inventory/receipts/${reversing._id}/reverse?site=${encodeURIComponent(site)}`,
        { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) },
        accessToken,
      )
      setReversing(null)
      setReason('')
      setMessage('Receipt cancelled. Stock has been adjusted.')
      setRevision((value) => value + 1)
    } catch (error) {
      setReverseError(
        error instanceof Error ? error.message : 'Failed to cancel receipt.',
      )
    } finally {
      setSaving(false)
    }
  }

  const resetInventory = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!isSuperadmin || !site || resetConfirmation?.trim() !== site || resetting) return
    setResetting(true)
    setResetError('')
    setMessage('')
    try {
      const current = await apiFetch<InventoryStatus>(
        `/inventory/reset?site=${encodeURIComponent(site)}`,
        { method: 'POST', body: JSON.stringify({ confirmation: site }) },
        accessToken,
      )
      queryClient.removeQueries({
        predicate: ({ queryKey: [key, params] }) =>
          key === 'inventory-dashboard' ? params === site :
            (key === 'inventory-dashboard-trend' || key === 'inventory-dashboard-history') &&
            typeof params === 'string' && new URLSearchParams(params).get('site') === site,
      })
      setStatus(current)
      setBalances([])
      setEntries([])
      setTotal(0)
      setPage(1)
      setOpening(false)
      setResetConfirmation(null)
      setMessage(`Inventory for ${site} was reset. Import an opening balance to activate it again.`)
      setRevision((value) => value + 1)
    } catch (error) {
      setResetError(error instanceof Error ? error.message : 'Failed to reset inventory.')
    } finally {
      setResetting(false)
    }
  }

  const exportStock = async () => {
    if (!site || !status?.active || exporting) return
    setExporting(true)
    setError('')
    try {
      const items: InventoryStockLine[] = []
      let exportPage = 1
      let exportTotal = 0
      do {
        const params = new URLSearchParams({ site, search, page: String(exportPage), limit: '100' })
        params.set('from', stockFrom)
        params.set('to', stockTo)
        const result = await apiFetch<{ items: InventoryStockLine[]; total: number }>(
          `/inventory/balances?${params}`, undefined, accessToken,
        )
        exportTotal = result.total
        if (!result.items.length && items.length < exportTotal) {
          throw new Error('Stock data changed during export. Please try again.')
        }
        items.push(...result.items)
        exportPage += 1
      } while (items.length < exportTotal)
      await downloadSpreadsheet(`Stock-${site}-${stockFrom}-${stockTo}.xlsx`, [{
        name: 'Stock',
        rows: [
          ['No', 'Product Code', 'Name', 'Unit Of Measure', ...stockDates.map((day) => `Qty ${day}`)],
          ...items.map((item, index) => [index + 1, item.productCode, item.name, item.unitOfMeasures, ...stockDates.map((day) => item.quantities[day] ?? 0)]),
        ],
      }])
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to export stock.')
    } finally {
      setExporting(false)
    }
  }

  const exportMovements = async () => {
    if (!site || !status?.active || exporting) return
    setExporting(true)
    setError('')
    try {
      const items: InventoryMovement[] = []
      let exportPage = 1
      let exportTotal: number | undefined
      const seen = new Set<string>()
      do {
        const params = new URLSearchParams({ site, search, view: 'lines', page: String(exportPage), limit: '100' })
        if (from) params.set('from', from)
        if (to) params.set('to', to)
        const result = await apiFetch<{ items: InventoryMovement[]; total: number }>(
          `/inventory/movements?${params}`, undefined, accessToken,
        )
        if (exportTotal !== undefined && exportTotal !== result.total) {
          throw new Error('Movement data changed during export. Please try again.')
        }
        exportTotal = result.total
        if (!result.items.length && items.length < exportTotal) {
          throw new Error('Movement data changed during export. Please try again.')
        }
        for (const item of result.items) {
          const key = `${item._id}-${item.lineIndex}`
          if (seen.has(key)) throw new Error('Movement data changed during export. Please try again.')
          seen.add(key)
        }
        items.push(...result.items)
        exportPage += 1
      } while (items.length < exportTotal)
      await downloadSpreadsheet(`Stock-Movements-${site}.xlsx`, [{
        name: 'Stock Movements',
        rows: [movementHeaders, ...items.map((item, index) => [
          index + 1, movementDate(item), item.poNumber || '-', item.productionCode || '-',
          item.productCode, item.name, { kind: 'decimal' as const, value: Math.abs(item.quantity) },
          item.unitOfMeasures, inventoryTransactionType(item), movementUser(item),
        ])],
      }])
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to export stock movements.')
    } finally {
      setExporting(false)
    }
  }

  const pagination = (
    <TablePagination
      page={page}
      totalPages={Math.max(1, Math.ceil(total / 20))}
      onPageChange={setPage}
      loading={loading}
      summary={`Showing ${tab === 'stock' ? balances.length : entries.length} of ${total} ${tab === 'stock' ? 'items' : 'movements'}`}
      className={`${tab === 'stock' ? 'border-b' : 'border-t'} border-border bg-white px-5 py-4`}
    />
  )

  return (
    <div className="space-y-4">
      {message ? (
        <p
          role="status"
          className="rounded-md bg-green-50 p-3 text-sm text-green-800"
        >
          {message}
        </p>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-md border border-red-200 p-3 text-sm text-red-600"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setRevision((value) => value + 1)}
            className="underline"
          >
            Try again
          </button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        {siteSelector ? <div className="w-full sm:w-64 sm:shrink-0">{siteSelector}</div> : null}
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {isSuperadmin && (
            <button type="button"
              onClick={() => { setResetError(''); setResetConfirmation('') }}
              disabled={!site || resetConfirmation !== null || saving || exporting}
              className="rounded-md border border-red-600 px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-50">
              Reset Inventory
            </button>
          )}
          {tab === 'stock' ? (
            <button type="button" onClick={() => setOpening((value) => !value)}
              disabled={!site || !status || (status.active && !isSuperadmin) || loading}
              aria-expanded={opening}
              title={status?.active ? isSuperadmin ? 'Add opening balances for new IT items.' : 'Opening balance has already been recorded for this site.' : undefined}
              className={`${inputClass} font-semibold disabled:cursor-not-allowed disabled:opacity-50`}>
              Opening Balance
            </button>
          ) : (
            <button
            type="button"
            onClick={() => setRevision((value) => value + 1)}
            disabled={!site || loading}
            className={`${inputClass} disabled:opacity-50`}
          >
            Refresh
          </button>
          )}
          <button
            type="button"
            onClick={() => {
              navigate(`/${isSuperadmin ? 'superadmin' : 'storekeeper'}/inventory/receive-goods?site=${encodeURIComponent(site)}`)
            }}
            disabled={!site || !status?.active || loading}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <i className="bi bi-plus-lg mr-2" aria-hidden="true" />
            Receive Goods
          </button>
          <button
            type="button"
            onClick={() => navigate(`/${isSuperadmin ? 'superadmin' : 'storekeeper'}/inventory/import-po?site=${encodeURIComponent(site)}`)}
            disabled={!site || !status?.active || loading}
            className="inline-flex items-center gap-2 rounded-md border border-green-600 bg-surface px-4 py-2 text-sm font-semibold text-green-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <i className="bi bi-upload" aria-hidden="true" />
            Import PO
          </button>
          {tab === 'stock' ? (
            <button type="button" onClick={() => void exportStock()}
              disabled={!site || !status?.active || loading || exporting || !stockDates.length}
              className={`${inputClass} min-w-24 font-semibold disabled:cursor-not-allowed disabled:opacity-50`}>
              {exporting ? 'Exporting...' : 'Export'}
            </button>
          ) : (
            <button type="button" onClick={() => void exportMovements()}
              disabled={!site || !status?.active || loading || exporting || !total || Boolean(from && to && from > to)}
              className={`${inputClass} min-w-24 font-semibold disabled:cursor-not-allowed disabled:opacity-50`}>
              {exporting ? 'Exporting...' : 'Export'}
            </button>
          )}
        </div>
      </div>
      {site && status && ((!status.active && (tab !== 'stock' || opening)) || (status.active && isSuperadmin && opening && tab === 'stock')) ? (
        <>
          {!status.active && <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Inventory has not been activated for {site}. Store Requests continue
            to work as usual.
          </p>}
          <OpeningInventory
            key={site}
            site={site}
            accessToken={accessToken}
            additional={status.active}
            onSaved={() => {
              setOpening(false)
              setMessage(status.active ? 'Opening balances for new IT items saved.' : 'Opening balance imported. Inventory is now active.')
              setRevision((value) => value + 1)
            }}
          />
        </>
      ) : null}
      {isSuperadmin && resetConfirmation !== null && (
        <form onSubmit={(event) => void resetInventory(event)} aria-labelledby="inventory-reset-title"
          className="space-y-3 rounded-md border border-red-200 bg-surface p-4">
          <h2 id="inventory-reset-title" className="font-semibold">Reset Inventory for {site}</h2>
          <p className="text-sm">
            This permanently deletes all stock balances and movement history for {site}.
            You will need to import a new opening balance to activate inventory again.
          </p>
          <label className="block space-y-1 text-sm">
            <span className="block">Type {site} to confirm</span>
            <input type="text" value={resetConfirmation} maxLength={100} autoComplete="off"
              disabled={resetting} onChange={(event) => setResetConfirmation(event.target.value)}
              className={inputClass} />
          </label>
          {resetError && <p role="alert" className="text-sm text-red-600">{resetError}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={resetting || resetConfirmation.trim() !== site}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {resetting ? 'Resetting...' : 'Confirm Reset'}
            </button>
            <button type="button" disabled={resetting} onClick={() => setResetConfirmation(null)} className={inputClass}>
              Back
            </button>
          </div>
        </form>
      )}
      <section
        className="rounded-md border border-border bg-surface"
      >
        <div className="flex flex-wrap items-end gap-3 border-b border-border p-4">
          <label className={tab === 'stock' ? 'w-full space-y-1 text-xs sm:w-72' : 'flex-1 space-y-1 text-xs'}>
            <span className="block">Search item</span>
            <input
              value={search}
              maxLength={200}
              onChange={(event) => {
                setSearch(event.target.value)
                setPage(1)
              }}
              placeholder="Item code or name"
              className={`${inputClass} w-full min-w-44`}
            />
          </label>
          {tab === 'stock' ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="space-y-1 text-xs">
                <span className="block">From (WIB)</span>
                <input type="date" value={stockFrom} max={stockTo}
                  onChange={(event) => { setStockFrom(event.target.value); setPage(1) }}
                  className={inputClass} />
              </label>
              <label className="space-y-1 text-xs">
                <span className="block">To (WIB)</span>
                <input type="date" value={stockTo} min={stockFrom}
                  onChange={(event) => { setStockTo(event.target.value); setPage(1) }}
                  className={inputClass} />
              </label>
            </div>
          ) : (
            <>
              <label className="space-y-1 text-xs">
                <span className="block">From</span>
                <input
                  type="date"
                  value={from}
                  onChange={(event) => {
                    setFrom(event.target.value)
                    setPage(1)
                  }}
                  className={inputClass}
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="block">To</span>
                <input
                  type="date"
                  value={to}
                  onChange={(event) => {
                    setTo(event.target.value)
                    setPage(1)
                  }}
                  className={inputClass}
                />
              </label>
            </>
          )}
        </div>
        {tab === 'stock' ? (
          pagination
        ) : null}
        {tab === 'stock' ? (
          <div className="min-h-[420px] max-w-full overflow-x-auto">
            <table className="dm-table min-w-full border-collapse text-sm [&_th]:border [&_th]:border-slate-400 [&_td]:border [&_td]:border-slate-400 [&_tbody_td]:text-[16px] [&_tbody_td_*]:text-[16px]">
              <thead className="bg-background">
                <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                  {['No', 'Product Code', 'Name', 'Unit Of Measure'].map(
                    (label) => (
                      <th key={label} className="px-5 py-4 font-semibold">
                        {label}
                      </th>
                    ),
                  )}
                  {stockDates.map((day) => (
                    <th key={day} className="min-w-[78px] px-2 py-4 text-right font-semibold normal-case tracking-normal">
                      <span className="block whitespace-nowrap">{new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</span>
                      <span className="block">{day.slice(0, 4)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <LoadingTableBody
                key={JSON.stringify([site, page, search, stockFrom, stockTo])}
                loading={loading}
                columns={4 + stockDates.length}
                rowCount={balances.length}
                pageSize={20}
                label="Loading stock..."
                error={error}
                onRetry={() => setRevision((value) => value + 1)}
              >
                {balances.length ? (
                  balances.map((item, index) => (
                    <tr
                      key={`${item.productCode}-${item.unitOfMeasures}`}
                      className="border-t border-border"
                    >
                      <td className="px-5 py-4 text-muted">{(page - 1) * 20 + index + 1}</td>
                      <td className="px-5 py-4">{item.productCode}</td>
                      <td className="px-5 py-4">{item.name}</td>
                      <td className="px-5 py-4">{item.unitOfMeasures}</td>
                      {stockDates.map((day) => {
                        const quantity = item.quantities[day] ?? 0
                        return (
                          <td key={day} className={`px-2 py-4 text-right font-semibold tabular-nums ${quantity < 0 ? 'bg-red-50 text-red-800' : ''}`}>
                            {inventoryQuantityLabel(quantity)}
                          </td>
                        )
                      })}
                    </tr>
                  ))
                ) : (
                  <tr className="border-t border-border">
                    <td colSpan={4 + stockDates.length} className="px-5 py-10 text-center text-muted">
                      {error ? error : !site ? 'Select a site to view stock.' : !status?.active ? 'No stock available. Record the opening balance to activate inventory.' : 'No stock records match this search. Items without movements have a zero balance.'}
                    </td>
                  </tr>
                )}
              </LoadingTableBody>
            </table>
          </div>
        ) : (
          <div className="min-h-[420px] max-w-full overflow-x-auto">
            <table className="dm-table min-w-full border-collapse text-sm [&_th]:border [&_th]:border-slate-400 [&_td]:border [&_td]:border-slate-400 [&_thead_th]:text-[16px] [&_thead_th]:uppercase [&_thead_th_*]:text-[16px] [&_tbody_td]:text-[14px] [&_tbody_td_*]:text-[14px]">
              <thead className="bg-[#203864] text-white">
                <tr className="text-left">
                  {movementTableHeaders.map((label) => (
                    <th key={label} className={`whitespace-nowrap px-3 py-3 font-semibold ${label === 'QTY' ? 'text-right' : ''}`}>{label}</th>
                  ))}
                </tr>
              </thead>
              <LoadingTableBody key={JSON.stringify([site, page, search, from, to])} loading={loading} columns={movementTableHeaders.length} rowCount={entries.length} pageSize={20}
                label="Loading stock movements..." error={error} onRetry={() => setRevision((value) => value + 1)}>
                {entries.length ? entries.map((entry, index) => (
                  <tr key={`${entry._id}-${entry.lineIndex}`} className="align-top">
                    <td className="px-3 py-2 text-right">{(page - 1) * 20 + index + 1}</td>
                    <td className="whitespace-nowrap px-3 py-2">{movementDate(entry)}</td>
                    <td className="whitespace-nowrap px-3 py-2">{entry.poNumber || '-'}</td>
                    <td className="whitespace-nowrap px-3 py-2">{entry.productionCode || '-'}</td>
                    <td className="whitespace-nowrap px-3 py-2">{entry.productCode}</td>
                    <td className="min-w-80 px-3 py-2">
                      {entry.supplier || entry.reference || entry.note || entry.reversedAt ? (
                        <details>
                          <summary className="cursor-pointer" title="View transaction details">{entry.name}</summary>
                          <div className="mt-3 space-y-2 text-xs text-muted">
                            {entry.supplier ? <p>Supplier: {entry.supplier}</p> : null}
                            {entry.reference ? <p className="break-all">Reference: {entry.reference}</p> : null}
                            {entry.note ? <p className="whitespace-pre-wrap">Notes: {entry.note}</p> : null}
                            {entry.reversedAt ? <p>Cancelled: {inventoryDate(entry.reversedAt)} WIB</p> : null}
                          </div>
                        </details>
                      ) : entry.name}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{inventoryQuantityLabel(Math.abs(entry.quantity))}</td>
                    <td className="whitespace-nowrap px-3 py-2">{entry.unitOfMeasures}</td>
                    <td className="whitespace-nowrap px-3 py-2">{inventoryTransactionType(entry)}</td>
                    <td className="whitespace-nowrap px-3 py-2">{movementUser(entry)}</td>
                    <td className="whitespace-nowrap px-3 !py-0.5 align-middle">
                      {isSuperadmin && entry.kind === 'receipt' && !entry.reversedAt ? (
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => setEditingId(entry._id)}
                            className="inline-flex h-6 items-center rounded-md border border-primary px-2 font-semibold text-primary hover:bg-primary/10">Edit</button>
                          <button type="button" onClick={() => {
                            setReversing(entry)
                            setReason('')
                            setReverseError('')
                          }} className="inline-flex h-6 items-center rounded-md border border-red-600 bg-red-600 px-2 font-semibold text-white hover:border-red-700 hover:bg-red-700">
                            Cancel
                          </button>
                        </div>
                      ) : entry.kind === 'receipt' && entry.reversedAt ? 'Cancelled' : '-'}
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={movementTableHeaders.length} className="px-5 py-10 text-center text-muted">
                    {error ? error : !site ? 'Select a site to view stock movements.' : !status?.active ? 'Record the opening balance to activate inventory.' : 'No records match these filters.'}
                  </td></tr>
                )}
              </LoadingTableBody>
            </table>
          </div>
        )}
        {tab !== 'stock' ? (
          pagination
        ) : null}
      </section>
      {loading && !status ? (
        <p role="status" className="text-sm text-muted">
          Checking inventory...
        </p>
      ) : null}
      {editingId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog" aria-modal="true" aria-label="Edit receipt">
          <div className="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-md bg-surface">
            {editReceipt ? (
              <InventoryReceiptForm key={editReceipt._id} site={site} accessToken={accessToken} receipt={editReceipt}
                onCancel={() => setEditingId('')}
                onSaved={() => {
                  setEditingId('')
                  setMessage('Receipt updated. Stock has been adjusted.')
                  setRevision((value) => value + 1)
                }} />
            ) : (
              <div className="space-y-4 p-6">
                <p role={editError ? 'alert' : 'status'}>{editError || 'Loading receipt...'}</p>
                <button type="button" onClick={() => setEditingId('')} className={inputClass}>Back</button>
              </div>
            )}
          </div>
        </div>
      ) : null}
      {reversing ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="inventory-reverse-title"
        >
          <form
            onSubmit={(event) => void reverse(event)}
            className="w-full max-w-lg space-y-4 rounded-md border border-border bg-surface p-6"
          >
            <h2 id="inventory-reverse-title" className="text-lg font-semibold">
              Cancel receipt
            </h2>
            <p className="break-all text-sm">
              Cancel this entire receipt? This subtracts the received quantities for all items and keeps the receipt in history.
            </p>
            <label className="block space-y-1 text-sm">
              <span>Reason *</span>
              <textarea
                required
                maxLength={1000}
                value={reason}
                disabled={saving}
                onChange={(event) => setReason(event.target.value)}
                className={`${inputClass} w-full`}
              />
            </label>
            {reverseError ? (
              <p role="alert" className="text-sm text-red-600">
                {reverseError}
              </p>
            ) : null}
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={saving || !reason.trim()}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? 'Cancelling...' : 'Confirm cancellation'}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => setReversing(null)}
                className={`${inputClass} disabled:opacity-50`}
              >
                Back
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  )
}

export default InventoryWorkspace
