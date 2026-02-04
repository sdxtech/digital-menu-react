import { Fragment, useMemo, useState } from 'react'
import { useChefData } from '../lib/chef-data'
import { formatUnitLabel } from '../lib/unit-of-measures'

const ChefStoreRequest = () => {
  const { menuProductions, fetchMenuProductions, recipes } = useChefData()
  const [infoMessage, setInfoMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [expandedDates, setExpandedDates] = useState<string[]>([])

  const approvedMenus = useMemo(
    () => menuProductions.filter((item) => item.approvalStatus === 'approved'),
    [menuProductions],
  )

  const recipeByName = useMemo(() => {
    const map = new Map<string, (typeof recipes)[number]>()
    recipes.forEach((recipe) => {
      const key = recipe.name.trim().toLowerCase()
      if (!map.has(key)) map.set(key, recipe)
    })
    return map
  }, [recipes])

  const groupedByDate = useMemo(() => {
    const map = new Map<string, typeof approvedMenus>()
    approvedMenus.forEach((item) => {
      const date = item.productionDate
      const bucket = map.get(date)
      if (bucket) {
        bucket.push(item)
      } else {
        map.set(date, [item])
      }
    })
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [approvedMenus])

  const formatQuantity = (value: number) => {
    if (!Number.isFinite(value)) return '0'
    if (Number.isInteger(value)) return String(value)
    return value.toFixed(3).replace(/\.?0+$/, '')
  }

  const toggleExpanded = (date: string) => {
    setExpandedDates((prev) =>
      prev.includes(date) ? prev.filter((item) => item !== date) : [...prev, date],
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-muted">
          Store Request
        </p>
        <h2 className="mt-2 text-2xl font-semibold">
          Production menus approved by Unit Manager
        </h2>
      </div>

      <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted">
              Data source
            </p>
            <h3 className="mt-2 text-lg font-semibold">
              Menus automatically added to store request
            </h3>
            <p className="mt-2 text-sm text-muted">
              Menus on this page come from Menu Production approved by the Unit
              Manager.
            </p>
          </div>
          <button
            type="button"
            onClick={async () => {
              setInfoMessage('')
              setErrorMessage('')
              try {
                await fetchMenuProductions()
                setInfoMessage('Approved data refreshed from Menu Production.')
              } catch (error) {
                const message =
                  error instanceof Error
                    ? error.message
                    : 'Failed to refresh data.'
                setErrorMessage(message)
              }
            }}
            className="rounded-2xl border border-border bg-background px-4 py-2 text-xs font-semibold text-primary"
          >
            Refresh approvals
          </button>
        </div>
        {infoMessage ? (
          <p className="mt-3 text-xs font-medium text-primary">{infoMessage}</p>
        ) : null}
        {errorMessage ? (
          <p className="mt-3 text-xs font-medium text-red-600">
            {errorMessage}
          </p>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-3xl border border-border bg-surface shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-background">
            <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
              <th className="px-5 py-4 font-semibold">Production date</th>
              <th className="px-5 py-4 font-semibold">Approval status</th>
            </tr>
          </thead>
          <tbody>
            {groupedByDate.length === 0 ? (
              <tr className="border-t border-border">
                <td colSpan={2} className="px-5 py-10 text-center text-muted">
                  No production menus approved by the Unit Manager yet.
                </td>
              </tr>
            ) : (
              groupedByDate.map(([date, items]) => {
                const isExpanded = expandedDates.includes(date)

                return (
                  <Fragment key={date}>
                    <tr
                      className="border-t border-border cursor-pointer"
                      onClick={() => toggleExpanded(date)}
                    >
                      <td className="px-5 py-4">{date}</td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-2 text-sm">
                            <span>Approved</span>
                            <span className="rounded-full bg-primary-soft px-2 py-1 text-xs font-semibold text-primary">
                              {items.length} menus
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              toggleExpanded(date)
                            }}
                            className="rounded-full border border-border bg-white px-3 py-1 text-xs font-semibold text-primary"
                          >
                            {isExpanded ? 'Hide details' : 'View details'}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded ? (
                      <tr className="border-t border-border bg-background">
                        <td colSpan={2} className="px-5 py-5">
                          <div className="space-y-6">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-xs uppercase tracking-[0.2em] text-muted">
                                  Menu details
                                </p>
                                <p className="mt-2 text-sm text-muted">
                                  Production date: {date}
                                </p>
                              </div>
                              <div className="rounded-2xl border border-border bg-background px-4 py-2 text-xs font-semibold text-primary">
                                Auto-requested after approval
                              </div>
                            </div>

                        {items.map((menu) => {
                              const recipe = recipeByName.get(
                                menu.menuName.trim().toLowerCase(),
                              )
                              const ingredients = recipe?.ingredients ?? []

                              return (
                                <div
                                  key={menu.id}
                                  className="grid gap-4 lg:grid-cols-12"
                                >
                                  <div className="rounded-2xl border border-border bg-surface p-4 lg:col-span-5">
                                    <div className="flex items-center justify-between gap-3">
                                      <div>
                                        <p className="text-xs uppercase tracking-[0.2em] text-muted">
                                          Menu
                                        </p>
                                        <h4 className="mt-2 text-lg font-semibold">
                                          {menu.menuName}
                                        </h4>
                                        <p className="mt-1 text-xs text-muted">
                                          {menu.category}
                                        </p>
                                      </div>
                                      <span className="rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold text-primary">
                                        {menu.portion} portions
                                      </span>
                                    </div>

                                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                                      <div>
                                        <p className="text-xs uppercase tracking-[0.2em] text-muted">
                                          Store request
                                        </p>
                                <p className="mt-1 text-sm font-medium">
                                  {menu.storeRequestStatus === 'fulfilled'
                                    ? 'Delivered to kitchen'
                                    : menu.storeRequestStatus === 'requested'
                                      ? 'Auto-requested'
                                      : 'Waiting for auto request'}
                                </p>
                              </div>
                            </div>
                          </div>

                                  <div className="rounded-2xl border border-border bg-surface p-4 lg:col-span-7">
                                    <p className="text-xs uppercase tracking-[0.2em] text-muted">
                                      Ingredients
                                    </p>
                                    <h4 className="mt-2 text-base font-semibold">
                                      Ingredient requirements
                                    </h4>
                                    <p className="mt-1 text-xs text-muted">
                                      Qty calculated from base servings (
                                      {recipe?.portionSize ?? 1}) for{' '}
                                      {menu.portion} portions
                                    </p>

                                    {!recipe ? (
                                      <div className="mt-3 rounded-2xl border border-border bg-background p-4 text-sm text-muted">
                                        Recipe not found in the recipe list. Make
                                        sure the menu name matches the created
                                        recipe.
                                      </div>
                                    ) : ingredients.length === 0 ? (
                                      <div className="mt-3 rounded-2xl border border-border bg-background p-4 text-sm text-muted">
                                        No ingredients for this recipe yet.
                                      </div>
                                    ) : (
                                      <div className="mt-3 overflow-x-auto rounded-2xl border border-border bg-white">
                                        <table className="min-w-full text-sm">
                                          <thead className="bg-background">
                                            <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
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
                                            {ingredients.map((ingredient, idx) => (
                                              <tr
                                                key={`${ingredient.productCode}-${idx}`}
                                                className="border-t border-border"
                                              >
                                                <td className="px-4 py-3">
                                                  {ingredient.productCode}
                                                </td>
                                                <td className="px-4 py-3">
                                                  {ingredient.name}
                                                </td>
                                              <td className="px-4 py-3">
                                                  {formatQuantity(
                                                    Number(ingredient.qty) *
                                                      (Number(menu.portion) /
                                                        Number(
                                                          recipe?.portionSize ?? 1,
                                                        )),
                                                  )}
                                              </td>
                                                <td className="px-4 py-3">
                                                  {formatUnitLabel(
                                                    ingredient.unitOfMeasures,
                                                  )}
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
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
  )
}

export default ChefStoreRequest
