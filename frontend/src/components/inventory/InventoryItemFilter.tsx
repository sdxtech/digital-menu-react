import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { InventoryLine } from '../../lib/inventory'

type Props = {
  items: InventoryLine[]
  selected: InventoryLine | null
  onSelect: (item: InventoryLine | null) => void
}

const itemLabel = (item: InventoryLine | null) => item ? `${item.name} · ${item.productCode}` : 'All items'

export default function InventoryItemFilter({ items, selected, onSelect }: Props) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState<string | null>(null)
  const [highlight, setHighlight] = useState(-1)
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 0 })
  const open = query !== null
  const search = query?.trim().toLowerCase() ?? ''
  const matches = open ? [null, ...items].filter((item) => itemLabel(item).toLowerCase().includes(search)) : []

  useLayoutEffect(() => {
    if (!open) return
    const align = () => {
      const rect = inputRef.current?.getBoundingClientRect()
      if (!rect) return
      const below = window.innerHeight - rect.bottom - 8
      const above = below < 160 && rect.top > below
      const maxHeight = Math.min(240, Math.max(0, above ? rect.top - 8 : below))
      setPosition({ left: rect.left, top: above ? rect.top - maxHeight - 4 : rect.bottom + 4, width: rect.width, maxHeight })
    }
    align()
    window.addEventListener('resize', align)
    window.addEventListener('scroll', align, true)
    return () => {
      window.removeEventListener('resize', align)
      window.removeEventListener('scroll', align, true)
    }
  }, [open])

  useEffect(() => {
    if (open && highlight >= 0) document.getElementById(`${id}-${highlight}`)?.scrollIntoView({ block: 'nearest' })
  }, [highlight, id, open])

  const startSearch = () => {
    if (!open) { setQuery(''); setHighlight(-1) }
  }
  const select = (item: InventoryLine | null) => {
    onSelect(item)
    setQuery(null)
  }

  return (
    <div className="grid min-w-0 gap-1 text-sm">
      <label htmlFor={id}>Item</label>
      <div className="relative">
        <input ref={inputRef} id={id} type="text" role="combobox" autoComplete="off"
          className="w-full rounded-md border border-border bg-background py-2 pl-3 pr-8"
          aria-autocomplete="list" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined}
          aria-activedescendant={open && highlight >= 0 ? `${id}-${highlight}` : undefined}
          value={query ?? itemLabel(selected)} placeholder="Search item name or code"
          onFocus={startSearch} onClick={startSearch} onBlur={() => setQuery(null)}
          onChange={(event) => { setQuery(event.target.value); setHighlight(-1) }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setQuery(null)
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              startSearch()
              const count = open ? matches.length : items.length + 1
              setHighlight(event.key === 'ArrowDown' ? Math.min(count - 1, open ? highlight + 1 : 0)
                : !open || highlight <= 0 ? count - 1 : highlight - 1)
            }
            if (event.key === 'Enter' && open && matches.length) {
              event.preventDefault()
              select(matches[Math.max(0, highlight)])
            }
          }} />
        <i aria-hidden="true" className="bi bi-chevron-down pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs" />
      </div>
      {open && createPortal(
        <div id={`${id}-list`} role="listbox" aria-label="Inventory items" style={position}
          className="fixed z-50 overflow-y-auto rounded-md border border-border bg-surface text-sm shadow-lg"
          onMouseDown={(event) => event.preventDefault()}>
          {matches.map((item, index) => (
            <div key={item?.productCode ?? ''} id={`${id}-${index}`} role="option"
              aria-selected={selected?.productCode === item?.productCode}
              className={`cursor-pointer px-3 py-2 hover:bg-background ${highlight === index ? 'bg-background' : ''}`}
              onClick={() => select(item)}>{itemLabel(item)}</div>
          ))}
          {!matches.length && <p role="status" className="px-3 py-2 text-muted">No matching items.</p>}
        </div>, document.body,
      )}
    </div>
  )
}
