import { useRef, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { downloadSpreadsheet } from '../../lib/spreadsheet-export'
import type { InventoryPreview } from '../../lib/inventory'

type Props = { site: string; accessToken: string; onSaved: () => void; additional?: boolean }

const OpeningInventory = ({ site, accessToken, onSaved, additional = false }: Props) => {
  const [preview, setPreview] = useState<InventoryPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)

  const upload = async (file?: File) => {
    if (!file || inFlight.current) return
    setPreview(null)
    setError('')
    if (
      !file.name.toLowerCase().endsWith('.xlsx') ||
      file.size > 2 * 1024 * 1024
    ) {
      setError('Choose an .xlsx file up to 2 MB.')
      return
    }
    inFlight.current = true
    setBusy(true)
    try {
      const body = new FormData()
      body.append('file', file)
      setPreview(
        await apiFetch<InventoryPreview>(
          `/inventory/opening/preview?site=${encodeURIComponent(site)}`,
          { method: 'POST', body },
          accessToken,
        ),
      )
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Failed to preview opening inventory.',
      )
    } finally {
      setBusy(false)
      inFlight.current = false
    }
  }

  const confirm = async () => {
    if (!preview?.valid || !preview.previewId || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      await apiFetch(
        `/inventory/opening/confirm?site=${encodeURIComponent(site)}`,
        {
          method: 'POST',
          body: JSON.stringify({ previewId: preview.previewId }),
        },
        accessToken,
      )
      onSaved()
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Failed to activate inventory.',
      )
    } finally {
      setBusy(false)
      inFlight.current = false
    }
  }

  return (
    <section className="space-y-4 rounded-md border border-border bg-surface p-5">
      <div>
        <h2 className="text-base font-semibold">{additional ? 'Add opening balance' : 'Activate inventory'} — {site}</h2>
        <p className="mt-1 text-sm text-muted">
          {additional ? 'Upload new IT items with their physical opening quantities and master SR units. Each item must have no inventory history at this site. Balances are recorded on the confirmation date.' : <>Import the physical opening balance for this site. Confirming
          activates inventory immediately. Previously completed Store Requests
          are excluded; subsequent issuances reduce stock.</>}
        </p>
        {!additional && <p className="mt-1 text-xs text-muted">
          One import per site. Items omitted from the file start at zero. NMP
          items are excluded. Use numeric quantities and each item’s master SR
          unit.
        </p>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            downloadSpreadsheet('Inventory-Opening-Template.xlsx', [
              {
                name: 'Opening Inventory',
                rows: [['Kode Item', 'Satuan', 'Jumlah Stok Awal']],
              },
            ])
          }
          className="rounded-md border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          Download template
        </button>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">
            Opening balance Excel (.xlsx, max 2 MB)
          </span>
          <input
            type="file"
            accept=".xlsx"
            disabled={busy}
            onChange={(event) => {
              void upload(event.target.files?.[0])
              event.target.value = ''
            }}
            className="max-w-full text-sm"
          />
        </label>
      </div>
      {busy ? (
        <p role="status" className="text-sm text-muted">
          Processing inventory...
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
      {preview ? (
        <>
          <p className="text-sm font-medium">
            {preview.rows.length} rows ·{' '}
            {preview.valid
              ? 'Ready to import'
              : 'Correct all errors in Excel and upload again'}
          </p>
          <div className="max-h-96 overflow-auto rounded-md border border-border">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-background">
                <tr>
                  {[
                    'Row',
                    'Item code',
                    'Item name',
                    'Unit',
                    'Opening quantity',
                    'Validation',
                  ].map((label) => (
                    <th key={label} className="p-3">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.row} className="border-t border-border">
                    <td className="p-3">{row.row}</td>
                    <td className="p-3">{row.productCode}</td>
                    <td className="p-3">{row.name ?? '—'}</td>
                    <td className="p-3">{row.unitOfMeasures}</td>
                    <td className="p-3">{row.quantity ?? 'Invalid'}</td>
                    <td
                      className={`p-3 ${row.error ? 'text-red-600' : 'text-green-700'}`}
                    >
                      {row.error ?? 'Valid'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            disabled={!preview.valid || busy}
            onClick={() => void confirm()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {additional ? 'Confirm opening balance' : `Confirm opening balance & activate ${site}`}
          </button>
        </>
      ) : null}
    </section>
  )
}

export default OpeningInventory
