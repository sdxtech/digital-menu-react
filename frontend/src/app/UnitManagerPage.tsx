import { Fragment, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import TablePagination from '../components/TablePagination'
import { apiFetch } from '../lib/api'
import { useChefData } from '../lib/chef-data'
import { useAuth } from '../lib/auth'
import { formatQuantity } from '../lib/quantity'
import { aggregateStoreRequestSummary } from '../lib/store-request-summary'
import { getApprovalStatusLabel } from '../lib/status-labels'
import { formatUnitLabel } from '../lib/unit-of-measures'

const RECIPE_ITEMS_PER_PAGE = 10
const MENU_GROUP_ITEMS_PER_PAGE = 10

type ApprovalCenterSection = 'recipes' | 'menu-productions'

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
  vendor?: string
  vendorSite?: string
  price?: number
  ingredientCost?: number
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
  estimatedCost?: number
  productionDate: string
  approvalStatus: 'pending' | 'approved' | 'rejected'
  rejectionReason?: string
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

const approvalCenterSections: Array<{
  id: ApprovalCenterSection
  label: string
}> = [
  { id: 'recipes', label: 'Recipe Approval' },
  {
    id: 'menu-productions',
    label: 'Menu Production Approval',
  },
]

const isApprovalCenterSection = (
  value: string | null,
): value is ApprovalCenterSection =>
  approvalCenterSections.some((section) => section.id === value)

const formatPrice = (value?: number) => {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return '-'
  }
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(value)
}

const UnitManagerPage = () => {
  const { accessToken } = useAuth()
  const [searchParams] = useSearchParams()
  const sectionParam = searchParams.get('section')
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
  const [menuRejectTarget, setMenuRejectTarget] =
    useState<StoreRequestMenu | null>(null)
  const [menuRejectReason, setMenuRejectReason] = useState('')
  const [menuRejectError, setMenuRejectError] = useState('')
  const [menuRejectSubmitting, setMenuRejectSubmitting] = useState(false)
  const [expandedRecipeKeys, setExpandedRecipeKeys] = useState<string[]>([])
  const [expandedGroups, setExpandedGroups] = useState<string[]>([])
  const [recipePage, setRecipePage] = useState(1)
  const [menuGroupPage, setMenuGroupPage] = useState(1)
  const [activeSection, setActiveSection] = useState<ApprovalCenterSection>(() =>
    isApprovalCenterSection(sectionParam) ? sectionParam : 'recipes',
  )

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
    const nextSection = isApprovalCenterSection(sectionParam)
      ? sectionParam
      : 'recipes'
    setActiveSection((current) =>
      current === nextSection ? current : nextSection,
    )
  }, [sectionParam])

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

  const openMenuRejectModal = (menu: StoreRequestMenu) => {
    setActionError('')
    setActionMessage('')
    setMenuRejectTarget(menu)
    setMenuRejectReason('')
    setMenuRejectError('')
  }

  const closeMenuRejectModal = () => {
    if (menuRejectSubmitting) return
    setMenuRejectTarget(null)
    setMenuRejectReason('')
    setMenuRejectError('')
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

  const handleMenuApproval = async (menu: StoreRequestMenu) => {
    const id = menu.id ?? ''
    if (!id) {
      setActionError('Menu production id is missing.')
      setActionMessage('')
      return
    }

    setActionError('')
    setActionMessage('')

    try {
      await approveMenuProduction(id)
      setActionMessage(`${menu.menuName} approved.`)
      fetchPending().catch(() => null)
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'Failed to approve menu production.',
      )
    }
  }

  const handleRejectMenuProduction = async () => {
    if (!menuRejectTarget) return
    const id = menuRejectTarget.id ?? ''
    const reason = menuRejectReason.trim()
    if (!id) {
      setMenuRejectError('Menu production id is missing.')
      return
    }
    if (!reason) {
      setMenuRejectError('Rejection reason is required.')
      return
    }

    setMenuRejectSubmitting(true)
    setActionError('')
    setActionMessage('')
    setMenuRejectError('')
    try {
      await rejectMenuProduction(id, reason)
      setActionMessage(`${menuRejectTarget.menuName} rejected.`)
      setMenuRejectTarget(null)
      setMenuRejectReason('')
      fetchPending().catch(() => null)
    } catch (error) {
      setMenuRejectError(
        error instanceof Error
          ? error.message
          : 'Failed to reject menu production.',
      )
    } finally {
      setMenuRejectSubmitting(false)
    }
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
    <div className="w-full py-2">
      <div className="space-y-6">
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

        {menuRejectTarget ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div
              className="w-full max-w-lg rounded-md border border-border bg-surface p-6 shadow-xl"
              role="dialog"
              aria-modal="true"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Reject Menu</h2>
                  <p className="mt-1 text-sm text-muted">
                    {menuRejectTarget.menuName}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {menuRejectTarget.productionDate}
                    {menuRejectTarget.productionCode
                      ? ` (${menuRejectTarget.productionCode})`
                      : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeMenuRejectModal}
                  className="dm-x-button"
                  aria-label="Close menu rejection form"
                  title="Close"
                >
                  <i className="bi bi-x-lg text-sm leading-none" aria-hidden="true" />
                </button>
              </div>

              <label className="mt-5 block text-sm font-medium text-foreground">
                Rejection reason
              </label>
              <textarea
                value={menuRejectReason}
                onChange={(event) => {
                  setMenuRejectReason(event.target.value)
                  if (menuRejectError) setMenuRejectError('')
                }}
                maxLength={500}
                rows={5}
                className="mt-2 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                placeholder="Tell the Chef why this menu production is rejected."
              />
              <p className="mt-2 text-xs text-muted">
                {menuRejectReason.trim().length}/500 characters
              </p>
              {menuRejectError ? (
                <p className="mt-2 text-xs font-medium text-red-600">
                  {menuRejectError}
                </p>
              ) : null}

              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={closeMenuRejectModal}
                  disabled={menuRejectSubmitting}
                  className="rounded-md border border-border bg-background px-4 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleRejectMenuProduction}
                  disabled={menuRejectSubmitting}
                  className="rounded-md border border-danger bg-white px-4 py-2 text-xs font-semibold text-danger hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {menuRejectSubmitting ? 'Rejecting...' : 'Reject menu'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {activeSection === 'recipes' ? (
          <div className="rounded-md border border-border bg-surface p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Recipe Approval</h2>
                <p className="mt-1 text-sm text-muted">
                  Review recipe drafts submitted by the Chef team.
                </p>
              </div>
            </div>
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
                                    <p className="mt-1 text-sm font-medium">
                                      {submittedBy}
                                    </p>
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
                                            ingredients.map(
                                              (ingredient, ingredientIndex) => (
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
                                              ),
                                            )
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
        ) : (
          <div className="rounded-md border border-border bg-surface p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Menu Production Approval</h2>
                <p className="mt-1 text-sm text-muted">
                  Review production batches before they move to Storekeeper.
                </p>
              </div>
            </div>
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
                      const pendingMenuCount = group.items.filter(
                        (item) => item.approvalStatus === 'pending',
                      ).length

                      return (
                        <Fragment key={groupKey}>
                          <tr className="border-t border-border">
                            <td className="px-4 py-3 text-sm text-muted">
                              {(menuGroupPage - 1) * MENU_GROUP_ITEMS_PER_PAGE +
                                index +
                                1}
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
                                <span className="text-muted">
                                  {pendingMenuCount} of {group.items.length} menus
                                  pending
                                </span>
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
                                            <th className="w-12 px-4 py-3 font-semibold">
                                              No
                                            </th>
                                            <th className="px-4 py-3 font-semibold">
                                              Menu ID
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
                                            <th className="px-4 py-3 font-semibold">
                                              Estimated Cost
                                            </th>
                                            <th className="px-4 py-3 font-semibold">
                                              Cost/Pax
                                            </th>
                                            <th className="px-4 py-3 font-semibold">
                                              Approval Status
                                            </th>
                                            <th className="px-4 py-3 font-semibold">
                                              Action
                                            </th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {group.items.length === 0 ? (
                                            <tr className="border-t border-border">
                                              <td
                                                colSpan={9}
                                                className="px-4 py-6 text-center text-muted"
                                              >
                                                No menus pending in this group.
                                              </td>
                                            </tr>
                                          ) : (
                                            group.items.map((item, itemIndex) => {
                                              const estimatedCost = Number.isFinite(
                                                Number(item.estimatedCost),
                                              )
                                                ? Number(item.estimatedCost)
                                                : undefined
                                              const estimatedCostPerPax =
                                                estimatedCost !== undefined &&
                                                item.portion > 0
                                                  ? estimatedCost / item.portion
                                                  : undefined

                                              return (
                                                <tr
                                                  key={item.id}
                                                  className="border-t border-border"
                                                >
                                                  <td className="px-4 py-3 text-sm text-muted">
                                                    {itemIndex + 1}
                                                  </td>
                                                  <td className="px-4 py-3 font-medium">
                                                    {item.recipeCode ?? '-'}
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
                                                  <td className="px-4 py-3 font-medium">
                                                    {formatPrice(estimatedCost)}
                                                  </td>
                                                  <td className="px-4 py-3 font-medium">
                                                    {formatPrice(
                                                      estimatedCostPerPax,
                                                    )}
                                                  </td>
                                                  <td className="px-4 py-3">
                                                    <span
                                                      className={`rounded-full px-2 py-1 text-xs font-semibold ${
                                                        item.approvalStatus ===
                                                        'approved'
                                                          ? 'bg-primary-soft text-primary'
                                                          : item.approvalStatus ===
                                                              'rejected'
                                                            ? 'bg-danger/10 text-danger'
                                                            : 'bg-background text-muted'
                                                      }`}
                                                    >
                                                      {getApprovalStatusLabel(
                                                        item.approvalStatus,
                                                      )}
                                                    </span>
                                                  </td>
                                                  <td className="px-4 py-3">
                                                    {item.approvalStatus ===
                                                    'pending' ? (
                                                      <div className="flex flex-wrap gap-2">
                                                        <button
                                                          type="button"
                                                          onClick={() =>
                                                            handleMenuApproval(
                                                              item,
                                                            )
                                                          }
                                                          className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-white"
                                                        >
                                                          Approve
                                                        </button>
                                                        <button
                                                          type="button"
                                                          onClick={() =>
                                                            openMenuRejectModal(
                                                              item,
                                                            )
                                                          }
                                                          className="rounded-md border border-danger bg-white px-3 py-2 text-xs font-semibold text-danger hover:bg-danger/10"
                                                        >
                                                          Reject
                                                        </button>
                                                      </div>
                                                    ) : (
                                                      <span className="text-xs text-muted">
                                                        Reviewed
                                                      </span>
                                                    )}
                                                  </td>
                                                </tr>
                                              )
                                            })
                                          )}
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

                                  <div className="rounded-md border border-border bg-surface p-4 lg:col-span-7">
                                    <p className="text-xs text-muted">
                                      Ingredient summary
                                    </p>
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
                                            <th className="px-4 py-3 font-semibold">
                                              Vendor
                                            </th>
                                            <th className="px-4 py-3 font-semibold">
                                              Price
                                            </th>
                                            <th className="px-4 py-3 font-semibold">
                                              Ingredient Cost
                                            </th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {summaryItems.length === 0 ? (
                                            <tr className="border-t border-border">
                                              <td
                                                colSpan={8}
                                                className="px-4 py-6 text-center text-muted"
                                              >
                                                No ingredients available to
                                                calculate.
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
                                                <td className="px-4 py-3">
                                                  {item.productCode}
                                                </td>
                                                <td className="px-4 py-3">
                                                  {item.name}
                                                </td>
                                                <td className="px-4 py-3">
                                                  {formatQuantity(item.qty)}
                                                </td>
                                                <td className="px-4 py-3">
                                                  {formatUnitLabel(
                                                    item.unitOfMeasures,
                                                  )}
                                                </td>
                                                <td className="px-4 py-3">
                                                  {item.vendor ?? '-'}
                                                </td>
                                                <td className="px-4 py-3 font-medium">
                                                  {formatPrice(item.price)}
                                                </td>
                                                <td className="px-4 py-3 font-medium">
                                                  {formatPrice(
                                                    item.ingredientCost,
                                                  )}
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
        )}
      </div>
    </div>
  )
}

export default UnitManagerPage
