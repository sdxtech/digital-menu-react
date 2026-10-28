import { useId, useRef, useState } from 'react'
import {
  buildProductionBulkSheets,
  filterProductionExportGroups,
  type ProductionExportGroup,
} from '../lib/production-bulk-export'
import { downloadSpreadsheet, type SpreadsheetSheet } from '../lib/spreadsheet-export'

type Props<T extends ProductionExportGroup> = {
  groups: T[]
  disabled: boolean
  filename: string
  buildBatch: (group: T) => SpreadsheetSheet[]
}

export default function ProductionBulkExportButton<T extends ProductionExportGroup>({ groups, disabled, filename, buildBatch }: Props<T>) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const id = useId()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [client, setClient] = useState('')
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const invalidRange = Boolean(from && to && from > to)
  const selectedGroups = filterProductionExportGroups(groups, from, to, client)
  const clients = new Map<string, string>()
  groups.forEach((group) => group.items.forEach((item) => {
    const name = item.clientName?.trim()
    if (name && !clients.has(name.toLowerCase())) clients.set(name.toLowerCase(), name)
  }))
  const clientOptions = Array.from(clients.values()).sort((a, b) => a.localeCompare(b))

  const handleExport = async () => {
    if (disabled || invalidRange || !selectedGroups.length || exporting) return
    setExporting(true)
    setError('')
    try {
      await downloadSpreadsheet(filename, buildProductionBulkSheets(selectedGroups.map(buildBatch)))
      dialogRef.current?.close()
    } catch {
      setError('Failed to export production batches. Try a smaller date range or select a client.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setFrom('')
          setTo('')
          setClient('')
          setError('')
          dialogRef.current?.showModal()
        }}
        disabled={disabled || !groups.length || exporting}
        className="h-10 rounded-lg border border-emerald-700 bg-emerald-700 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <i className="bi bi-file-earmark-excel mr-2" aria-hidden="true" />
        Bulk Export
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        onCancel={(event) => { if (exporting) event.preventDefault() }}
        className="m-auto w-[calc(100%_-_2rem)] max-w-lg rounded-xl border border-border bg-white p-6 text-primary shadow-xl backdrop:bg-black/40"
      >
        <form onSubmit={(event) => { event.preventDefault(); void handleExport() }}>
          <h3 id={`${id}-title`} className="text-lg font-semibold">Bulk Export Production</h3>
          <p id={`${id}-description`} className="mt-2 text-sm text-muted">
            Choose the production date range and/or client to export. Leave blank to include all available dates or clients.
          </p>
          <fieldset disabled={exporting} className="mt-5 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor={`${id}-from`} className="mb-1 block text-sm font-medium">Production date from</label>
                <input id={`${id}-from`} type="date" value={from} onChange={(event) => setFrom(event.target.value)}
                  className="h-10 w-full rounded-lg border border-border px-3 text-sm" />
              </div>
              <div>
                <label htmlFor={`${id}-to`} className="mb-1 block text-sm font-medium">Production date to</label>
                <input id={`${id}-to`} type="date" value={to} onChange={(event) => setTo(event.target.value)}
                  className="h-10 w-full rounded-lg border border-border px-3 text-sm" />
              </div>
            </div>
            <div>
              <label htmlFor={`${id}-client`} className="mb-1 block text-sm font-medium">Client</label>
              <select id={`${id}-client`} value={client} onChange={(event) => setClient(event.target.value)}
                className="h-10 w-full rounded-lg border border-border bg-white px-3 text-sm">
                <option value="">All clients</option>
                {clientOptions.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </div>
          </fieldset>
          {invalidRange ? <p role="alert" className="mt-3 text-sm text-red-600">Start date must be on or before end date.</p> : null}
          <p role="status" className="mt-4 text-sm text-muted">
            {selectedGroups.length} production batches match the export settings.
          </p>
          {error ? <p role="alert" className="mt-3 text-sm text-red-600">{error}</p> : null}
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" onClick={() => dialogRef.current?.close()} disabled={exporting}
              className="rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={disabled || invalidRange || !selectedGroups.length || exporting}
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">
              {exporting ? 'Exporting...' : 'Export Excel'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}
