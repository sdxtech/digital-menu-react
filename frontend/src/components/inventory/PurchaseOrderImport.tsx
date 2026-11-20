import { useRef, useState } from 'react'
import { apiFetch } from '../../lib/api'

type Preview = {
  groups: {
    reference: string
    alreadyImported: boolean
    rows: {
      row: number
      productCode: string
      name: string
      unitOfMeasures: string
      orderedQuantity: string
      quantity: number | null
      invalidQuantity: boolean
    }[]
  }[]
  skipped: { row: number; productCode: string }[]
}

type Props = { site: string; accessToken: string; onSaved: (count: number) => void; onCancel: () => void }

const field = 'rounded-md border border-border bg-background px-3 py-2 text-sm'

export default function PurchaseOrderImport({ site, accessToken, onSaved, onCancel }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [quantities, setQuantities] = useState<Record<number, string>>({})
  const [receivedDates, setReceivedDates] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const rows = preview?.groups.flatMap((group) => group.alreadyImported ? [] : group.rows) ?? []
  const canConfirm = rows.every(({ row }) => /^\d+(\.\d{1,6})?$/.test(quantities[row]) &&
    Number(quantities[row]) <= 1e12) && rows.some(({ row }) => Number(quantities[row]) > 0) &&
    (preview?.groups.every((group) => group.alreadyImported || Boolean(receivedDates[group.reference])) ?? false)

  const submit = async (action: 'preview' | 'confirm') => {
    if (!file || inFlight.current || (action === 'confirm' && !canConfirm)) return
    inFlight.current = true
    setBusy(true)
    setError('')
    const body = new FormData()
    body.append('file', file)
    const url = `/inventory/receipts/po/${action}?site=${encodeURIComponent(site)}`
    try {
      if (action === 'preview') {
        setPreview(null)
        const result = await apiFetch<Preview>(url, { method: 'POST', body }, accessToken)
        const today = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(new Date())
        setReceivedDates(Object.fromEntries(result.groups.map((group) => [group.reference, today])))
        setQuantities(Object.fromEntries(result.groups.flatMap((group) =>
          group.rows.map(({ row, quantity }) => [row, quantity === null ? '' : String(quantity)]))))
        setPreview(result)
      } else {
        body.append('receivedDates', JSON.stringify(receivedDates))
        body.append('quantities', JSON.stringify(Object.fromEntries(
          rows.map(({ row }) => [row, Number(quantities[row])]),
        )))
        const { count } = await apiFetch<{ count: number }>(url, { method: 'POST', body }, accessToken)
        setFile(null)
        setPreview(null)
        if (fileInput.current) fileInput.current.value = ''
        onSaved(count)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to import purchase orders.')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <form className="space-y-4 rounded-md border border-border bg-surface p-5"
      onSubmit={(event) => event.preventDefault()}>
      <h2 className="font-semibold">Import PO</h2>
      <fieldset disabled={busy} className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm">
            Purchase order (.xlsx)
            <input type="file" accept=".xlsx" className={field} ref={fileInput}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null)
                setPreview(null)
                setError('')
              }} />
          </label>
          <button type="button" disabled={!file || busy} onClick={() => void submit('preview')}
            className="rounded-md border border-primary px-3 py-2 text-sm font-semibold text-primary disabled:opacity-50">
            Preview PO
          </button>
        </div>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {preview && (
          <>
            <p className="text-sm text-muted">
              Check the quantities from column R. Enter 0 for items not received. Each PO can be imported once per site.
            </p>
            {preview.skipped.length > 0 && (
              <details className="text-sm">
                <summary>{preview.skipped.length} rows skipped because their codes do not start with IT</summary>
                <ul className="pl-4">
                  {preview.skipped.map(({ row, productCode }) => <li key={row}>Row {row} · {productCode || 'Empty code'}</li>)}
                </ul>
              </details>
            )}
            {preview.groups.map((group) => (
              <div key={group.reference} className="overflow-x-auto rounded-md border border-black">
                <div className="grid grid-cols-[8rem_0.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-2 px-3 py-2 text-sm">
                  <span className="font-semibold">No. PO</span>
                  <span aria-hidden="true">:</span>
                  <span className="font-semibold [overflow-wrap:anywhere]">
                    {group.reference}{group.alreadyImported && ' · Already imported'}
                  </span>
                  {!group.alreadyImported && (
                    <>
                      <label htmlFor={`po-received-date-${group.reference}`}>Received Date</label>
                      <span aria-hidden="true">:</span>
                      <input id={`po-received-date-${group.reference}`} type="date" required
                        className={`${field} max-w-full justify-self-start`}
                        aria-label={`Received date for ${group.reference}`}
                        value={receivedDates[group.reference] ?? ''}
                        onChange={(event) => {
                          const value = event.target.value
                          setReceivedDates((current) => ({ ...current, [group.reference]: value }))
                        }} />
                    </>
                  )}
                </div>
                <table className="w-full min-w-[768px] table-fixed border-collapse border border-black text-left text-sm [&_th]:border [&_th]:border-black [&_td]:border [&_td]:border-black">
                  <colgroup>
                    <col className="w-16" />
                    <col className="w-44" />
                    <col />
                    <col className="w-28" />
                    <col className="w-44" />
                  </colgroup>
                  <thead className="bg-primary text-white">
                    <tr>{['Row', 'Product code', 'Product Name', 'UOM', 'Received (R)'].map((label) =>
                      <th key={label} scope="col" className="px-3 py-2">{label}</th>)}</tr>
                  </thead>
                  <tbody>
                    {group.rows.map((row) => (
                      <tr key={row.row}>
                        <td className="px-3 py-2">{row.row}</td>
                        <td className="px-3 py-2 [overflow-wrap:anywhere]">{row.productCode}</td>
                        <td className="px-3 py-2">
                          <span className="block max-w-[60ch] whitespace-normal [overflow-wrap:anywhere]">{row.name}</span>
                        </td>
                        <td className="px-3 py-2 [overflow-wrap:anywhere]">{row.unitOfMeasures}</td>
                        <td className="px-3 py-2">
                          {group.alreadyImported ? '—' : (
                            <input className={`${field} w-32`} inputMode="decimal"
                              aria-label={`Received quantity for Excel row ${row.row}`}
                              placeholder={row.invalidQuantity ? 'Invalid in Excel' : 'Enter qty'}
                              value={quantities[row.row]}
                              onChange={(event) => {
                                const value = event.target.value.replace(',', '.')
                                setQuantities((current) => ({ ...current, [row.row]: value }))
                              }} />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </>
        )}
        <div className="flex items-center justify-end gap-3">
          {rows.length > 0 && (
            <button type="button" onClick={() => void submit('confirm')} disabled={!canConfirm || busy}
              className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
              Confirm
            </button>
          )}
          <button type="button" onClick={onCancel}
            className="rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
            Cancel
          </button>
        </div>
      </fieldset>
    </form>
  )
}
