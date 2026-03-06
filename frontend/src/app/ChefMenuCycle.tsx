import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import TablePagination from '../components/TablePagination'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useChefData } from '../lib/chef-data'
import { getApprovalStatusLabel } from '../lib/status-labels'
import { formatUnitLabel } from '../lib/unit-of-measures'

const TIMELINE_ITEMS_PER_PAGE = 10
const INPUT_ROWS_PER_PAGE = 8

type MenuInputRow = {
  id: string
  recipeId: string
  portion: number | ''
}

type TimelineItem = {
  id: string
  menuName: string
  category: string
  portion: number
  approvalStatus: 'pending' | 'approved' | 'rejected'
}

type TimelineGroup = {
  date: string
  items: TimelineItem[]
}

type TimelineStats = {
  approved: number
  pending: number
  rejected: number
  total: number
}

const createMenuInputRow = (): MenuInputRow => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  recipeId: '',
  portion: '',
})

const ChefMenuCycle = () => {
  const { accessToken } = useAuth()
  const { recipes, addMenuProduction } = useChefData()
  const [productionDate, setProductionDate] = useState('')
  const [menuRows, setMenuRows] = useState<MenuInputRow[]>([createMenuInputRow()])
  const [inputError, setInputError] = useState('')
  const [inputMessage, setInputMessage] = useState('')
  const [timelineMessage, setTimelineMessage] = useState('')
  const [expandedDates, setExpandedDates] = useState<string[]>([])
  const [timelinePage, setTimelinePage] = useState(1)
  const [timelineGroups, setTimelineGroups] = useState<TimelineGroup[]>([])
  const [timelineTotalGroups, setTimelineTotalGroups] = useState(0)
  const [timelineStats, setTimelineStats] = useState<TimelineStats>({
    approved: 0,
    pending: 0,
    rejected: 0,
    total: 0,
  })
  const [timelineTotalPages, setTimelineTotalPages] = useState(1)
  const [timelineLoading, setTimelineLoading] = useState(false)
  const [expandedMenuRows, setExpandedMenuRows] = useState<string[]>([])
  const [inputPage, setInputPage] = useState(1)

  const availableRecipes = useMemo(
    () =>
      recipes.filter(
        (recipe) =>
          recipe.approvalStatus === 'approved' && recipe.status === 'active',
      ),
    [recipes],
  )

  const recipeById = useMemo(() => {
    return availableRecipes.reduce<Record<string, (typeof availableRecipes)[number]>>(
      (acc, recipe) => {
        acc[recipe.id] = recipe
        return acc
      },
      {},
    )
  }, [availableRecipes])

  // FRONTEND VIEW: timeline groups + stats come from backend.
  const fetchTimeline = useCallback(async () => {
    if (!accessToken) return
    setTimelineLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('page', String(timelinePage))
      params.set('limit', String(TIMELINE_ITEMS_PER_PAGE))

      const data = await apiFetch<{
        stats: TimelineStats
        items: TimelineGroup[]
        page: number
        limit: number
        totalGroups: number
        totalPages: number
      }>(`/menu-productions/timeline?${params.toString()}`, undefined, accessToken)

      setTimelineGroups(data.items ?? [])
      setTimelineStats(data.stats ?? {
        approved: 0,
        pending: 0,
        rejected: 0,
        total: 0,
      })
      setTimelineTotalPages(data.totalPages ?? 1)
      setTimelineTotalGroups(data.totalGroups ?? data.items?.length ?? 0)
    } catch {
      setTimelineGroups([])
      setTimelineStats({ approved: 0, pending: 0, rejected: 0, total: 0 })
      setTimelineTotalPages(1)
      setTimelineTotalGroups(0)
    } finally {
      setTimelineLoading(false)
    }
  }, [accessToken, timelinePage])

  useEffect(() => {
    fetchTimeline().catch(() => null)
  }, [fetchTimeline])

  useEffect(() => {
    setTimelinePage((prev) => Math.min(prev, timelineTotalPages))
  }, [timelineTotalPages])

  useEffect(() => {
    const nextTotalPages = Math.max(1, Math.ceil(menuRows.length / INPUT_ROWS_PER_PAGE))
    setInputPage((prev) => Math.min(prev, nextTotalPages))
  }, [menuRows.length])

  const toggleExpanded = (date: string) => {
    setExpandedDates((prev) =>
      prev.includes(date) ? prev.filter((item) => item !== date) : [...prev, date],
    )
  }

  const toggleMenuRowDetails = (id: string) => {
    setExpandedMenuRows((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    )
  }

  const formatQuantity = (value: number) => {
    if (!Number.isFinite(value)) return '0'
    if (Number.isInteger(value)) return String(value)
    return value.toFixed(3).replace(/\.?0+$/, '')
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

    setMenuRows((prev) => {
      const nextRows = [...prev, createMenuInputRow()]
      const nextTotalPages = Math.max(1, Math.ceil(nextRows.length / INPUT_ROWS_PER_PAGE))
      setInputPage(nextTotalPages)
      return nextRows
    })
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
        setInputError(
          'There is an invalid menu. Only approved recipes can be submitted.',
        )
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
      fetchTimeline().catch(() => null)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to save menu production.'
      setInputError(message)
      setInputMessage('')
    }
  }

  const inputTotalPages = Math.max(1, Math.ceil(menuRows.length / INPUT_ROWS_PER_PAGE))
  const paginatedMenuRows = menuRows.slice(
    (inputPage - 1) * INPUT_ROWS_PER_PAGE,
    inputPage * INPUT_ROWS_PER_PAGE,
  )

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div>
          <h1 className="text-2xl font-semibold">Menu Production</h1>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-md border border-border bg-surface p-6 shadow-sm">
            <h3 className="uppercase tracking-[0.2em] text-muted">
              Submitted
            </h3>
            <p className="mt-2 text-xl font-semibold">
              {timelineStats.pending}
            </p>
            <p className="mt-3 text-sm text-muted">
              Menus awaiting Unit Manager approval.
            </p>
          </div>
          <div className="rounded-md border border-border bg-surface p-6 shadow-sm">
            <h3 className="uppercase tracking-[0.2em] text-muted">
              Approved
            </h3>
            <p className="mt-2 text-xl font-semibold">
              {timelineStats.approved}
            </p>
            <p className="mt-3 text-sm text-muted">
              Menus ready for Store Request.
            </p>
          </div>
          <div className="rounded-md border border-border bg-surface p-6 shadow-sm">
            <h3 className="uppercase tracking-[0.2em] text-primary">
              Total menus
            </h3>
            <p className="mt-2 text-xl font-semibold text-primary">
              {timelineStats.total}
            </p>
            <p className="mt-3 text-sm text-muted">
              {timelineStats.rejected} menus are rejected.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-md border border-border bg-surface p-6 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h3 className="font-semibold text-foreground">
              Production input
            </h3>
            <p className="mt-1 text-xs text-muted">
              Enter menus to be produced
            </p>
            <p className="mt-3 text-xs text-muted">
              Only recipes approved by the Unit Manager can be selected.
            </p>
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
              Production date (pick once)
            </label>
            <input
              type="date"
              value={productionDate}
              onChange={(event) => setProductionDate(event.target.value)}
              className="mt-2 w-full max-w-[220px] rounded-xl border border-border bg-white px-3 py-2 text-xs shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
            />
          </div>
        </div>

        <div className="mt-6 overflow-x-auto rounded-md border border-border">
          <TablePagination
            page={inputPage}
            totalPages={inputTotalPages}
            onPageChange={setInputPage}
            summary={`Showing ${paginatedMenuRows.length} of ${menuRows.length} menu rows`}
            className="rounded-t-md border-b border-border bg-white px-4 py-3"
          />
          <table className="dm-table min-w-full bg-white text-sm">
            <thead className="bg-background">
              <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                <th className="w-20 px-2 py-3 font-semibold" />
                <th className="w-14 px-2 py-3 font-semibold text-center">No</th>
                <th className="px-4 py-3 font-semibold">Menu</th>
                <th className="px-4 py-3 font-semibold">Category</th>
                <th className="px-4 py-3 font-semibold">Portion</th>
                <th className="px-4 py-3 font-semibold">Recipe details</th>
              </tr>
            </thead>
            <tbody>
              {paginatedMenuRows.map((row, index) => {
                const selectedRecipe = recipeById[row.recipeId]
                const isDetailsOpen = expandedMenuRows.includes(row.id)
                const ingredients = selectedRecipe?.ingredients ?? []
                const basePax =
                  selectedRecipe && selectedRecipe.portionSize > 0
                    ? selectedRecipe.portionSize
                    : 1
                const portionForPreview =
                  typeof row.portion === 'number' && row.portion > 0
                    ? row.portion
                    : null
                return (
                  <Fragment key={row.id}>
                    <tr className="border-t border-border">
                      <td className="px-2 py-3">
                        <div className="flex justify-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveMenuRow(row.id)}
                            className="dm-x-button text-sm font-semibold leading-none"
                            aria-label="Remove menu row"
                            title="Remove menu row"
                          >
                            X
                          </button>
                        </div>
                      </td>
                      <td className="px-2 py-3 text-center text-sm text-muted">
                        {(inputPage - 1) * INPUT_ROWS_PER_PAGE + index + 1}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={row.recipeId}
                          onChange={(event) =>
                            updateRowRecipe(row.id, event.target.value)
                          }
                          className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                        >
                          <option value="">
                            {availableRecipes.length === 0
                              ? 'No approved menu available'
                              : 'Select menu'}
                          </option>
                          {availableRecipes.map((recipe) => (
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
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          disabled={!selectedRecipe}
                          onClick={() => {
                            if (!selectedRecipe) return
                            toggleMenuRowDetails(row.id)
                          }}
                          className="rounded-md border border-primary bg-primary-soft px-3 py-2 text-xs font-semibold text-primary hover:bg-primary-soft/80 disabled:cursor-not-allowed disabled:opacity-60"
                          aria-expanded={isDetailsOpen}
                        >
                          {isDetailsOpen ? 'Hide details' : 'View details'}
                        </button>
                      </td>
                    </tr>
                    {isDetailsOpen ? (
                      <tr className="border-t border-border bg-background">
                        <td colSpan={6} className="px-4 py-4">
                          {!selectedRecipe ? (
                            <div className="rounded-md border border-border bg-surface p-4 text-sm text-muted">
                              Select a menu to view recipe details.
                            </div>
                          ) : (
                            <div className="rounded-md border border-border bg-surface p-4">
                                <h3 className="font-semibold text-foreground">
                                  Ingredients
                                </h3>
                                <p className="mt-1 text-xs text-muted">
                                  Recipe ingredients
                                </p>
                                <p className="mt-1 text-xs text-muted">
                                  {portionForPreview === null
                                    ? `Qty listed per base pax (${basePax}). Enter portion to preview calculated qty.`
                                    : `Qty calculated from base pax (${basePax}) for ${portionForPreview} portions.`}
                                </p>
                                {ingredients.length === 0 ? (
                                  <div className="mt-3 rounded-md border border-border bg-background p-4 text-sm text-muted">
                                    No ingredients for this recipe yet.
                                  </div>
                                ) : (
                                  <div className="mt-3 overflow-x-auto rounded-md border border-border bg-white">
                                    <table className="dm-table min-w-full text-sm">
                                      <thead className="bg-background">
                                        <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                                          <th className="w-12 px-4 py-3 font-semibold">
                                            No
                                          </th>
                                          <th className="px-4 py-3 font-semibold">
                                            Product code
                                          </th>
                                          <th className="px-4 py-3 font-semibold">
                                            Ingredient name
                                          </th>
                                          <th className="px-4 py-3 font-semibold">
                                            Qty
                                          </th>
                                          <th className="px-4 py-3 font-semibold">
                                            Unit
                                          </th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {ingredients.map((ingredient, idx) => {
                                          const scaledQty =
                                            portionForPreview === null
                                              ? ingredient.qty
                                              : (ingredient.qty * portionForPreview) /
                                                basePax
                                          return (
                                            <tr
                                              key={`${ingredient.productCode}-${idx}`}
                                              className="border-t border-border"
                                            >
                                              <td className="px-4 py-3 text-sm text-muted">
                                                {idx + 1}
                                              </td>
                                              <td className="px-4 py-3">
                                                {ingredient.productCode}
                                              </td>
                                              <td className="px-4 py-3">
                                                {ingredient.name}
                                              </td>
                                              <td className="px-4 py-3">
                                                {formatQuantity(scaledQty)}
                                              </td>
                                              <td className="px-4 py-3">
                                                {formatUnitLabel(
                                                  ingredient.unitOfMeasures,
                                                )}
                                              </td>
                                            </tr>
                                          )
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              })}
              <tr className="border-t border-border">
                <td colSpan={6} className="px-4 py-3">
                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={handleAddMenuRow}
                      className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-xs font-semibold text-primary"
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
            className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white shadow-sm"
          >
            Submit to Unit Manager
          </button>
        </div>
      </div>

      <div className="rounded-md border border-border bg-surface p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-foreground">
              Timeline
            </h3>
            <p className="mt-1 text-xs text-muted">
              Scheduled production menus
            </p>
          </div>
        </div>
        {timelineMessage ? (
          <p className="mt-4 text-xs font-medium text-primary">{timelineMessage}</p>
        ) : null}

        <div className="mt-4 rounded-md border border-border bg-white">
          <TablePagination
            page={timelinePage}
            totalPages={timelineTotalPages}
            onPageChange={setTimelinePage}
            loading={timelineLoading}
            summary={`Showing ${timelineGroups.length} of ${timelineTotalGroups} production dates`}
            className="rounded-t-md border-b border-border px-5 py-4"
          />
          <div className="overflow-x-auto">
            <table className="dm-table min-w-full bg-white text-sm">
              <thead className="bg-background">
              <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                <th className="w-16 px-4 py-3 font-semibold">No</th>
                <th className="px-4 py-3 font-semibold">Production date</th>
                <th className="px-4 py-3 font-semibold">Approval status</th>
              </tr>
              </thead>
              <tbody>
              {timelineLoading ? (
                <tr className="border-t border-border">
                  <td colSpan={3} className="px-4 py-8 text-center text-muted">
                    Loading production timeline...
                  </td>
                </tr>
              ) : timelineGroups.length === 0 ? (
                <tr className="border-t border-border">
                  <td colSpan={3} className="px-4 py-8 text-center text-muted">
                    No menus in the production timeline yet.
                  </td>
                </tr>
              ) : (
                timelineGroups.map((group, index) => {
                  const isExpanded = expandedDates.includes(group.date)
                  const approvedCount = group.items.filter(
                    (item) => item.approvalStatus === 'approved',
                  ).length
                  const pendingCount = group.items.filter(
                    (item) => item.approvalStatus === 'pending',
                  ).length
                  const rejectedCount = group.items.filter(
                    (item) => item.approvalStatus === 'rejected',
                  ).length

                  return (
                    <Fragment key={group.date}>
                      <tr
                        className="cursor-pointer border-t border-border"
                        onClick={() => toggleExpanded(group.date)}
                      >
                        <td className="px-4 py-3 text-sm text-muted">
                          {(timelinePage - 1) * TIMELINE_ITEMS_PER_PAGE + index + 1}
                        </td>
                        <td className="px-4 py-3">{group.date}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex flex-wrap items-center gap-2 text-sm">
                              <span className="rounded-full bg-primary-soft px-2 py-1 text-xs font-semibold text-primary">
                                {group.items.length} menus
                              </span>
                              <span className="text-muted">
                                Approved: {approvedCount} | Submitted: {pendingCount} |
                                Rejected: {rejectedCount}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                toggleExpanded(group.date)
                              }}
                              className="rounded-md border border-primary bg-primary-soft px-3 py-1 text-xs font-semibold text-primary hover:bg-primary-soft/80"
                            >
                              {isExpanded ? 'Hide details' : 'View details'}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded ? (
                        <tr className="border-t border-border bg-background">
                          <td colSpan={3} className="px-4 py-4">
                            <div className="overflow-x-auto rounded-md border border-border">
                              <table className="dm-table min-w-full bg-white text-sm">
                                <thead className="bg-background">
                                  <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                                    <th className="w-12 px-4 py-3 font-semibold">
                                      No
                                    </th>
                                    <th className="px-4 py-3 font-semibold">Menu</th>
                                    <th className="px-4 py-3 font-semibold">
                                      Category
                                    </th>
                                    <th className="px-4 py-3 font-semibold">
                                      Portion
                                    </th>
                                    <th className="px-4 py-3 font-semibold">
                                      Approval
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {group.items.map((item, itemIndex) => (
                                    <tr
                                      key={item.id}
                                      className="border-t border-border"
                                    >
                                      <td className="px-4 py-3 text-sm text-muted">
                                        {itemIndex + 1}
                                      </td>
                                      <td className="px-4 py-3">
                                        {item.menuName}
                                      </td>
                                      <td className="px-4 py-3">
                                        {item.category}
                                      </td>
                                      <td className="px-4 py-3">
                                        {item.portion}
                                      </td>
                                      <td className="px-4 py-3">
                                        <span className="text-xs font-medium">
                                          {getApprovalStatusLabel(item.approvalStatus)}
                                        </span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })
              )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  )
}

export default ChefMenuCycle

