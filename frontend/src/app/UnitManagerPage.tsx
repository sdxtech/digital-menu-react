import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useChefData } from '../lib/chef-data'
import { useAuth } from '../lib/auth'
import { formatUnitLabel } from '../lib/unit-of-measures'

type Recipe = {
  id?: string
  _id?: string
  name: string
  category: string
  status: 'draft' | 'active'
  approvalStatus: 'pending' | 'approved' | 'rejected'
}

type StoreRequestIngredient = {
  productCode: string
  name: string
  unitOfMeasures: string
  qty: number
}

type StoreRequestMenu = {
  id: string
  menuName: string
  category: string
  portion: number
  productionDate: string
  approvalStatus: 'pending' | 'approved' | 'rejected'
  storeRequestStatus: 'not-requested' | 'requested' | 'fulfilled'
  portionSize: number
  ingredients: StoreRequestIngredient[]
  missingRecipe: boolean
}

type StoreRequestGroup = {
  date: string
  items: StoreRequestMenu[]
  summary: StoreRequestIngredient[]
  missingRecipes: string[]
}

const UnitManagerPage = () => {
  const { accessToken } = useAuth()
  const {
    approveRecipe,
    rejectRecipe,
    approveMenuProduction,
    rejectMenuProduction,
  } = useChefData()
  const [actionError, setActionError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [pendingRecipes, setPendingRecipes] = useState<Recipe[]>([])
  const [menuProductionGroups, setMenuProductionGroups] = useState<
    StoreRequestGroup[]
  >([])
  const [expandedDates, setExpandedDates] = useState<string[]>([])

  // FRONTEND VIEW: pending approvals are fetched from backend.
  const fetchPending = useCallback(async () => {
    if (!accessToken) return
    try {
      const [recipesData, menusData] = await Promise.all([
        apiFetch<{ items: Recipe[] }>(
          '/recipes?approvalStatus=pending&limit=50',
          undefined,
          accessToken,
        ),
        apiFetch<{ items: StoreRequestGroup[] }>(
          '/menu-productions/store-requests?approvalStatus=pending',
          undefined,
          accessToken,
        ),
      ])
      setPendingRecipes(recipesData.items ?? [])
      const sortedGroups = [...(menusData.items ?? [])].sort((a, b) =>
        a.date.localeCompare(b.date),
      )
      setMenuProductionGroups(sortedGroups)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to load approvals.'
      setActionError(message)
    }
  }, [accessToken])

  useEffect(() => {
    setActionError('')
    setActionMessage('')
    fetchPending().catch(() => null)
  }, [fetchPending])

  const toggleExpandedDate = (date: string) => {
    setExpandedDates((prev) =>
      prev.includes(date) ? prev.filter((item) => item !== date) : [...prev, date],
    )
  }

  const handleBulkApproval = async (
    date: string,
    items: StoreRequestMenu[],
    action: 'approve' | 'reject',
  ) => {
    if (items.length === 0) return
    setActionError('')
    setActionMessage('')

    const requests = items.map((item) => {
      const id = item.id ?? ''
      if (!id) {
        return Promise.reject(new Error('Menu production id is missing.'))
      }
      return action === 'approve'
        ? approveMenuProduction(id)
        : rejectMenuProduction(id)
    })

    const results = await Promise.allSettled(requests)
    const successCount = results.filter((result) => result.status === 'fulfilled')
      .length
    const failedCount = results.length - successCount

    if (successCount > 0) {
      setActionMessage(
        `${successCount} menu ${action === 'approve' ? 'approved' : 'rejected'} for ${date}.`,
      )
    }
    if (failedCount > 0) {
      setActionError(
        `${failedCount} menu failed to ${action} for ${date}.`,
      )
    }

    fetchPending().catch(() => null)
  }

  const formatQuantity = (value: number) => {
    if (!Number.isFinite(value)) return '0'
    if (Number.isInteger(value)) return String(value)
    return value.toFixed(3).replace(/\.?0+$/, '')
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div>
          <h1 className="text-2xl font-semibold">Approval Center</h1>
          <p className="mt-2 text-sm text-muted">
            Review recipes and production menus from the Chef team.
          </p>
          {actionError ? (
            <p className="mt-2 text-xs font-medium text-red-600">
              {actionError}
            </p>
          ) : null}
          {actionMessage ? (
            <p className="mt-2 text-xs font-medium text-primary">
              {actionMessage}
            </p>
          ) : null}
        </div>

        <div className="rounded-md border border-border bg-surface p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Approval Recipe</h2>
          <div className="mt-4 overflow-x-auto rounded-md border border-border">
            <table className="min-w-full bg-white text-sm">
              <thead className="bg-background">
                <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                  <th className="w-12 px-4 py-3 font-semibold">No</th>
                  <th className="px-4 py-3 font-semibold">Name</th>
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="px-4 py-3 font-semibold">Recipe status</th>
                  <th className="px-4 py-3 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {pendingRecipes.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-6 text-center text-muted"
                    >
                      No recipes pending approval.
                    </td>
                  </tr>
                ) : (
                  pendingRecipes.map((item, index) => (
                    <tr
                      key={item.id ?? item._id}
                      className="border-t border-border"
                    >
                      <td className="px-4 py-3 text-sm text-muted">
                        {index + 1}
                      </td>
                      <td className="px-4 py-3">{item.name}</td>
                      <td className="px-4 py-3">{item.category}</td>
                      <td className="px-4 py-3">
                        {item.status === 'active' ? 'Active' : 'Draft'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={async () => {
                              setActionError('')
                              try {
                                await approveRecipe(item.id ?? item._id ?? '')
                                fetchPending().catch(() => null)
                              } catch (error) {
                                setActionError(
                                  error instanceof Error
                                    ? error.message
                                    : 'Failed to approve recipe.',
                                )
                              }
                            }}
                            className="rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-white"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              setActionError('')
                              try {
                                await rejectRecipe(item.id ?? item._id ?? '')
                                fetchPending().catch(() => null)
                              } catch (error) {
                                setActionError(
                                  error instanceof Error
                                    ? error.message
                                    : 'Failed to reject recipe.',
                                )
                              }
                            }}
                            className="rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold text-primary"
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="rounded-md border border-border bg-surface p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Approval Menu Production</h2>
        <div className="mt-4 space-y-4">
          {menuProductionGroups.length === 0 ? (
            <div className="rounded-md border border-border bg-background px-4 py-6 text-center text-sm text-muted">
              No production menus pending approval.
            </div>
          ) : (
            menuProductionGroups.map((group) => (
              <div
                key={group.date}
                className="rounded-md border border-border bg-background p-4"
              >
                {(() => {
                  const isExpanded = expandedDates.includes(group.date)
                  return (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-[0.2em] text-muted">
                            Production date
                          </p>
                          <h3 className="mt-2 text-lg font-semibold">
                            {group.date}
                          </h3>
                          <p className="mt-1 text-xs text-muted">
                            {group.items.length} menus pending
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => toggleExpandedDate(group.date)}
                            className="rounded-xl border border-border bg-white px-3 py-2 text-xs font-semibold text-primary"
                          >
                            {isExpanded ? 'Hide details' : 'View details'}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleBulkApproval(group.date, group.items, 'approve')
                            }
                            className="rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-white"
                          >
                            Approve all
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleBulkApproval(group.date, group.items, 'reject')
                            }
                            className="rounded-xl border border-border bg-white px-3 py-2 text-xs font-semibold text-primary"
                          >
                            Reject all
                          </button>
                        </div>
                      </div>

                      {isExpanded ? (
                        <div className="mt-4 grid gap-4 lg:grid-cols-12">
                          <div className="rounded-md border border-border bg-background p-4 lg:col-span-5">
                            <p className="text-xs uppercase tracking-[0.2em] text-muted">
                              Menu list
                            </p>
                            <div className="mt-3 overflow-x-auto rounded-md border border-border bg-white">
                              <table className="min-w-full text-sm">
                                <thead className="bg-background">
                                  <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                                    <th className="w-12 px-4 py-3 font-semibold">
                                      No
                                    </th>
                                    <th className="px-4 py-3 font-semibold">
                                      Menu
                                    </th>
                                    <th className="px-4 py-3 font-semibold">
                                      Category
                                    </th>
                                    <th className="px-4 py-3 font-semibold">
                                      Portion
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {group.items.map((item, index) => (
                                    <tr key={item.id} className="border-t border-border">
                                      <td className="px-4 py-3 text-sm text-muted">
                                        {index + 1}
                                      </td>
                                      <td className="px-4 py-3">
                                        {item.menuName}
                                      </td>
                                      <td className="px-4 py-3">{item.category}</td>
                                      <td className="px-4 py-3">{item.portion}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            {group.missingRecipes.length > 0 ? (
                              <p className="mt-3 text-xs text-danger">
                                Recipe not found for:{' '}
                                {group.missingRecipes.join(', ')}
                              </p>
                            ) : null}
                          </div>

                          <div className="rounded-md border border-border bg-background p-4 lg:col-span-7">
                            <p className="text-xs uppercase tracking-[0.2em] text-muted">
                              Ingredient summary
                            </p>
                            <div className="mt-3 overflow-x-auto rounded-md border border-border bg-white">
                              <table className="min-w-full text-sm">
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
                                    <th className="px-4 py-3 font-semibold">Qty</th>
                                    <th className="px-4 py-3 font-semibold">Unit</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {group.summary.length === 0 ? (
                                    <tr className="border-t border-border">
                                      <td
                                        colSpan={5}
                                        className="px-4 py-6 text-center text-muted"
                                      >
                                        No ingredients available to calculate.
                                      </td>
                                    </tr>
                                  ) : (
                                    group.summary.map((item, index) => (
                                      <tr
                                        key={`${item.productCode}-${item.unitOfMeasures}`}
                                        className="border-t border-border"
                                      >
                                        <td className="px-4 py-3 text-sm text-muted">
                                          {index + 1}
                                        </td>
                                        <td className="px-4 py-3">
                                          {item.productCode}
                                        </td>
                                        <td className="px-4 py-3">{item.name}</td>
                                        <td className="px-4 py-3">
                                          {formatQuantity(item.qty)}
                                        </td>
                                        <td className="px-4 py-3">
                                          {formatUnitLabel(item.unitOfMeasures)}
                                        </td>
                                      </tr>
                                    ))
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </>
                  )
                })()}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export default UnitManagerPage
