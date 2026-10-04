import { useEffect, useId, useRef, useState } from 'react'
import { getApprovalStatusLabel } from '../lib/status-labels'

type RecipeStatus = 'draft' | 'active'
type ApprovalStatus = '' | 'pending' | 'approved' | 'rejected'

type RecipeFiltersProps = {
  searchTerm: string
  onSearchChange: (value: string) => void
  onSearch: () => void
  statuses: RecipeStatus[]
  approvalStatus: ApprovalStatus
  categories: string[]
  selectedCategories: string[]
  onStatusesChange: (statuses: RecipeStatus[]) => void
  onApprovalStatusChange: (status: ApprovalStatus) => void
  onCategoriesChange: (categories: string[]) => void
}

const fieldClassName =
  'h-10 w-full rounded-xl border border-border bg-white px-3 py-2 text-sm text-primary shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20'

const RecipeFilters = ({
  searchTerm,
  onSearchChange,
  onSearch,
  statuses,
  approvalStatus,
  categories,
  selectedCategories,
  onStatusesChange,
  onApprovalStatusChange,
  onCategoriesChange,
}: RecipeFiltersProps) => {
  const [openField, setOpenField] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const id = useId()

  useEffect(() => {
    if (!openField) return
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setOpenField(null)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        containerRef.current?.querySelector<HTMLButtonElement>(`[aria-controls="${id}-${openField}"]`)?.focus()
        setOpenField(null)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [id, openField])

  const fields = [
    {
      key: 'status',
      label: 'Recipe status',
      options: (['draft', 'active'] as const).map((value) => ({
        value,
        label: value === 'active' ? 'Active' : 'Draft',
      })),
      selected: statuses,
      onToggle: (value: string) => {
        const status = value as RecipeStatus
        onStatusesChange(statuses.includes(status)
          ? statuses.filter((item) => item !== status)
          : [...statuses, status])
      },
      onReset: () => onStatusesChange([]),
    },
    {
      key: 'category',
      label: 'Category',
      options: categories.map((value) => ({ value, label: value })),
      selected: selectedCategories,
      onToggle: (value: string) => onCategoriesChange(selectedCategories.includes(value)
        ? selectedCategories.filter((item) => item !== value)
        : [...selectedCategories, value]),
      onReset: () => onCategoriesChange([]),
    },
  ]

  return (
    <div ref={containerRef} className="flex flex-wrap items-center gap-3 py-2">
      <form
        className="flex w-full items-center gap-3 sm:w-auto"
        onSubmit={(event) => {
          event.preventDefault()
          setOpenField(null)
          onSearch()
        }}
      >
        <div className="min-w-0 flex-1 sm:w-64 md:w-72">
          <label htmlFor={`${id}-search`} className="sr-only">Search recipes</label>
          <input
            id={`${id}-search`}
            type="search"
            value={searchTerm}
            onChange={(event) => onSearchChange(event.target.value)}
            onFocus={() => setOpenField(null)}
            placeholder="Search recipes..."
            className={fieldClassName}
          />
        </div>
        <button
          type="submit"
          className="h-10 shrink-0 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white"
        >
          Search
        </button>
      </form>
      {fields.map((field) => (
        <div key={field.key} className={`relative w-full sm:w-60 ${field.key === 'status' ? 'order-1' : 'order-3'}`}>
          <button
            type="button"
            aria-expanded={openField === field.key}
            aria-controls={`${id}-${field.key}`}
            onClick={() => setOpenField(openField === field.key ? null : field.key)}
            className={`${fieldClassName} flex items-center justify-between gap-2`}
          >
            <span className="truncate">
              {field.label}{field.selected.length ? ` (${field.selected.length})` : ''}
            </span>
            <i className={`bi bi-chevron-down text-xs transition-transform ${openField === field.key ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
          {openField === field.key ? (
            <div id={`${id}-${field.key}`} className="absolute left-0 top-full z-40 mt-2 w-full rounded-xl border border-border bg-white p-4 shadow-xl">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-xs text-muted">{field.label}</p>
                <button type="button" onClick={field.onReset} className="text-xs font-semibold text-primary">Reset</button>
              </div>
              <div className="max-h-48 space-y-2 overflow-y-auto">
                {field.options.length ? field.options.map((option) => (
                  <label key={option.value} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={field.selected.some((value) => value === option.value)}
                      onChange={() => field.onToggle(option.value)}
                      className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-primary/30"
                    />
                    <span>{option.label}</span>
                  </label>
                )) : <p className="text-xs text-muted">No categories yet.</p>}
              </div>
            </div>
          ) : null}
        </div>
      ))}
      <div className="order-2 w-full sm:w-60">
        <label htmlFor={`${id}-approval`} className="sr-only">Approval status</label>
        <select
          id={`${id}-approval`}
          value={approvalStatus}
          onFocus={() => setOpenField(null)}
          onChange={(event) => onApprovalStatusChange(event.target.value as ApprovalStatus)}
          className={fieldClassName}
        >
          <option value="">Approval status</option>
          {(['pending', 'approved', 'rejected'] as const).map((status) => (
            <option key={status} value={status}>{getApprovalStatusLabel(status)}</option>
          ))}
        </select>
      </div>
      <button
        type="button"
        onClick={() => {
          onStatusesChange([])
          onApprovalStatusChange('')
          onCategoriesChange([])
          setOpenField(null)
        }}
        className="order-4 h-10 rounded-lg border border-border bg-white px-3 py-2 text-xs font-medium text-primary hover:bg-background"
      >
        Reset filters
      </button>
    </div>
  )
}

export default RecipeFilters
