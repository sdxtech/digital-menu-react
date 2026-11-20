import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { apiFetch } from '../../lib/api'
import type { InventoryEntry, InventoryItem } from '../../lib/inventory'

type Props = {
  site: string
  accessToken: string
  receipt?: InventoryEntry
  onSaved: () => void
  onCancel: () => void
}
const field =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm'

type ReceiptRow = {
  id: string
  item: InventoryItem | null
  productCode: string
  name: string
  quantity: string
}
const createRow = (): ReceiptRow => ({
  id: crypto.randomUUID(), item: null, productCode: '', name: '', quantity: '',
})
const todayWib = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date())

const InventoryReceiptForm = ({
  site,
  accessToken,
  onSaved,
  onCancel,
  receipt,
}: Props) => {
  const [receivedDate, setReceivedDate] = useState(() => receipt ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(receipt.occurredAt)) : todayWib())
  const [reference, setReference] = useState(receipt?.reference ?? '')
  const [note, setNote] = useState(receipt?.note ?? '')
  const [search, setSearch] = useState('')
  const [options, setOptions] = useState<InventoryItem[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [rows, setRows] = useState<ReceiptRow[]>(() => receipt ? receipt.lines.map((line) => ({
    id: crypto.randomUUID(), item: line, productCode: line.productCode, name: line.name, quantity: String(line.quantity),
  })) : [createRow()])
  const [activeSearch, setActiveSearch] = useState<{ rowId: string; column: 'productCode' | 'name' } | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const dropdownRef = useRef<HTMLDivElement | null>(null)
  const [dropdownPosition, setDropdownPosition] = useState({ left: 0, top: 0, width: 320, maxHeight: 240 })
  const [highlighted, setHighlighted] = useState(-1)
  const activeRowId = activeSearch?.rowId
  const activeColumn = activeSearch?.column
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<{ id: string; payload: string } | null>(null)
  const inFlight = useRef(false)

  useEffect(() => {
    if (!activeRowId) return
    const controller = new AbortController()
    setSearchError('')
    setSearching(true)
    setOptions([])
    const timer = window.setTimeout(() => {
      apiFetch<{ items: InventoryItem[] }>(
        `/inventory/items?site=${encodeURIComponent(site)}&search=${encodeURIComponent(search)}`,
        { signal: controller.signal },
        accessToken,
      )
        .then((result) => {
          if (!controller.signal.aborted) setOptions(result.items)
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            setSearchError(
              error instanceof Error
                ? error.message
                : 'Failed to search items.',
            )
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false)
        })
    }, 250)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [site, accessToken, search, activeRowId, activeColumn])

  useLayoutEffect(() => {
    if (!activeRowId) return
    const position = () => {
      const rect = inputRef.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(Math.max(rect.width, 320), window.innerWidth - 16)
      const below = window.innerHeight - rect.bottom - 12
      const above = rect.top - 12
      const openAbove = below < 180 && above > below
      const maxHeight = Math.max(80, Math.min(280, openAbove ? above : below))
      setDropdownPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: openAbove ? Math.max(8, rect.top - maxHeight - 4) : rect.bottom + 4,
        width, maxHeight,
      })
    }
    position()
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    return () => {
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
    }
  }, [activeRowId, activeColumn])

  useEffect(() => {
    if (!activeRowId) return
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !inputRef.current?.contains(event.target) && !dropdownRef.current?.contains(event.target)) {
        setActiveSearch(null)
      }
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [activeRowId])

  const selectedElsewhere = (item: InventoryItem) => rows.some(
    (row) => row.id !== activeRowId && row.item?.productCode === item.productCode,
  )
  const chooseItem = (item: InventoryItem) => {
    if (!activeRowId || busy || selectedElsewhere(item)) return
    setRows((current) => current.map((row) => row.id === activeRowId
      ? { ...row, item, productCode: item.productCode, name: item.name,
          quantity: row.item?.productCode === item.productCode ? row.quantity : '' }
      : row))
    setActiveSearch(null)
  }

  const itemInput = (row: ReceiptRow, column: 'productCode' | 'name', index: number) => {
    const active = activeRowId === row.id && activeColumn === column
    return (
      <input
        value={row[column]}
        autoComplete="off"
        maxLength={200}
        required
        role="combobox"
        aria-label={`${column === 'productCode' ? 'Product code' : 'Name'} for row ${index + 1}`}
        aria-autocomplete="list"
        aria-expanded={active}
        aria-controls={active ? 'receipt-item-options' : undefined}
        aria-activedescendant={active && highlighted >= 0 ? `receipt-item-option-${highlighted}` : undefined}
        placeholder={column === 'productCode' ? 'Search product code' : 'Search name'}
        onFocus={(event) => {
          inputRef.current = event.currentTarget
          setSearch(row[column])
          setOptions([])
          setSearchError('')
          setSearching(true)
          setHighlighted(-1)
          setActiveSearch({ rowId: row.id, column })
        }}
        onChange={(event) => {
          const value = event.target.value
          setRows((current) => current.map((item) => item.id === row.id
            ? { ...item, item: null, productCode: column === 'productCode' ? value : '', name: column === 'name' ? value : '' }
            : item))
          setSearch(value)
          setOptions([])
          setSearching(true)
          setHighlighted(-1)
          setActiveSearch({ rowId: row.id, column })
        }}
        onBlur={(event) => {
          if (!(event.relatedTarget instanceof Node) || !dropdownRef.current?.contains(event.relatedTarget)) setActiveSearch(null)
        }}
        onKeyDown={(event) => {
          if (!active) return
          if (event.key === 'Escape') {
            event.preventDefault()
            setActiveSearch(null)
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            const available = options.map((item, itemIndex) => ({ item, itemIndex })).filter(({ item }) => !selectedElsewhere(item))
            const current = available.findIndex(({ itemIndex }) => itemIndex === highlighted)
            const next = event.key === 'ArrowDown' ? Math.min(current + 1, available.length - 1) : Math.max(current - 1, 0)
            setHighlighted(available[next]?.itemIndex ?? -1)
          } else if (event.key === 'Enter') {
            event.preventDefault()
            const item = options[highlighted]
            if (item && !searching) chooseItem(item)
          }
        }}
        className={`${field} ${column === 'name' ? 'min-w-72' : 'min-w-44'}`}
      />
    )
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (inFlight.current) return
    if (
      !rows.length ||
      rows.some(
        (row) =>
          !row.item ||
          !row.quantity.trim() ||
          !Number.isFinite(Number(row.quantity)) ||
          Number(row.quantity) <= 0,
      )
    ) {
      setError(
        'Select a master item for every row and enter positive received quantities.',
      )
      return
    }
    const payload = JSON.stringify({
      receivedDate,
      ...(receipt ? { supplier: receipt.supplier, note: note.trim() || undefined } : {}),
      reference: reference.trim() || undefined,
      lines: rows.map((row) => ({
        productCode: row.item?.productCode,
        unitOfMeasures: row.item?.unitOfMeasures,
        quantity: Number(row.quantity),
      })),
    })
    if (!request.current || request.current.payload !== payload)
      request.current = { id: crypto.randomUUID(), payload }
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      await apiFetch(
        `/inventory/receipts${receipt ? `/${receipt._id}` : ''}?site=${encodeURIComponent(site)}`,
        {
          method: receipt ? 'PATCH' : 'POST',
          body: JSON.stringify({
            ...(JSON.parse(payload) as object),
            requestId: request.current.id,
          }),
        },
        accessToken,
      )
      setReceivedDate(todayWib())
      setReference('')
      setRows([createRow()])
      setActiveSearch(null)
      setSearch('')
      setOptions([])
      setSearchError('')
      setSearching(false)
      setHighlighted(-1)
      request.current = null
      onSaved()
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Failed to save receipt.',
      )
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={(event) => void save(event)}
      className="space-y-4 rounded-md border border-border bg-surface p-5"
    >
      <h2 className="font-semibold">{receipt ? 'Edit receipt' : 'Receive goods'}</h2>
      {receipt ? <p className="text-sm text-muted">Saving replaces the full receipt and adjusts stock for all its items. The previous receipt stays in history as cancelled.</p> : null}
      <fieldset disabled={busy} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span>Received date *</span>
            <input
              required
              type="date"
              value={receivedDate}
              onChange={(event) => setReceivedDate(event.target.value)}
              className={field}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span>No. PO</span>
            <input
              maxLength={200}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              className={field}
            />
          </label>
        </div>
        {receipt ? (
          <div>
            <label className="block space-y-1 text-sm">
              <span>Notes</span>
              <textarea value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} className={field} />
            </label>
          </div>
        ) : null}
        <div className="max-w-full overflow-x-auto rounded-md border border-border">
          <table className="dm-table min-w-full bg-white text-sm">
            <thead className="bg-background">
              <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                {['', 'No', 'Product Code', 'Name', 'Unit Of Measure', 'Received Quantity'].map((label, index) => (
                  <th key={index} scope="col" className={index < 2 ? 'w-[48px] px-2 py-3 text-center font-semibold' : 'px-4 py-3 font-semibold'}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-2 py-3 text-center">
                    <button type="button" aria-label={`Remove row ${index + 1}`}
                      onClick={() => {
                        setRows((current) => current.length === 1 ? [createRow()] : current.filter((item) => item.id !== row.id))
                        if (activeRowId === row.id) setActiveSearch(null)
                      }}
                      className="dm-x-button text-sm font-semibold leading-none">X</button>
                  </td>
                  <td className="px-2 py-3 text-center text-muted">{index + 1}</td>
                  <td className="px-4 py-3">{itemInput(row, 'productCode', index)}</td>
                  <td className="px-4 py-3">{itemInput(row, 'name', index)}</td>
                  <td className="px-4 py-3">{row.item?.unitOfMeasures || '-'}</td>
                  <td className="min-w-36 px-4 py-3">
                    <input aria-label={`Received quantity for row ${index + 1}`}
                      required type="number" min="0.000001" max="1000000000000" step="0.000001"
                      value={row.quantity}
                      onChange={(event) => setRows((current) => current.map((item) => item.id === row.id ? { ...item, quantity: event.target.value } : item))}
                      className={field} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border">
                <td colSpan={6} className="px-4 py-3 text-center">
                  <button type="button" disabled={rows.length >= 200}
                    onClick={() => setRows((current) => current.length < 200 ? [...current, createRow()] : current)}
                    className="rounded-md border border-primary bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60">
                    + Add row
                  </button>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </fieldset>
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Saving...' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-red-600 bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
      {activeSearch ? createPortal(
        <div ref={dropdownRef} id="receipt-item-options" role="listbox" aria-label="Master items"
          className="fixed z-[100] overflow-y-auto rounded-md border border-border bg-white shadow-xl"
          style={dropdownPosition}>
          {searching ? <p role="status" className="px-3 py-2 text-sm text-muted">Searching items...</p>
            : searchError ? <p role="alert" className="px-3 py-2 text-sm text-red-600">{searchError}</p>
            : !options.length ? <p role="status" className="px-3 py-2 text-sm text-muted">No matching items.</p> : null}
          {!searching && !searchError ? options.map((item, index) => (
            <button key={`${item.productCode}-${item.unitOfMeasures}`} id={`receipt-item-option-${index}`}
              type="button" role="option" aria-selected={highlighted === index}
              disabled={busy || selectedElsewhere(item)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => chooseItem(item)}
              className={`block w-full border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-primary-soft disabled:cursor-not-allowed disabled:opacity-50 ${highlighted === index ? 'bg-primary-soft' : ''}`}>
              <span className="block text-sm font-semibold text-foreground">{item.name}</span>
              <span className="block text-xs text-muted">{item.productCode} - {item.unitOfMeasures}</span>
            </button>
          )) : null}
        </div>, document.body,
      ) : null}
    </form>
  )
}

export default InventoryReceiptForm
