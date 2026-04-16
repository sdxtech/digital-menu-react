import { Fragment, useCallback, useEffect, useState } from 'react'
import TablePagination from '../components/TablePagination'
import { apiFetch } from '../lib/api'
import { useChefData } from '../lib/chef-data'
import { useAuth } from '../lib/auth'
import { aggregateStoreRequestSummary } from '../lib/store-request-summary'
import { getApprovalStatusLabel } from '../lib/status-labels'
import { formatUnitLabel } from '../lib/unit-of-measures'

const RECIPE_ITEMS_PER_PAGE = 10
const MENU_GROUP_ITEMS_PER_PAGE = 10

type RecipeIngredient = {
  productCode?: string
  name?: string
  unitOfMeasures?: string
  qty?: number
}

type Recipe = {
  id?: string
  _id?: string
  recipeCode?: string
  name: string
  category: string
  description?: string
  imageUrl?: string
  ingredients?: RecipeIngredient[]
  createdBy?: string
  createdByName?: string
  createdByEmail?: string
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
  submittedByName?: string
  recipeId?: string
  recipeCode?: string
  menuName: string
  category: string
  portion: number
  cost?: number
  productionDate: string
  approvalStatus: 'pending' | 'approved' | 'rejected'
  storeRequestStatus: 'not-requested' | 'requested' | 'fulfilled' | 'cancelled'
  portionSize: number
  ingredients: StoreRequestIngredient[]
  missingRecipe: boolean
}

type StoreRequestGroup = {
  date: string
  productionCode?: string
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
  const [recipeRejectTarget, setRecipeRejectTarget] = useState<Recipe | null>(
    null,
  )
  const [recipeRejectReason, setRecipeRejectReason] = useState('')
  const [recipeRejectError, setRecipeRejectError] = useState('')
  const [recipeRejectSubmitting, setRecipeRejectSubmitting] = useState(false)
  const [expandedRecipeKeys, setExpandedRecipeKeys] = useState<string[]>([])
  const [expandedGroups, setExpandedGroups] = useState<string[]>([])
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

  const getGroupKey = (group: StoreRequestGroup) =>
    `${group.date}__${group.productionCode ?? 'no-code'}`

  const getRecipeKey = (recipe: Recipe) =>
    recipe.id ?? recipe._id ?? recipe.recipeCode ?? recipe.name

  const toggleRecipeDetails = (recipeKey: string) => {
    setExpandedRecipeKeys((prev) =>
      prev.includes(recipeKey)
        ? prev.filter((item) => item !== recipeKey)
        : [...prev, recipeKey],
    )
  }

  const toggleExpandedDate = (groupKey: string) => {
    setExpandedGroups((prev) =>
      prev.includes(groupKey)
        ? prev.filter((item) => item !== groupKey)
        : [...prev, groupKey],
    )
  }

  const openRecipeRejectModal = (recipe: Recipe) => {
    setActionError('')
    setActionMessage('')
    setRecipeRejectTarget(recipe)
    setRecipeRejectReason('')
    setRecipeRejectError('')
  }

  const closeRecipeRejectModal = () => {
    if (recipeRejectSubmitting) return
    setRecipeRejectTarget(null)
    setRecipeRejectReason('')
    setRecipeRejectError('')
  }

  const handleRejectRecipe = async () => {
    if (!recipeRejectTarget) return
    const id = recipeRejectTarget.id ?? recipeRejectTarget._id ?? ''
    const reason = recipeRejectReason.trim()
    if (!id) {
      setRecipeRejectError('Recipe id is missing.')
      return
    }
    if (!reason) {
      setRecipeRejectError('Rejection reason is required.')
      return
    }

    setRecipeRejectSubmitting(true)
    setActionError('')
    setActionMessage('')
    setRecipeRejectError('')
    try {
      await rejectRecipe(id, reason)
      setActionMessage(`${recipeRejectTarget.name} rejected.`)
      setRecipeRejectTarget(null)
      setRecipeRejectReason('')
      fetchPending().catch(() => null)
    } catch (error) {
      setRecipeRejectError(
        error instanceof Error ? error.message : 'Failed to reject recipe.',
      )
    } finally {
      setRecipeRejectSubmitting(false)
    }
  }

  const handleBulkApproval = async (
    batchLabel: string,
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
        `${successCount} menu ${action === 'approve' ? 'approved' : 'rejected'} for ${batchLabel}.`,
      )
    }
    if (failedCount > 0) {
      setActionError(`${failedCount} menu failed to ${action} for ${batchLabel}.`)
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

        {recipeRejectTarget ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div
              className="w-full max-w-lg rounded-md border border-border bg-surface p-6 shadow-xl"
              role="dialog"
              aria-modal="true"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">
                    Reject Recipe
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    {recipeRejectTarget.name}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeRecipeRejectModal}
                  className="dm-x-button"
                  aria-label="Close rejection form"
                  title="Close"
                >
                  <i className="bi bi-x-lg text-sm leading-none" aria-hidden="true" />
                </button>
              </div>

              <label className="mt-5 block text-sm font-medium text-foreground">
                Rejection reason
              </label>
              <textarea
                value={recipeRejectReason}
                onChange={(event) => {
                  setRecipeRejectReason(event.target.value)
                  if (recipeRejectError) setRecipeRejectError('')
                }}
                maxLength={500}
                rows={5}
                className="mt-2 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                placeholder="Tell the Chef what needs to be corrected."
              />
              <p className="mt-2 text-xs text-muted">
                {recipeRejectReason.trim().length}/500 characters
              </p>
              {recipeRejectError ? (
                <p className="mt-2 text-xs font-medium text-red-600">
                  {recipeRejectError}
                </p>
              ) : null}

              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={closeRecipeRejectModal}
                  disabled={recipeRejectSubmitting}
                  className="rounded-md border border-border bg-background px-4 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleRejectRecipe}
                  disabled={recipeRejectSubmitting}
                  className="rounded-md border border-danger bg-white px-4 py-2 text-xs font-semibold text-danger hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {recipeRejectSubmitting ? 'Rejecting...' : 'Reject recipe'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="rounded-md border border-border bg-surface p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Approval Recipe</h2>
          <TablePagination
            page={recipePage}
            totalPages={recipeTotalPages}
            onPageChange={setRecipePage}
            summary={`Showing ${paginatedRecipes.length} of ${pendingRecipes.length} recipes`}
            className="mt-4"
          />
          <div className="mt-4 max-w-full overflow-x-auto rounded-md border border-border">
            <table className="dm-table min-w-full bg-white text-sm">
              <thead className="bg-background">
                <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                  <th className="w-12 px-4 py-3 font-semibold">No</th>
                  <th className="px-4 py-3 font-semibold">Recipe ID</th>
                  <th className="px-4 py-3 font-semibold">Name</th>
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="px-4 py-3 font-semibold">Chef</th>
                  <th className="px-4 py-3 font-semibold">Recipe status</th>
                  <th className="px-4 py-3 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {pendingRecipes.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-muted">
                      No recipes pending approval.
                    </td>
                  </tr>
                ) : (
                  paginatedRecipes.map((item, index) => {
                    const recipeKey = getRecipeKey(item)
                    const isExpanded = expandedRecipeKeys.includes(recipeKey)
                    const ingredients = item.ingredients ?? []
                    const submittedBy =
                      item.createdByName?.trim() ||
                      item.createdByEmail?.trim() ||
                      item.createdBy?.trim() ||
                      '-'
                    const description = item.description?.trim() || '-'

                    return (
                      <Fragment key={recipeKey}>
                        <tr className="border-t border-border">
                          <td className="px-4 py-3 text-sm text-muted">
                            {(recipePage - 1) * RECIPE_ITEMS_PER_PAGE + index + 1}
                          </td>
                          <td className="px-4 py-3 font-medium">
                            {item.recipeCode ?? '-'}
                          </td>
                          <td className="px-4 py-3">{item.name}</td>
                          <td className="px-4 py-3">{item.category}</td>
                          <td className="px-4 py-3">{submittedBy}</td>
                          <td className="px-4 py-3">
                            {item.status === 'active' ? 'Active' : 'Draft'}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => toggleRecipeDetails(recipeKey)}
                                className="rounded-md border border-primary bg-primary-soft px-3 py-2 text-xs font-semibold text-primary hover:bg-primary-soft/80"
                              >
                                {isExpanded ? 'Hide details' : 'View details'}
                              </button>
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
                                onClick={() => openRecipeRejectModal(item)}
                                className="rounded-md border border-danger bg-white px-3 py-2 text-xs font-semibold text-danger hover:bg-danger/10"
                              >
                                Reject
                              </button>
                            </div>
                          </td>
                        </tr>
                        {isExpanded ? (
                          <tr className="border-t border-border bg-background">
                            <td colSpan={7} className="px-4 py-4">
                              <div className="grid gap-4 lg:grid-cols-12">
                                <div className="rounded-md border border-border bg-surface p-4 lg:col-span-4">
                                  <p className="text-xs text-muted">Recipe details</p>
                                  <div className="mt-3 h-40 overflow-hidden rounded-md border border-border bg-background">
                                    {item.imageUrl ? (
                                      <img
                                        src={item.imageUrl}
                                        alt={`${item.name} photo`}
                                        className="h-full w-full object-cover"
                                      />
                                    ) : (
                                      <div className="flex h-full items-center justify-center text-xs text-muted">
                                        No photo
                                      </div>
                                    )}
                                  </div>
                                  <p className="mt-3 text-xs text-muted">Submitted by</p>
                                  <p className="mt-1 text-sm font-medium">{submittedBy}</p>
                                  <p className="mt-3 text-xs text-muted">Description</p>
                                  <p className="mt-1 text-sm text-foreground">
                                    {description}
                                  </p>
                                </div>

                                <div className="rounded-md border border-border bg-surface p-4 lg:col-span-8">
                                  <p className="text-xs text-muted">Ingredients</p>
                                  <div className="mt-3 max-w-full overflow-x-auto rounded-md border border-border bg-white">
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
                                        {ingredients.length === 0 ? (
                                          <tr className="border-t border-border">
                                            <td
                                              colSpan={5}
                                              className="px-4 py-6 text-center text-muted"
                                            >
                                              No ingredients available.
                                            </td>
                                          </tr>
                                        ) : (
                                          ingredients.map((ingredient, ingredientIndex) => (
                                            <tr
                                              key={`${ingredient.productCode ?? ingredient.name ?? ingredientIndex}-${ingredientIndex}`}
                                              className="border-t border-border"
                                            >
                                              <td className="px-4 py-3 text-sm text-muted">
                                                {ingredientIndex + 1}
                                              </td>
                                              <td className="px-4 py-3">
                                                {ingredient.productCode || '-'}
                                              </td>
                                              <td className="px-4 py-3">
                                                {ingredient.name || '-'}
                                              </td>
                                              <td className="px-4 py-3">
                                                {typeof ingredient.qty === 'number'
                                                  ? formatQuantity(ingredient.qty)
                                                  : '-'}
                                              </td>
                                              <td className="px-4 py-3">
                                                {ingredient.unitOfMeasures
                                                  ? formatUnitLabel(
                                                      ingredient.unitOfMeasures,
                                                    )
                                                  : '-'}
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

      <div className="rounded-md border border-border bg-surface p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Approval Menu Production</h2>
        <TablePagination
          page={menuGroupPage}
          totalPages={menuGroupTotalPages}
          onPageChange={setMenuGroupPage}
          summary={`Showing ${paginatedMenuGroups.length} of ${menuProductionGroups.length} production batches`}
          className="mt-4"
        />
        <div className="mt-4 max-w-full overflow-x-auto rounded-md border border-border">
          <table className="dm-table min-w-full bg-white text-sm">
            <thead className="bg-background">
              <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                <th className="w-16 px-4 py-3 font-semibold">No</th>
                <th className="px-4 py-3 font-semibold">Production date</th>
                <th className="px-4 py-3 font-semibold">Production code</th>
                <th className="px-4 py-3 font-semibold">Chef</th>
                <th className="px-4 py-3 font-semibold">Approval status</th>
                <th className="px-4 py-3 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {menuProductionGroups.length === 0 ? (
                <tr className="border-t border-border">
                  <td colSpan={6} className="px-4 py-8 text-center text-muted">
                    No production menus pending approval.
                  </td>
                </tr>
              ) : (
                paginatedMenuGroups.map((group, index) => {
                  const groupKey = getGroupKey(group)
                  const isExpanded = expandedGroups.includes(groupKey)
                  const summaryItems = aggregateStoreRequestSummary(group.summary)
                  const batchLabel = group.productionCode
                    ? `${group.date} (${group.productionCode})`
                    : group.date
                  const submittedByNames = Array.from(
                    new Set(
                      group.items
                        .map((item) => item.submittedByName?.trim())
                        .filter((value): value is string => Boolean(value)),
                    ),
                  )
                  const submittedByLabel = submittedByNames.length
                    ? submittedByNames.join(', ')
                    : '-'

                  return (
                    <Fragment key={groupKey}>
                      <tr className="border-t border-border">
                        <td className="px-4 py-3 text-sm text-muted">
                          {(menuGroupPage - 1) * MENU_GROUP_ITEMS_PER_PAGE + index + 1}
                        </td>
                        <td className="px-4 py-3">{group.date}</td>
                        <td className="px-4 py-3 text-xs text-muted">
                          {group.productionCode ?? '-'}
                        </td>
                        <td className="px-4 py-3">{submittedByLabel}</td>
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
                              onClick={() => toggleExpandedDate(groupKey)}
                              className="rounded-md border border-primary bg-primary-soft px-3 py-2 text-xs font-semibold text-primary hover:bg-primary-soft/80"
                            >
                              {isExpanded ? 'Hide details' : 'View details'}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleBulkApproval(batchLabel, group.items, 'approve')
                              }
                              className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-white"
                            >
                              Approve all
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleBulkApproval(batchLabel, group.items, 'reject')
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
                          <td colSpan={6} className="px-4 py-4">
                            <div className="grid gap-4 lg:grid-cols-12">
                              <div className="rounded-md border border-border bg-surface p-4 lg:col-span-5">
                                <p className="text-xs text-muted">Menu list</p>
                                <div className="mt-3 max-w-full overflow-x-auto rounded-md border border-border bg-white">
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
                                              {item.recipeCode ?? '-'}
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
                                <div className="mt-3 max-w-full overflow-x-auto rounded-md border border-border bg-white">
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
                                      {summaryItems.length === 0 ? (
                                        <tr className="border-t border-border">
                                          <td
                                            colSpan={5}
                                            className="px-4 py-6 text-center text-muted"
                                          >
                                            No ingredients available to calculate.
                                          </td>
                                        </tr>
                                      ) : (
                                        summaryItems.map((item, itemIndex) => (
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
