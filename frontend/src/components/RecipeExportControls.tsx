import { useId } from 'react'
import type { RecipeExportSelection } from '../lib/use-recipe-export-selection'

type Props = { exportState: RecipeExportSelection }

export const RecipeExportToolbar = ({
  exportState,
  variant = 'soft',
}: Props & { variant?: 'soft' | 'primary' }) => (
  <div className="flex flex-wrap items-center gap-2">
    <div className="inline-flex items-center gap-2">
      <span role="status" aria-live="polite" className="text-xs text-muted">
        {exportState.selectedCount === null
          ? exportState.selectionError
            ? 'Selection count unavailable'
            : 'Counting selected recipes...'
          : `${exportState.selectedCount.toLocaleString('en-US')} recipes selected`}
      </span>
      <button
        type="button"
        onClick={exportState.startSelected}
        disabled={!exportState.canExport}
        className={`inline-flex h-9 items-center justify-center gap-2 rounded-md border px-4 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${variant === 'primary' ? 'border-primary bg-primary text-white hover:bg-primary/90' : 'border-primary/40 bg-primary-soft text-primary'}`}
      >
        <i
          className="bi bi-file-earmark-excel text-base leading-none"
          aria-hidden="true"
        />
        Export
      </button>
    </div>
    {exportState.selectionError ? (
      <span role="alert" className="text-xs text-red-600">
        {exportState.selectionError}
      </span>
    ) : null}
  </div>
)

export const RecipeExportCheckbox = ({
  exportState,
  id,
  name,
}: Props & { id?: string; name?: string }) => {
  const header = id === undefined
  return (
    <input
      type="checkbox"
      aria-label={
        header
          ? 'Select all available recipes for export'
          : `Select ${name} for export`
      }
      title={
        header
          ? 'Select all recipes you can access across pages, regardless of the current search and filters.'
          : undefined
      }
      checked={header ? exportState.isAllSelected : exportState.isSelected(id)}
      disabled={exportState.selectionDisabled || (!header && !id)}
      onChange={() =>
        header ? exportState.toggleAll() : exportState.toggle(id)
      }
      ref={(input) => {
        if (input) input.indeterminate = header && exportState.indeterminate
      }}
    />
  )
}

export const RecipeExportDialog = ({ exportState }: Props) => {
  const dialogId = useId()
  const titleId = `${dialogId}-title`
  const descriptionId = `${dialogId}-description`
  if (!exportState.open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="w-full max-w-lg rounded-md border border-border bg-surface p-6 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            exportState.close()
          }
          if (event.key === 'Tab') {
            const buttons =
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                'button:not(:disabled)',
              )
            const first = buttons[0]
            const last = buttons[buttons.length - 1]
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault()
              last?.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault()
              first?.focus()
            }
          }
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id={titleId} className="font-semibold text-foreground">
              Export Recipe
            </h3>
            <p id={descriptionId} className="mt-2 text-sm text-muted">
              Selected recipes are exported to one Excel sheet. The header
              checkbox selects all recipes available to you across pages,
              regardless of the current search and filters.
            </p>
          </div>
          <button
            type="button"
            autoFocus
            onClick={exportState.close}
            aria-label="Close recipe export"
            className="dm-x-button"
          >
            <i className="bi bi-x-lg text-sm leading-none" aria-hidden="true" />
          </button>
        </div>
        <div className="mt-5 space-y-3 text-sm">
          <div role="status" aria-live="polite">
            {exportState.submitting ? (
              <p>Starting recipe export...</p>
            ) : (
              <>
                {exportState.job?.status === 'waiting' ? (
                  <p>Export queued: {exportState.job.total} recipes.</p>
                ) : null}
                {exportState.job?.status === 'processing' ? (
                  <p>
                    {exportState.job.completed >= exportState.job.total
                      ? 'Finalizing Excel file...'
                      : `Exporting recipes: ${exportState.job.completed} / ${exportState.job.total}.`}
                  </p>
                ) : null}
                {exportState.job?.status === 'completed' ? (
                  <p className="font-semibold text-primary">
                    Export ready: {exportState.job.count} recipes.
                  </p>
                ) : null}
                {exportState.job?.status === 'failed' ? (
                  <p>Recipe export failed.</p>
                ) : null}
              </>
            )}
          </div>
          {exportState.busy ? (
            <p className="text-xs text-muted">
              You can close this window and continue working. It will reopen
              when the export is ready.
            </p>
          ) : null}
          {exportState.error ? (
            <p role="alert" className="font-medium text-red-600">
              {exportState.error}
            </p>
          ) : null}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={exportState.close}
            className="rounded-md border border-border bg-background px-4 py-2 text-xs font-semibold text-primary"
          >
            Close
          </button>
          {!exportState.submitting &&
          exportState.job?.status === 'completed' ? (
            <button
              type="button"
              onClick={() => {
                void exportState.download()
              }}
              disabled={exportState.downloading}
              className="rounded-md border border-primary bg-primary px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
            >
              {exportState.downloading
                ? 'Preparing download...'
                : 'Download Excel'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
