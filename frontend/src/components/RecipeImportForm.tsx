import type { ChangeEventHandler, ReactNode } from 'react'
import RecipeImportTemplateDownload from './RecipeImportTemplateDownload'

const RecipeImportForm = ({ siteLabel, siteControl, importing, error, onFileChange, onClose, onImport }: {
  siteLabel?: string
  siteControl?: ReactNode
  importing: boolean
  error: string
  onFileChange: ChangeEventHandler<HTMLInputElement>
  onClose: () => void
  onImport: () => void
}) => (
  <div>
    <div className="flex items-start justify-between gap-4">
      <h3 className="pt-1 text-xl font-semibold text-foreground">Import Recipe from Excel</h3>
      <button type="button" onClick={onClose} disabled={importing} aria-label="Close import recipe"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-primary bg-gray-200 text-primary hover:bg-gray-300 disabled:cursor-not-allowed disabled:opacity-60">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
    <p className="mt-4 text-sm text-muted">Use .xlsx or .xls to import multiple recipes at once.</p>
    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium text-foreground">Import Site:</span>
      {siteControl ?? <span className="text-muted">{siteLabel || 'Not selected'}</span>}
    </div>
    <div className="mt-6">
      <label htmlFor="recipe-import-file" className="text-sm font-medium text-foreground">File</label>
      <input id="recipe-import-file" type="file" accept=".xlsx,.xls"
        disabled={importing} onChange={onFileChange} aria-describedby="recipe-import-template-hint"
        className="mt-2 block w-full rounded-md border border-primary/40 bg-white px-3 py-1 text-sm text-foreground file:mr-3 file:rounded-md file:border file:border-primary file:bg-primary file:px-3 file:py-1 file:text-xs file:font-semibold file:text-white hover:file:bg-primary/90 disabled:opacity-60" />
    </div>
    <p id="recipe-import-template-hint" className="mt-4 text-sm leading-relaxed text-muted">
      Make sure your file follows the import template. Keep its column headers and recipe block layout.{' '}
      <RecipeImportTemplateDownload inline />
    </p>
    <p className="mt-2 text-xs text-muted">Block imports are saved as drafts for review before submitting.</p>
    {error ? <p className="mt-3 text-sm font-medium text-red-600" role="alert">{error}</p> : null}
    <div className="mt-6 flex justify-end gap-3">
      <button type="button" onClick={onClose} disabled={importing}
        className="min-w-24 rounded-md border border-red-600 bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60">Cancel</button>
      <button type="button" onClick={onImport} disabled={importing} aria-busy={importing}
        className="min-w-24 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60">{importing ? 'Importing...' : 'Import'}</button>
    </div>
  </div>
)

export default RecipeImportForm
