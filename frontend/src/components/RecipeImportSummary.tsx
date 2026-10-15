import { Link } from 'react-router-dom'
import type { RecipeImportResult } from '../lib/chef-data'

export type RecipeImportSummaryResult = RecipeImportResult & { fileName: string }

const RecipeImportSummary = ({ result, draftsPath, onClose, onImportAnother }: {
  result: RecipeImportSummaryResult
  draftsPath: string
  onClose: () => void
  onImportAnother: () => void
}) => {
  const hasIssues = result.warningsCount > 0
  const imported = result.insertedCount > 0
  const draftCount = result.draftsCount ?? 0
  return (
    <div>
      <div className="flex items-start gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-4" role="status">
          <div className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border-2 ${hasIssues || !imported ? 'border-amber-500 bg-amber-50 text-foreground ring-2 ring-primary/40 ring-offset-2 ring-offset-surface' : 'border-emerald-500 bg-emerald-50 text-emerald-700'}`}>
            <i className={`bi ${hasIssues || !imported ? 'bi-exclamation-triangle' : 'bi-check-circle'} text-3xl`} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-foreground">
              {!imported ? 'No recipes imported' : hasIssues ? 'Imported with Issues' : 'Import completed'}
            </h3>
            <p className="mt-1 break-words text-sm text-muted">File name: {result.fileName}</p>
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close import result"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-primary bg-gray-200 text-primary hover:bg-gray-300">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <dl className="mt-6 grid grid-cols-3 gap-3 text-center">
        {[
          { label: 'Recipes imported', value: result.insertedCount },
          { label: 'Saved as drafts', value: draftCount },
          { label: 'Issues to review', value: result.warningsCount ?? 0 },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl border border-border bg-background px-2 py-4">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className={`mt-2 text-2xl font-semibold ${label === 'Issues to review' && hasIssues ? 'text-amber-700' : 'text-primary'}`}>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-center text-sm text-muted">
        {draftCount > 0
          ? hasIssues ? 'Your drafts are saved. Resolve their issues before submitting.' : 'Your drafts are ready to review before submitting.'
          : hasIssues ? 'Review the import issues before trying again.' : 'The import has finished.'}
      </p>
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <button type="button" onClick={onImportAnother}
          className="rounded-md border border-border px-4 py-3 text-sm font-semibold text-primary hover:bg-primary-soft">Import another file</button>
        {draftCount > 0 ? (
          <Link to={draftsPath} className="rounded-md bg-primary px-4 py-3 text-sm font-semibold text-white hover:bg-primary/90">Open Recipe Drafts</Link>
        ) : (
          <button type="button" onClick={onClose} className="rounded-md bg-primary px-4 py-3 text-sm font-semibold text-white hover:bg-primary/90">Done</button>
        )}
      </div>
    </div>
  )
}

export default RecipeImportSummary
