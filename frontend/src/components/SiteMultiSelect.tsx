import { useEffect, useRef, useState } from 'react'

type SiteOption = { code: string; name: string }

const SiteMultiSelect = ({ options, selected, onChange, disabled = false }: {
  options: SiteOption[]
  selected: string[] | null
  onChange: (sites: string[] | null) => void
  disabled?: boolean
}) => {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const allCheckboxRef = useRef<HTMLInputElement>(null)
  const codes = selected ?? options.map((site) => site.code)
  const allSelected = options.length > 0 && codes.length === options.length
  const visibleOptions = options.filter((site) =>
    `${site.name} ${site.code}`.toLowerCase().includes(search.trim().toLowerCase()),
  )
  const summary = allSelected || selected === null
    ? 'All approval sites'
    : codes.length === 1
      ? options.find((site) => site.code === codes[0])?.name ?? codes[0]
      : codes.length ? `${codes.length} sites selected` : 'Select sites'

  useEffect(() => {
    if (allCheckboxRef.current) allCheckboxRef.current.indeterminate = codes.length > 0 && !allSelected
  }, [allSelected, codes.length, open])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative mt-2">
      <button
        type="button"
        aria-label={`Site filter: ${summary}`}
        aria-expanded={open && !disabled}
        aria-controls="approval-site-options"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-border bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20 disabled:opacity-60"
      >
        <span className="truncate">{summary}</span>
        <i className={`bi bi-chevron-down text-xs ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && !disabled ? (
        <div id="approval-site-options" className="absolute left-0 top-full z-40 mt-2 w-full min-w-[280px] rounded-xl border border-border bg-white p-3 shadow-xl">
          <input
            type="search"
            aria-label="Search sites"
            placeholder="Search sites..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="mb-3 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-accent-blue"
          />
          <label className="mb-2 flex cursor-pointer items-center gap-2 border-b border-border pb-3 text-sm font-semibold">
            <input
              ref={allCheckboxRef}
              type="checkbox"
              checked={allSelected}
              disabled={!options.length}
              onChange={(event) => onChange(event.target.checked ? null : [])}
              className="h-4 w-4 rounded border-border text-primary"
            />
            All approval sites
          </label>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {visibleOptions.map((site) => (
              <label key={site.code} className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-2 text-sm hover:bg-primary-soft">
                <input
                  type="checkbox"
                  checked={codes.includes(site.code)}
                  onChange={(event) => onChange(event.target.checked
                    ? [...codes, site.code]
                    : codes.filter((code) => code !== site.code))}
                  className="h-4 w-4 shrink-0 rounded border-border text-primary"
                />
                <span>{site.name || site.code}</span>
              </label>
            ))}
            {!visibleOptions.length ? <p className="py-2 text-xs text-muted">No matching sites.</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default SiteMultiSelect
