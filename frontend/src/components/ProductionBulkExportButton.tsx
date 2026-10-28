import { useState } from 'react'
import { buildProductionBulkSheets } from '../lib/production-bulk-export'
import { downloadSpreadsheet, type SpreadsheetSheet } from '../lib/spreadsheet-export'

type Props = {
  count: number
  disabled: boolean
  filename: string
  buildBatches: () => SpreadsheetSheet[][]
}

export default function ProductionBulkExportButton({ count, disabled, filename, buildBatches }: Props) {
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')

  const handleExport = async () => {
    if (disabled || !count || exporting) return
    setExporting(true)
    setError('')
    try {
      await downloadSpreadsheet(filename, buildProductionBulkSheets(buildBatches()))
    } catch {
      setError('Failed to export production batches. Try a smaller date range or select a client.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleExport}
        disabled={disabled || !count || exporting}
        title="Export all batches matching the current filters across all pages"
        className="h-10 rounded-lg border border-border bg-white px-3 py-2 text-xs font-medium text-primary hover:bg-background disabled:cursor-not-allowed disabled:opacity-50"
      >
        <i className="bi bi-download mr-2" aria-hidden="true" />
        {exporting ? 'Exporting...' : `Bulk Export (${count})`}
      </button>
      {error ? <p role="alert" className="mt-2 text-xs text-red-600">{error}</p> : null}
    </div>
  )
}
