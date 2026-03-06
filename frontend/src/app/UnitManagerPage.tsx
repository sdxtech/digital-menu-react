import { Fragment, useCallback, useEffect, useState } from 'react'
import TablePagination from '../components/TablePagination'
import { apiFetch } from '../lib/api'
import { useChefData } from '../lib/chef-data'
import { useAuth } from '../lib/auth'
import { getApprovalStatusLabel } from '../lib/status-labels'
import { formatUnitLabel } from '../lib/unit-of-measures'

const RECIPE_ITEMS_PER_PAGE = 10
const MENU_GROUP_ITEMS_PER_PAGE = 10

type Recipe = {
  id?: string
  _id?: string
  recipeCode?: string
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
  productionCode?: string
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
  const [recipePage, setRecipePage] = useState(1)
  const [menuGroupPage, setMenuGroupPage] = useState(1)

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

  useEffect(() => {
    const nextTotalPages = Math.max(
      1,
      Math.ceil(pendingRecipes.length / RECIPE_ITEMS_PER_PAGE),
    )
    setRecipePage((prev) => Math.min(prev, nextTotalPages))
  }, [pendingRecipes.length])

  useEffect(() => {
    const nextTotalPages = Math.max(
      1,
      Math.ceil(menuProductionGroups.length / MENU_GROUP_ITEMS_PER_PAGE),
    )
    setMenuGroupPage((prev) => Math.min(prev, nextTotalPages))
  }, [menuProductionGroups.length])

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
      setActionError(`${failedCount} menu failed to ${action} for ${date}.`)
    }

    fetchPending().catch(() => null)
  }

  const formatQuantity = (value: number) => {
    if (!Number.isFinite(value)) return '0'
    if (Number.isInteger(value)) return String(value)
    return value.toFixed(3).replace(/\.?0+$/, '')
  }

  const recipeTotalPages = Math.max(
    1,
    Math.ceil(pendingRecipes.length / RECIPE_ITEMS_PER_PAGE),
  )
  const paginatedRecipes = pendingRecipes.slice(
    (recipePage - 1) * RECIPE_ITEMS_PER_PAGE,
    recipePage * RECIPE_ITEMS_PER_PAGE,
  )

  const menuGroupTotalPages = Math.max(
    1,
    Math.ceil(menuProductionGroups.length / MENU_GROUP_ITEMS_PER_PAGE),
  )
  const paginatedMenuGroups = menuProductionGroups.slice(
    (menuGroupPage - 1) * MENU_GROUP_ITEMS_PER_PAGE,
    menuGroupPage * MENU_GROUP_ITEMS_PER_PAGE,
  )

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
          <TablePagination
            page={recipePage}
            totalPages={recipeTotalPages}
            onPageChange={setRecipePage}
            summary={`Showing ${paginatedRecipes.length} of ${pendingRecipes.length} recipes`}
            className="mt-4"
          />
          <div className="mt-4 overflow-x-auto rounded-md border border-border">
            <table className="dm-table min-w-full bg-white text-sm">
              <thead className="bg-background">
                <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                  <th className="w-12 px-4 py-3 font-semibold">No</th>
                  <th className="px-4 py-3 font-semibold">Recipe ID</th>
                  <th className="px-4 py-3 font-semibold">Name</th>
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="px-4 py-3 font-semibold">Recipe status</th>
                  <th className="px-4 py-3 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {pendingRecipes.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-muted">
                      No recipes pending approval.
                    </td>
                  </tr>
                ) : (
                  paginatedRecipes.map((item, index) => (
                    <tr key={item.id ?? item._id} className="border-t border-border">
                      <td className="px-4 py-3 text-sm text-muted">
                        {(recipePage - 1) * RECIPE_ITEMS_PER_PAGE + index + 1}
                      </td>
                      <td className="px-4 py-3 font-medium">
                        {item.recipeCode ?? '-'}
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
                            className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-white"
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
                            className="rounded-md border border-danger bg-white px-3 py-2 text-xs font-semibold text-danger hover:bg-danger/10"
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
        <TablePagination
          page={menuGroupPage}
          totalPages={menuGroupTotalPages}
          onPageChange={setMenuGroupPage}
          summary={`Showing ${paginatedMenuGroups.length} of ${menuProductionGroups.length} production dates`}
          className="mt-4"
        />
        <div className="mt-4 overflow-x-auto rounded-md border border-border">
          <table className="dm-table min-w-full bg-white text-sm">
            <thead className="bg-background">
              <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                <th className="w-16 px-4 py-3 font-semibold">No</th>
                <th className="px-4 py-3 font-semibold">Production date</th>
                <th className="px-4 py-3 font-semibold">Approval status</th>
                <th className="px-4 py-3 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {menuProductionGroups.length === 0 ? (
                <tr className="border-t border-border">
                  <td colSpan={4} className="px-4 py-8 text-center text-muted">
                    No production menus pending approval.
                  </td>
                </tr>
              ) : (
                paginatedMenuGroups.map((group, index) => {
                  const isExpanded = expandedDates.includes(group.date)

                  return (
                    <Fragment key={group.date}>
                      <tr className="border-t border-border">
                        <td className="px-4 py-3 text-sm text-muted">
                          {(menuGroupPage - 1) * MENU_GROUP_ITEMS_PER_PAGE + index + 1}
                        </td>
                        <td className="px-4 py-3">{group.date}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="rounded-full bg-primary-soft px-2 py-1 text-xs font-semibold text-primary">
                              {getApprovalStatusLabel('pending')}
                            </span>
                            <span className="text-muted">{group.items.length} menus</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => toggleExpandedDate(group.date)}
                              className="rounded-md border border-primary bg-primary-soft px-3 py-2 text-xs font-semibold text-primary hover:bg-primary-soft/80"
                            >
                              {isExpanded ? 'Hide details' : 'View details'}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleBulkApproval(group.date, group.items, 'approve')
                              }
                              className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-white"
                            >
                              Approve all
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleBulkApproval(group.date, group.items, 'reject')
                              }
                              className="rounded-md border border-danger bg-white px-3 py-2 text-xs font-semibold text-danger hover:bg-danger/10"
                            >
                              Reject all
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded ? (
                        <tr className="border-t border-border bg-background">
                          <td colSpan={4} className="px-4 py-4">
                            <div className="grid gap-4 lg:grid-cols-12">
                              <div className="rounded-md border border-border bg-surface p-4 lg:col-span-5">
                                <p className="text-xs text-muted">Menu list</p>
                                <div className="mt-3 overflow-x-auto rounded-md border border-border bg-white">
                                  <table className="dm-table min-w-full text-sm">
                                    <thead className="bg-background">
                                      <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                                        <th className="w-12 px-4 py-3 font-semibold">No</th>
                                        <th className="px-4 py-3 font-semibold">Menu ID</th>
                                        <th className="px-4 py-3 font-semibold">Menu</th>
                                        <th className="px-4 py-3 font-semibold">Category</th>
                                        <th className="px-4 py-3 font-semibold">Portion</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {group.items.length === 0 ? (
                                        <tr className="border-t border-border">
                                          <td
                                            colSpan={5}
                                            className="px-4 py-6 text-center text-muted"
                                          >
                                            No menus pending in this group.
                                          </td>
                                        </tr>
                                      ) : (
                                        group.items.map((item, itemIndex) => (
                                          <tr key={item.id} className="border-t border-border">
                                            <td className="px-4 py-3 text-sm text-muted">
                                              {itemIndex + 1}
                                            </td>
                                            <td className="px-4 py-3 font-medium">
                                              {item.productionCode ?? '-'}
                                            </td>
                                            <td className="px-4 py-3">{item.menuName}</td>
                                            <td className="px-4 py-3">{item.category}</td>
                                            <td className="px-4 py-3">{item.portion}</td>
                                          </tr>
                                        ))
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                                {group.missingRecipes.length > 0 ? (
                                  <p className="mt-3 text-xs text-danger">
                                    Recipe not found for: {group.missingRecipes.join(', ')}
                                  </p>
                                ) : null}
                              </div>

                              <div className="rounded-md border border-border bg-surface p-4 lg:col-span-7">
                                <p className="text-xs text-muted">Ingredient summary</p>
                                <div className="mt-3 overflow-x-auto rounded-md border border-border bg-white">
                                  <table className="dm-table min-w-full text-sm">
                                    <thead className="bg-background">
                                      <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                                        <th className="w-12 px-4 py-3 font-semibold">No</th>
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
                                        group.summary.map((item, itemIndex) => (
                                          <tr
                                            key={`${item.productCode}-${item.unitOfMeasures}-${itemIndex}`}
                                            className="border-t border-border"
                                          >
                                            <td className="px-4 py-3 text-sm text-muted">
                                              {itemIndex + 1}
                                            </td>
                                            <td className="px-4 py-3">{item.productCode}</td>
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
  )
}

export default UnitManagerPage
