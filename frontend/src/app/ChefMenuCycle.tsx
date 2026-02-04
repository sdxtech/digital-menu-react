import { useEffect, useMemo, useState } from 'react'
import { useChefData } from '../lib/chef-data'

const TIMELINE_ITEMS_PER_PAGE = 10

type MenuInputRow = {
  id: string
  recipeId: string
  portion: number | ''
}

const createMenuInputRow = (): MenuInputRow => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  recipeId: '',
  portion: '',
})

const approvalLabel = (approvalStatus: 'pending' | 'approved' | 'rejected') => {
  if (approvalStatus === 'approved') return 'Approved'
  if (approvalStatus === 'rejected') return 'Rejected'
  return 'Pending Approval'
}

const ChefMenuCycle = () => {
  const { recipes, menuProductions, addMenuProduction } = useChefData()
  const [productionDate, setProductionDate] = useState('')
  const [menuRows, setMenuRows] = useState<MenuInputRow[]>([createMenuInputRow()])
  const [inputError, setInputError] = useState('')
  const [inputMessage, setInputMessage] = useState('')
  const [timelineMessage, setTimelineMessage] = useState('')
  const [expandedDates, setExpandedDates] = useState<string[]>([])
  const [timelinePage, setTimelinePage] = useState(1)

  const recipeById = useMemo(() => {
    return recipes.reduce<Record<string, (typeof recipes)[number]>>((acc, recipe) => {
      acc[recipe.id] = recipe
      return acc
    }, {})
  }, [recipes])

  const productionStats = useMemo(() => {
    const approved = menuProductions.filter(
      (item) => item.approvalStatus === 'approved',
    ).length
    const pending = menuProductions.filter(
      (item) => item.approvalStatus === 'pending',
    ).length
    const rejected = menuProductions.filter(
      (item) => item.approvalStatus === 'rejected',
    ).length
    return { approved, pending, rejected, total: menuProductions.length }
  }, [menuProductions])

  const timelineGroups = useMemo(() => {
    const grouped: Record<string, typeof menuProductions> = {}
    menuProductions.forEach((item) => {
      if (!grouped[item.productionDate]) grouped[item.productionDate] = []
      grouped[item.productionDate].push(item)
    })
    return Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b))
  }, [menuProductions])

  const timelineTotalPages = Math.max(
    1,
    Math.ceil(timelineGroups.length / TIMELINE_ITEMS_PER_PAGE),
  )
  const timelineStart = (timelinePage - 1) * TIMELINE_ITEMS_PER_PAGE
  const timelinePagedGroups = timelineGroups.slice(
    timelineStart,
    timelineStart + TIMELINE_ITEMS_PER_PAGE,
  )

  useEffect(() => {
    setTimelinePage((prev) => Math.min(prev, timelineTotalPages))
  }, [timelineTotalPages])

  const toggleExpanded = (date: string) => {
    setExpandedDates((prev) =>
      prev.includes(date) ? prev.filter((item) => item !== date) : [...prev, date],
    )
  }

  const updateRowRecipe = (id: string, recipeId: string) => {
    setMenuRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, recipeId } : row)),
    )
  }

  const updateRowPortion = (id: string, value: string) => {
    const digitsOnly = value.replace(/\D/g, '')
    setMenuRows((prev) =>
      prev.map((row) =>
        row.id === id
          ? {
              ...row,
              portion: digitsOnly === '' ? '' : Number.parseInt(digitsOnly, 10),
            }
          : row,
      ),
    )
  }

  const handleAddMenuRow = () => {
    if (!productionDate) {
      setInputError('Select a production date first.')
      setInputMessage('')
      return
    }

    setMenuRows((prev) => [...prev, createMenuInputRow()])
    setInputError('')
    setInputMessage('New menu row added.')
  }

  const handleRemoveMenuRow = (id: string) => {
    setMenuRows((prev) => {
      const nextRows = prev.filter((row) => row.id !== id)
      return nextRows.length === 0 ? [createMenuInputRow()] : nextRows
    })
    setInputError('')
    setInputMessage('Menu row removed.')
  }

  const handleSubmitToTimeline = async () => {
    if (!productionDate) {
      setInputError('Select a production date first.')
      setInputMessage('')
      return
    }

    const usedRows = menuRows.filter(
      (row) => row.recipeId !== '' || row.portion !== '',
    )

    if (usedRows.length === 0) {
      setInputError('Fill in at least 1 menu row before submitting to the Unit Manager.')
      setInputMessage('')
      return
    }

    const payload: Array<{
      menuName: string
      category: string
      portion: number
      productionDate: string
    }> = []

    for (const row of usedRows) {
      if (!row.recipeId || row.portion === '') {
        setInputError('Make sure each row has a menu and portion.')
        setInputMessage('')
        return
      }

      const portionValue = Number(row.portion)
      if (!Number.isInteger(portionValue) || portionValue <= 0) {
        setInputError('Portion must be a whole number greater than 0.')
        setInputMessage('')
        return
      }

      const recipe = recipeById[row.recipeId]
      if (!recipe) {
        setInputError('There is an invalid menu. Please select again.')
        setInputMessage('')
        return
      }

      payload.push({
        menuName: recipe.name,
        category: recipe.category,
        portion: portionValue,
        productionDate,
      })
    }

    try {
      await Promise.all(payload.map((item) => addMenuProduction(item)))
      setMenuRows([createMenuInputRow()])
      setInputError('')
      setInputMessage('')
      setTimelineMessage(
        `${payload.length} menus added to the production timeline for ${productionDate} and submitted to the Unit Manager (pending approval).`,
      )
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to save menu production.'
      setInputError(message)
      setInputMessage('')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-muted">
          Menu Production
        </p>
        <h2 className="mt-2 text-2xl font-semibold">
          Weekly production plan
        </h2>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-muted">
            Pending approval
          </p>
          <h3 className="mt-2 text-xl font-semibold">{productionStats.pending}</h3>
          <p className="mt-3 text-sm text-muted">
            Menus not reviewed by the Unit Manager yet.
          </p>
        </div>
        <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-muted">
            Approved
          </p>
          <h3 className="mt-2 text-xl font-semibold">{productionStats.approved}</h3>
          <p className="mt-3 text-sm text-muted">
            Menus ready for Store Request.
          </p>
        </div>
        <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-primary">
            Total menus
          </p>
          <h3 className="mt-2 text-xl font-semibold text-primary">
            {productionStats.total}
          </h3>
          <p className="mt-3 text-sm text-muted">
            {productionStats.rejected} menus are rejected.
          </p>
        </div>
      </div>

      <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted">
              Production input
            </p>
            <h3 className="mt-2 text-lg font-semibold">
              Enter menus to be produced
            </h3>
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
              Production date (pick once)
            </label>
            <input
              type="date"
              value={productionDate}
              onChange={(event) => setProductionDate(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
            />
          </div>
        </div>

        <div className="mt-6 overflow-x-auto rounded-2xl border border-border">
          <table className="min-w-full bg-white text-sm">
            <thead className="bg-background">
              <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                <th className="w-20 px-2 py-3 font-semibold" />
                <th className="px-4 py-3 font-semibold">Menu</th>
                <th className="px-4 py-3 font-semibold">Category</th>
                <th className="px-4 py-3 font-semibold">Portion</th>
              </tr>
            </thead>
            <tbody>
              {menuRows.map((row) => {
                const selectedRecipe = recipeById[row.recipeId]
                return (
                  <tr key={row.id} className="border-t border-border">
                    <td className="px-2 py-3">
                      <div className="flex justify-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveMenuRow(row.id)}
                          className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-danger/40 bg-surface text-base font-bold text-danger shadow-sm transition hover:bg-danger hover:text-white hover:shadow-md"
                          aria-label="Remove menu row"
                          title="Remove menu row"
                        >
                          X
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={row.recipeId}
                        onChange={(event) =>
                          updateRowRecipe(row.id, event.target.value)
                        }
                        className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                      >
                        <option value="">Select menu</option>
                        {recipes.map((recipe) => (
                          <option key={recipe.id} value={recipe.id}>
                            {recipe.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted">
                      {selectedRecipe?.category ?? '-'}
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={row.portion === '' ? '' : String(row.portion)}
                        onChange={(event) =>
                          updateRowPortion(row.id, event.target.value)
                        }
                        placeholder="Example: 10"
                        className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                      />
                    </td>
                  </tr>
                )
              })}
              <tr className="border-t border-border">
                <td colSpan={4} className="px-4 py-3">
                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={handleAddMenuRow}
                      className="inline-flex items-center gap-2 rounded-2xl border border-border bg-background px-4 py-2 text-xs font-semibold text-primary"
                    >
                      <span>+</span>
                      <span>Add menu</span>
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            {inputError ? (
              <p className="text-xs font-medium text-red-600">{inputError}</p>
            ) : null}
            {inputMessage ? (
              <p className="text-xs font-medium text-primary">{inputMessage}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={handleSubmitToTimeline}
            className="rounded-2xl bg-primary px-4 py-2 text-xs font-semibold text-white shadow-sm"
          >
            Submit to Unit Manager
          </button>
        </div>
      </div>

      <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted">
            Timeline
          </p>
          <h3 className="mt-2 text-lg font-semibold">
            Scheduled production menus
          </h3>
        </div>
        </div>
        {timelineMessage ? (
          <p className="mt-4 text-xs font-medium text-primary">{timelineMessage}</p>
        ) : null}

        {timelineGroups.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-border bg-background p-6 text-center text-sm text-muted">
            No menus in the production timeline yet.
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {timelinePagedGroups.map(([date, items]) => {
              const isExpanded = expandedDates.includes(date)
              return (
                <div
                  key={date}
                  className="rounded-2xl border border-border bg-background p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <p className="text-xs uppercase tracking-[0.2em] text-muted">
                        {date}
                      </p>
                      <span className="rounded-full bg-primary-soft px-2 py-1 text-xs font-semibold text-primary">
                        {items.length} menus
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleExpanded(date)}
                      className="rounded-full border border-border bg-white px-3 py-1 text-xs font-semibold text-primary"
                    >
                      {isExpanded ? 'Hide details' : 'View details'}
                    </button>
                  </div>

                  {isExpanded ? (
                    <div className="mt-3 overflow-x-auto rounded-xl border border-border">
                      <table className="min-w-full bg-white text-sm">
                        <thead className="bg-background">
                          <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                            <th className="px-4 py-3 font-semibold">Menu</th>
                            <th className="px-4 py-3 font-semibold">Category</th>
                            <th className="px-4 py-3 font-semibold">Portion</th>
                            <th className="px-4 py-3 font-semibold">Approval</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((item) => (
                            <tr key={item.id} className="border-t border-border">
                              <td className="px-4 py-3">{item.menuName}</td>
                              <td className="px-4 py-3">{item.category}</td>
                              <td className="px-4 py-3">{item.portion}</td>
                              <td className="px-4 py-3">
                                <span className="text-xs font-medium">
                                  {approvalLabel(item.approvalStatus)}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}

        {timelineGroups.length > TIMELINE_ITEMS_PER_PAGE ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-white px-5 py-4 text-xs">
            <span className="text-muted">
              Showing {timelinePagedGroups.length} of {timelineGroups.length}{' '}
              production dates
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setTimelinePage((prev) => Math.max(1, prev - 1))}
                disabled={timelinePage === 1}
                className="rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                Prev
              </button>
              <span className="text-xs font-semibold text-foreground">
                Page {timelinePage} / {timelineTotalPages}
              </span>
              <button
                type="button"
                onClick={() =>
                  setTimelinePage((prev) =>
                    Math.min(timelineTotalPages, prev + 1),
                  )
                }
                disabled={timelinePage === timelineTotalPages}
                className="rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default ChefMenuCycle
