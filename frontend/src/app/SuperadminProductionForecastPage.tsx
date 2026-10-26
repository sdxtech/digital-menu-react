import { Fragment, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import PageHeading from '../components/PageHeading'
import ActionButton from '../components/ActionButton'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useChefData, type Recipe } from '../lib/chef-data'
import { formatVersionedRecipeName } from '../lib/recipe-version'
import { summarizePortionsByGroup } from '../lib/menu-production-quantity'
import { formatQuantity } from '../lib/quantity'
import { formatUnitLabel } from '../lib/unit-of-measures'
import {
  createForecastRow, forecastDate, forecastKey, forecastRecipeCostPerPax,
  forecastIngredientAmounts, forecastRowCost, parseForecastDrafts, shiftForecastDate,
  type ForecastDrafts, type ForecastRow,
} from '../lib/production-forecast'

type Site = { code: string; name: string }
type Client = { id?: string; _id?: string; clientId: string; name: string }
type Group = { id?: string; _id?: string; name: string }
type Page<T> = { items?: T[]; totalPages?: number; total?: number; limit?: number }

const inputClass = 'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60'
const money = (amount: number | null) => amount === null ? '—' : new Intl.NumberFormat('id-ID', {
  style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
}).format(amount)
const dateLabel = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', options).format(new Date(`${date}T12:00:00`))

const SuperadminProductionForecastPage = () => {
  const { user } = useAuth()
  return <ForecastWorkspace key={user?.id ?? user?.email} />
}

const ForecastRecipeDetails = ({ row, site }: { row: ForecastRow; site: string }) => {
  const { accessToken, user } = useAuth()
  const { fetchRecipesByIds } = useChefData()
  const recipeQuery = useQuery({
    queryKey: ['production-forecast', 'recipe-details', user?.id, site, row.recipeId],
    enabled: Boolean(accessToken && row.recipeId),
    queryFn: async () => {
      const recipes = await fetchRecipesByIds([row.recipeId])
      return recipes.find((recipe) => recipe.id === row.recipeId) ?? null
    },
  })

  if (recipeQuery.isPending) return <p role="status" className="text-sm text-muted">Loading recipe details…</p>
  if (recipeQuery.isError) return <div role="alert" className="flex items-center gap-3 text-sm text-red-600">
    <span>Could not load recipe details.</span>
    <button type="button" className="underline" onClick={() => void recipeQuery.refetch()}>Retry</button>
  </div>
  const recipe = recipeQuery.data
  if (!recipe) return <p className="text-sm text-muted">This recipe is no longer available.</p>

  return <div className="rounded-md border border-border bg-surface p-4">
    <h3 className="text-sm font-semibold">{formatVersionedRecipeName(recipe)} — Ingredients</h3>
    <p className="mt-1 text-xs text-muted">
      {row.portion === ''
        ? `Qty and ingredient cost shown for base portions (${recipe.portionSize}).`
        : `Qty and ingredient cost calculated for ${row.portion} portions from base portions (${recipe.portionSize}).`}
      {' '}Vendor and prices use the saved recipe data.
    </p>
    {recipe.ingredients.length ? <div className="mt-3 overflow-x-auto rounded-md border border-border">
      <table className="w-full text-left text-xs">
        <thead className="bg-primary uppercase text-surface"><tr>
          {['No', 'Product code', 'Ingredient', 'Qty', 'UOM', 'Vendor', 'Price', 'Ingredient cost'].map((heading) =>
            <th key={heading} scope="col" className="whitespace-nowrap px-4 py-3 font-semibold leading-[1.2]">{heading}</th>)}
        </tr></thead>
        <tbody>{recipe.ingredients.map((ingredient, index) => {
          const amounts = forecastIngredientAmounts(ingredient, recipe.portionSize, row.portion)
          const price = ingredient.priceUom !== undefined && Number.isFinite(ingredient.priceUom) && ingredient.priceUom >= 0
            ? ingredient.priceUom : null
          return <tr key={`${ingredient.productCode}-${index}`} className="border-t border-border">
            <td className="px-4 py-3 text-muted">{index + 1}</td>
            <td className="whitespace-nowrap px-4 py-3">{ingredient.productCode || '—'}</td>
            <td className="min-w-48 px-4 py-3">{ingredient.name || '—'}</td>
            <td className="whitespace-nowrap px-4 py-3">{amounts.qty === null ? '—' : formatQuantity(amounts.qty)}</td>
            <td className="px-4 py-3">{formatUnitLabel(ingredient.unitOfMeasures) || '—'}</td>
            <td className="px-4 py-3">{ingredient.vendor || '—'}</td>
            <td className="whitespace-nowrap px-4 py-3">{money(price)}</td>
            <td className="whitespace-nowrap px-4 py-3 font-semibold">{money(amounts.cost)}</td>
          </tr>
        })}</tbody>
      </table>
    </div> : <p className="mt-3 text-sm text-muted">No ingredients saved for this recipe.</p>}
  </div>
}

const ForecastWorkspace = () => {
  const { accessToken, user } = useAuth()
  const { searchRecipes } = useChefData()
  const [today] = useState(() => forecastDate(new Date()))
  const [startDate, setStartDate] = useState(() => shiftForecastDate(today, -new Date(`${today}T12:00:00`).getDay()))
  const [endDate, setEndDate] = useState(() => shiftForecastDate(startDate, 6))
  const [selectedDate, setSelectedDate] = useState(today)
  const [weekStart, setWeekStart] = useState(startDate)
  const [site, setSite] = useState('')
  const [client, setClient] = useState('')
  const storageKey = `dm-production-forecast-v1:${user?.id ?? user?.email}`
  const [initialDraft] = useState(() => {
    try {
      return { drafts: parseForecastDrafts(localStorage.getItem(storageKey)), error: '' }
    } catch {
      return { drafts: {} as ForecastDrafts, error: 'Saved drafts could not be loaded. Browser storage may be unavailable or the saved data is invalid.' }
    }
  })
  const [drafts, setDrafts] = useState(initialDraft.drafts)
  const [error, setError] = useState(initialDraft.error)
  const [message, setMessage] = useState('')
  const [dirty, setDirty] = useState(false)
  const [recipeRowId, setRecipeRowId] = useState('')
  const [expandedDetails, setExpandedDetails] = useState<{ scope: string; rowId: string } | null>(null)
  const [recipeSearch, setRecipeSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const recipeInputRef = useRef<HTMLInputElement | null>(null)
  const recipeDropdownRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(recipeSearch.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [recipeSearch])

  useEffect(() => {
    if (!recipeRowId) return

    let animationFrame = 0
    const syncPosition = () => {
      const input = recipeInputRef.current
      const dropdown = recipeDropdownRef.current
      if (input && dropdown) {
        const bounds = input.getBoundingClientRect()
        const availableBelow = window.innerHeight - bounds.bottom - 20
        const availableAbove = bounds.top - 20
        const naturalHeight = Math.min(280, dropdown.scrollHeight)
        const below = availableBelow >= Math.min(naturalHeight, 160)
        const maxHeight = Math.max(100, Math.min(280, below ? availableBelow : availableAbove))
        const width = Math.min(Math.max(bounds.width, 420), window.innerWidth - 32)

        dropdown.style.left = `${Math.min(Math.max(16, bounds.left), window.innerWidth - width - 16)}px`
        dropdown.style.top = `${below ? bounds.bottom + 4 : Math.max(8, bounds.top - Math.min(naturalHeight, maxHeight) - 4)}px`
        dropdown.style.width = `${width}px`
        dropdown.style.maxHeight = `${maxHeight}px`
        dropdown.style.borderRadius = below ? '0 0 0.75rem 0.75rem' : '0.75rem 0.75rem 0 0'
        dropdown.style.visibility = 'visible'
      }
      animationFrame = window.requestAnimationFrame(syncPosition)
    }
    animationFrame = window.requestAnimationFrame(syncPosition)
    return () => window.cancelAnimationFrame(animationFrame)
  }, [recipeRowId])

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const optionsQuery = useQuery({
    queryKey: ['production-forecast', 'options'],
    enabled: Boolean(accessToken),
    queryFn: async ({ signal }) => {
      const loadPages = async <T,>(path: string) => {
        const first = await apiFetch<Page<T>>(`${path}&page=1&limit=100`, { signal }, accessToken ?? undefined)
        const items = [...(first.items ?? [])]
        const totalPages = first.totalPages ?? Math.ceil((first.total ?? items.length) / (first.limit ?? 100))
        for (let page = 2; page <= totalPages; page++) {
          const next = await apiFetch<Page<T>>(`${path}&page=${page}&limit=100`, { signal }, accessToken ?? undefined)
          items.push(...(next.items ?? []))
        }
        return items
      }
      const [sites, groups] = await Promise.all([
        loadPages<Site>('/superadmin/sites?isActive=true'),
        loadPages<Group>('/menu-groups?isActive=true'),
      ])
      return { sites, groups }
    },
  })
  const clientsQuery = useQuery({
    queryKey: ['production-forecast', 'clients', site],
    enabled: Boolean(accessToken && site),
    queryFn: ({ signal }) => apiFetch<Page<Client>>(
      `/clients/by-site/${encodeURIComponent(site)}`, { signal }, accessToken ?? undefined,
    ),
  })
  const recipesQuery = useQuery({
    queryKey: ['production-forecast', 'recipes', site, debouncedSearch],
    enabled: Boolean(site && recipeRowId && debouncedSearch.length >= 2),
    queryFn: () => searchRecipes(debouncedSearch, { site, limit: 20 }),
  })
  const recipeSuggestions = recipesQuery.data?.filter((recipe) =>
    recipe.isActive && !recipe.isDraft && recipe.approvalStatus === 'approved') ?? []

  const validRange = Boolean(startDate && endDate && startDate <= endDate)
  const scopeReady = Boolean(validRange && site && client)
  const key = forecastKey(site, client, selectedDate)
  const rows = drafts[key] ?? []
  const rangeEntries = Object.entries(drafts).filter(([entryKey]) => {
    const [entrySite, entryClient, date] = JSON.parse(entryKey) as string[]
    return entrySite === site && entryClient === client && date >= startDate && date <= endDate
  })
  const dayCost = rows.reduce((sum, row) => sum + (forecastRowCost(row) ?? 0), 0)
  const dayIncomplete = rows.some((row) => !row.group || forecastRowCost(row) === null)
  const dayPax = summarizePortionsByGroup(rows.map((row) => ({ group: row.group, portion: Number(row.portion) }))).total
  const rangeIncomplete = rangeEntries.some(([, entries]) => entries.some((row) => !row.group || forecastRowCost(row) === null))
  const rangeCost = rangeEntries.reduce((sum, [, entries]) => sum + entries.reduce((total, row) => total + (forecastRowCost(row) ?? 0), 0), 0)
  const days = Array.from({ length: 7 }, (_, index) => shiftForecastDate(weekStart, index))
  const optionError = optionsQuery.error ?? clientsQuery.error

  const closeRecipeSearch = () => {
    setRecipeRowId('')
    setRecipeSearch('')
    setDebouncedSearch('')
  }
  const updateRows = (next: ForecastRow[]) => {
    setDrafts((current) => ({ ...current, [key]: next }))
    setDirty(true)
    setMessage('')
    setError('')
  }
  const patchRow = (id: string, patch: Partial<ForecastRow>) =>
    updateRows(rows.map((row) => row.id === id ? { ...row, ...patch } : row))

  const changeRange = (start: string, end: string) => {
    setStartDate(start)
    setEndDate(end)
    closeRecipeSearch()
    if (start && end && start <= end) {
      setWeekStart(start)
      if (selectedDate < start || selectedDate > end) setSelectedDate(start)
    }
  }
  const selectRecipe = (recipe: Recipe) => {
    patchRow(recipeRowId, {
      recipeId: recipe.id, recipeCode: recipe.recipeCode ?? recipe.id,
      menu: formatVersionedRecipeName(recipe), category: recipe.category,
      costPerPax: forecastRecipeCostPerPax(recipe),
    })
    closeRecipeSearch()
  }
  const save = () => {
    setError('')
    setMessage('')
    for (const [entryKey, entries] of Object.entries(drafts)) {
      const [, , date] = JSON.parse(entryKey) as string[]
      const invalidIndex = entries.findIndex((row) => !row.group || !row.recipeId ||
        row.portion === '' || !Number.isFinite(row.portion) || row.portion <= 0 || forecastRowCost(row) === null)
      if (invalidIndex !== -1) {
        setError(`${date}, row ${invalidIndex + 1}: select a group and recipe with complete ingredient costs, and enter a portion greater than zero.`)
        return
      }
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify(drafts))
      setDirty(false)
      setMessage('All forecast drafts saved in this browser.')
    } catch {
      setError('Could not save drafts. Check browser storage availability and try again.')
    }
  }

  return (
    <div className="space-y-5">
      <PageHeading className="text-2xl font-semibold">Production Forecast</PageHeading>

      <section className="space-y-5 rounded-md border border-border bg-surface p-4 shadow-sm md:p-6" aria-label="Production forecast planner">
        <div className="grid items-end gap-4 lg:grid-cols-3">
          <div className="grid min-w-0 grid-cols-2 gap-2">
            <label className="block min-w-0 text-xs font-semibold uppercase text-muted">From date
              <input type="date" className={`${inputClass} mt-2 font-normal normal-case`} value={startDate} max={endDate || undefined} onChange={(event) => changeRange(event.target.value, endDate)} />
            </label>
            <label className="block min-w-0 text-xs font-semibold uppercase text-muted">To date
              <input type="date" className={`${inputClass} mt-2 font-normal normal-case`} value={endDate} min={startDate || undefined} onChange={(event) => changeRange(startDate, event.target.value)} />
            </label>
          </div>
          <label className="block text-xs font-semibold uppercase text-muted">Site
            <select className={`${inputClass} mt-2 font-normal normal-case`} value={site} disabled={optionsQuery.isPending || optionsQuery.isError} onChange={(event) => {
              setSite(event.target.value); setClient(''); closeRecipeSearch(); setMessage('')
            }}>
              <option value="">{optionsQuery.isPending ? 'Loading sites…' : 'Select site'}</option>
              {optionsQuery.data?.sites.map((item) => <option key={item.code} value={item.code}>{item.name} ({item.code})</option>)}
            </select>
          </label>
          <label className="block text-xs font-semibold uppercase text-muted">Client
            <select className={`${inputClass} mt-2 font-normal normal-case`} value={client} disabled={!site || clientsQuery.isPending || clientsQuery.isError} onChange={(event) => { setClient(event.target.value); closeRecipeSearch(); setMessage('') }}>
              <option value="">{!site ? 'Select site first' : clientsQuery.isPending ? 'Loading clients…' : clientsQuery.data?.items?.length ? 'Select client' : 'No clients for this site'}</option>
              {clientsQuery.data?.items?.map((item) => <option key={item.id ?? item._id ?? item.clientId} value={item.clientId}>{item.name} ({item.clientId})</option>)}
            </select>
          </label>
        </div>
        {!validRange && <p role="alert" className="text-sm text-red-600">Choose a valid start and end date.</p>}
        {optionError && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-red-600">
          <span>{optionError.message}</span>
          <button type="button" className="underline" onClick={() => { void optionsQuery.refetch(); if (site) void clientsQuery.refetch() }}>Retry</button>
        </div>}

        <div className="flex items-center gap-2" aria-label="Forecast dates">
          <button type="button" aria-label="Previous seven days" className="shrink-0 rounded-md border border-border p-3 disabled:opacity-40" disabled={!validRange || weekStart <= startDate} onClick={() => {
            const next = shiftForecastDate(weekStart, -7)
            const date = next < startDate ? startDate : next
            setWeekStart(date); setSelectedDate(date); closeRecipeSearch()
          }}><i className="bi bi-chevron-left" aria-hidden="true" /></button>
          <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
            {days.map((date) => {
              const weekend = [0, 6].includes(new Date(`${date}T12:00:00`).getDay())
              const active = selectedDate === date
              const count = drafts[forecastKey(site, client, date)]?.length ?? 0
              return <button key={date} type="button" aria-pressed={active} disabled={!validRange || date > endDate} onClick={() => { setSelectedDate(date); closeRecipeSearch() }}
                className={`min-w-24 flex-1 rounded-md border px-3 py-3 text-center transition disabled:opacity-30 ${active ? 'border-primary bg-primary text-white' : weekend ? 'border-red-300 bg-red-50 text-red-600 hover:border-red-500' : 'border-border bg-background text-foreground hover:border-primary'}`}>
                <span className="block text-sm font-semibold">{dateLabel(date, { day: '2-digit', month: 'short' })}</span>
                <span className="mt-1 block text-xs">{dateLabel(date, { weekday: 'long' })}</span>
                <span className={`mt-2 block text-xs ${active ? 'text-white/80' : 'text-muted'}`}>{count ? `${count} menu${count > 1 ? 's' : ''}` : '—'}</span>
              </button>
            })}
          </div>
          <button type="button" aria-label="Next seven days" className="shrink-0 rounded-md border border-border p-3 disabled:opacity-40" disabled={!validRange || shiftForecastDate(weekStart, 7) > endDate} onClick={() => {
            const next = shiftForecastDate(weekStart, 7)
            setWeekStart(next); setSelectedDate(next); closeRecipeSearch()
          }}><i className="bi bi-chevron-right" aria-hidden="true" /></button>
        </div>

        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">{dateLabel(selectedDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h2>
          </div>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[1040px] text-left text-sm">
              <thead className="bg-primary text-xs uppercase text-surface"><tr>
                {['No', 'Group By', 'Recipe ID', 'Menu', 'Category', 'Portion', 'Est. Cost', 'Est. Cost/Pax', 'Action'].map((heading) => <th key={heading} scope="col" className="whitespace-nowrap px-4 py-3 font-semibold leading-[1.2]">{heading}</th>)}
              </tr></thead>
              <tbody>
                {rows.map((row, index) => {
                  const detailsOpen = expandedDetails?.scope === key && expandedDetails.rowId === row.id
                  return <Fragment key={row.id}><tr className="border-t border-border">
                  <td className="px-3 py-3 text-muted">{index + 1}</td>
                  <td className="w-40 px-3 py-3"><select aria-label={`Group row ${index + 1}`} className={inputClass} value={row.group} onChange={(event) => patchRow(row.id, { group: event.target.value })}>
                    <option value="">Select group</option>
                    {row.group && !optionsQuery.data?.groups.some((item) => item.name === row.group) && <option value={row.group}>{row.group}</option>}
                    {optionsQuery.data?.groups.map((item) => <option key={item.id ?? item._id ?? item.name} value={item.name}>{item.name}</option>)}
                  </select></td>
                  <td className="px-3 py-3 text-xs text-muted">{row.recipeCode || '—'}</td>
                  <td className="px-3 py-3">
                    <input
                      type="text"
                      aria-label={`Select recipe row ${index + 1}`}
                      aria-controls={recipeRowId === row.id ? 'forecast-recipe-options' : undefined}
                      autoComplete="off"
                      value={recipeRowId === row.id ? recipeSearch : row.menu}
                      placeholder="Search menu"
                      style={{ width: `${Math.min(48, Math.max(22, (recipeRowId === row.id ? recipeSearch : row.menu).length + 3))}ch` }}
                      className="max-w-[32rem] rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none transition-[width] duration-150 focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                      onFocus={(event) => {
                        recipeInputRef.current = event.currentTarget
                        setRecipeRowId(row.id)
                        setRecipeSearch(row.menu)
                        setDebouncedSearch('')
                        event.currentTarget.select()
                      }}
                      onChange={(event) => { setRecipeRowId(row.id); setRecipeSearch(event.target.value) }}
                      onBlur={(event) => {
                        if (!recipeDropdownRef.current?.contains(event.relatedTarget)) closeRecipeSearch()
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') closeRecipeSearch()
                        if (event.key === 'ArrowDown') {
                          event.preventDefault()
                          recipeDropdownRef.current?.querySelector('button')?.focus()
                        }
                      }}
                    />
                  </td>
                  <td className="px-3 py-3 text-muted">{row.category || '—'}</td>
                  <td className="w-28 px-3 py-3"><input type="number" min="1" step="1" aria-label={`Portion row ${index + 1}`} className={inputClass} placeholder="0" value={row.portion} onChange={(event) => patchRow(row.id, { portion: event.target.value === '' ? '' : Number(event.target.value) })} /></td>
                  <td className="whitespace-nowrap px-3 py-3 font-semibold">{money(forecastRowCost(row))}</td>
                  <td className="whitespace-nowrap px-3 py-3">{money(row.costPerPax)}</td>
                  <td className="px-3 py-3"><div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={!row.recipeId}
                      aria-expanded={detailsOpen}
                      aria-controls={detailsOpen ? `forecast-details-${row.id}` : undefined}
                      onClick={() => setExpandedDetails(detailsOpen ? null : { scope: key, rowId: row.id })}
                      className="whitespace-nowrap rounded-md border border-primary bg-primary-soft px-3 py-2 text-xs font-semibold text-primary hover:bg-primary-soft/80 disabled:cursor-not-allowed disabled:opacity-60"
                    >{detailsOpen ? 'Hide details' : 'Details'}</button>
                    <button type="button" aria-label={`Remove row ${index + 1}`} className="rounded-md p-2 text-red-600 hover:bg-red-50" onClick={() => { updateRows(rows.filter((item) => item.id !== row.id)); if (recipeRowId === row.id) closeRecipeSearch() }}><i className="bi bi-trash" aria-hidden="true" /></button>
                  </div></td>
                </tr>
                {detailsOpen && row.recipeId && <tr className="border-t border-border bg-background">
                  <td id={`forecast-details-${row.id}`} colSpan={9} className="px-4 py-4">
                    <ForecastRecipeDetails key={row.recipeId} row={row} site={site} />
                  </td>
                </tr>}
                </Fragment>})}
                {!rows.length && <tr><td colSpan={9} className="px-4 py-10 text-center text-muted"><i className="bi bi-calendar2-plus mb-2 block text-2xl" aria-hidden="true" /><p className="font-semibold">{scopeReady ? 'No menus planned for this day' : 'Choose a site and client to start planning'}</p><p className="mt-1 text-xs">{scopeReady ? 'Add a row, select a recipe, and enter the forecast portions.' : 'Forecasts are kept separately for each site, client, and date.'}</p></td></tr>}
              </tbody>
            </table>
          </div>
          {recipeRowId && createPortal(
            <div
              id="forecast-recipe-options"
              ref={recipeDropdownRef}
              className="fixed z-[100] overflow-y-auto border border-border bg-white shadow-xl"
              style={{ visibility: 'hidden' }}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== recipeInputRef.current) closeRecipeSearch()
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') { recipeInputRef.current?.focus(); closeRecipeSearch() }
              }}
            >
              <div className="py-1">
                {recipeSearch.trim().length < 2 ? <p className="px-3 py-2 text-xs text-muted">Type at least 2 characters to search menus.</p>
                  : recipesQuery.isFetching || debouncedSearch !== recipeSearch.trim() ? <p role="status" className="px-3 py-2 text-xs text-muted">Searching recipes…</p>
                  : recipesQuery.isError ? <p role="alert" className="px-3 py-2 text-xs text-red-600">{recipesQuery.error.message}</p>
                  : recipeSuggestions.length ? recipeSuggestions.map((recipe) => (
                    <button
                      key={recipe.id}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectRecipe(recipe)}
                      className="block w-full border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-primary-soft focus:bg-primary-soft focus:outline-none"
                    >
                      <span className="block truncate text-sm font-semibold text-foreground">{formatVersionedRecipeName(recipe)}</span>
                      <span className="mt-1 block text-xs text-muted">{recipe.recipeCode ?? recipe.id} · {recipe.category || '-'} | {site}</span>
                    </button>
                  )) : <p className="px-3 py-2 text-xs text-muted">No approved recipes found. Try another name or recipe ID.</p>}
              </div>
            </div>, document.body,
          )}
          <div className="mt-3 flex justify-center"><button type="button" disabled={!scopeReady || optionsQuery.isError || clientsQuery.isError} onClick={() => updateRows([...rows, createForecastRow()])} className="inline-flex items-center gap-2 rounded-md border border-primary px-5 py-2 text-sm font-semibold text-primary hover:bg-primary-soft disabled:cursor-not-allowed disabled:opacity-40"><i className="bi bi-plus-circle" aria-hidden="true" />Add Row</button></div>
        </div>

        <div className="divide-y divide-white/20 overflow-hidden rounded-md border border-border bg-primary text-xs font-semibold uppercase leading-[1.2] text-surface">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"><span>Total cost/pax (selected date)</span><strong className="font-semibold">{money(dayIncomplete || !dayPax ? null : dayCost / dayPax)}</strong></div>
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"><span>Total estimated cost (selected date)</span><strong className="font-semibold">{money(dayIncomplete || !scopeReady ? null : dayCost)}</strong></div>
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"><span>Total estimated cost (date range)</span><strong className="font-semibold">{money(rangeIncomplete || !scopeReady ? null : rangeCost)}</strong></div>
        </div>
        <p className="text-xs text-muted">Estimates use saved recipe ingredient prices. Daily pax is the sum of the largest portion in each group. A dash indicates incomplete portions or ingredient costs.</p>
        {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {message && <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="max-w-lg text-xs text-muted">Save keeps all forecast drafts in this browser. Drafts are not shared across devices or submitted as production.</p>
          <div className="flex items-center gap-2">
            <button type="button" disabled={!rows.length} onClick={() => { updateRows([]); closeRecipeSearch() }} className="rounded-md border border-red-500 px-5 py-3 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40">Reset day</button>
            <ActionButton action="save" disabled={!dirty} onClick={save} iconClassName="bi bi-floppy" />
          </div>
        </div>
      </section>
    </div>
  )
}

export default SuperadminProductionForecastPage
