import { Fragment, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import TablePagination from '../components/TablePagination'
import { apiFetch } from '../lib/api'
import { useChefData } from '../lib/chef-data'
import { useAuth } from '../lib/auth'
import {
  calculateFoodCostPercentage,
  formatFoodCostPercentage,
} from '../lib/food-cost'
import { formatQuantity } from '../lib/quantity'
import { summarizePortionsByGroup } from '../lib/menu-production-quantity'
import { formatRecipeVersion } from '../lib/recipe-version'
import { aggregateStoreRequestSummaryByVendor } from '../lib/store-request-summary'
import { getApprovalStatusLabel } from '../lib/status-labels'
import { formatUnitLabel } from '../lib/unit-of-measures'
import {
  downloadSpreadsheet,
  toSpreadsheetDate,
  toSpreadsheetDecimal,
  type SpreadsheetCell,
} from '../lib/spreadsheet-export'

const RECIPE_ITEMS_PER_PAGE = 10
const MENU_GROUP_ITEMS_PER_PAGE = 10

type ApprovalCenterSection = 'recipes' | 'menu-productions'

type RecipeIngredient = {
  ingredientType?: 'IT' | 'NMP'
  productCode?: string
  name?: string
  unitOfMeasures?: string
  qty?: number
}

type Recipe = {
  id?: string
  _id?: string
  recipeCode?: string
  version?: number
  name: string
  category: string
  description?: string
  imageUrl?: string
  ingredients?: RecipeIngredient[]
  createdBy?: string
  createdByName?: string
  createdByEmail?: string
  approvalHistory?: Array<{
    rejectionReason: string
    rejectedByName?: string
    rejectedAt?: string
    resubmissionFeedback?: string
    resubmittedByName?: string
    resubmittedAt?: string
  }>
  status: 'draft' | 'active'
  approvalStatus: 'pending' | 'approved' | 'rejected'
}

type StoreRequestIngredient = {
  ingredientType?: 'IT' | 'NMP'
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
  submittedAt?: string
  recipeId?: string
  recipeCode?: string
  recipeVersion?: number
  menuName: string
  clientName?: string
  category: string
  group?: string
  portion: number
  cost?: number
  estimatedCost?: number
  estimatedCostPerPax?: number
  sellingPricePerPax?: number
  sellingQuantity?: number
  estimatedRevenue?: number
  salesInputBy?: string
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

const getGroupSubmittedAt = (group: StoreRequestGroup) =>
  group.items.find((item) => item.submittedAt)?.submittedAt

const formatCreatedDate = (value?: string) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
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

const UnitManagerPage = ({ corporateOnly = false }: { corporateOnly?: boolean }) => {
  const { accessToken, user, updateUser } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const sectionParam = searchParams.get('section')
  const requestedSite = searchParams.get('site')
  const assignedSites = corporateOnly
    ? Array.from(new Set([...(user?.site ? [user.site] : []), ...(user?.sites ?? [])]))
    : []
  const selectedSite =
    assignedSites.find((site) => site.toLowerCase() === requestedSite?.toLowerCase()) ??
    assignedSites[0]
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

  useEffect(() => {
    if (!corporateOnly || !accessToken) return
    apiFetch<{
      sites?: string[]
      siteOptions?: Array<{ code: string; name: string }>
    }>('/auth/me', undefined, accessToken)
      .then((data) => {
        if (data.sites?.length) {
          updateUser({ sites: data.sites, siteOptions: data.siteOptions })
        }
      })
      .catch(() => null)
  }, [accessToken, corporateOnly, updateUser])

  // FRONTEND VIEW: pending approvals are fetched from backend.
  const fetchPending = useCallback(async () => {
    if (!accessToken) return
    try {
      const recipeParams = new URLSearchParams({ approvalStatus: 'pending', limit: '50' })
      if (corporateOnly && selectedSite) recipeParams.set('site', selectedSite)
      const recipesData = await apiFetch<{ items: Recipe[] }>(
        `/recipes?${recipeParams.toString()}`,
        undefined,
        accessToken,
      )
      const menusData = corporateOnly
        ? { items: [] as StoreRequestGroup[] }
        : await apiFetch<{ items: StoreRequestGroup[] }>(
            '/menu-productions/store-requests?approvalStatus=pending',
            undefined,
            accessToken,
          )
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
  }, [accessToken, corporateOnly, selectedSite])

  useEffect(() => {
    setActionError('')
    setActionMessage('')
    fetchPending().catch(() => null)
  }, [fetchPending])

  useEffect(() => {
    const nextSection = corporateOnly
      ? 'recipes'
      : isApprovalCenterSection(sectionParam)
      ? sectionParam
      : 'recipes'
    setActiveSection((current) =>
      current === nextSection ? current : nextSection,
    )
  }, [corporateOnly, sectionParam])

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

  const clearApprovalNotification = useCallback(
    async (componentKey: 'RECIPE_APPROVAL_REQUESTS' | 'MENU_PRODUCTION_APPROVAL_REQUESTS') => {
      if (!accessToken || !user?.site) return

      await apiFetch(
        '/notifications/mark-role-read',
        {
          method: 'PATCH',
          body: JSON.stringify({
            siteCode: user.site,
            targetUserRole: 'unit.manager',
            componentKey,
          }),
        },
        accessToken,
      )
      window.dispatchEvent(new CustomEvent('refresh-notifications'))
    },
    [accessToken, user?.site],
  )

  const handleExportMenuProductionGroup = (group: StoreRequestGroup) => {
    const rows: SpreadsheetCell[][] = [
      [
        'No',
        'Created Date',
        'Production Date',
        'Client Name',
        'Production Code',
        'Group By',
        'Menu Name',
        'Version',
        'Recipe Code',
        'Category',
        'Portion',
        'Product Type',
        'Product Code',
        'Ingredient Name',
        'Vendor',
        'QTY',
        'Unit',
      ],
    ]

    let rowNumber = 1
    group.items.forEach((menu) => {
      const ingredients = menu.ingredients ?? []
      if (ingredients.length === 0) {
        rows.push([
          rowNumber,
          formatCreatedDate(menu.submittedAt),
          toSpreadsheetDate(group.date),
          menu.clientName ?? '',
          group.productionCode ?? '',
          menu.group ?? '',
          menu.menuName,
          formatRecipeVersion(menu.recipeVersion),
          menu.recipeCode ?? menu.recipeId ?? '',
          menu.category,
          menu.portion,
          '',
          '',
          '',
          '',
          '',
          '',
        ])
        rowNumber += 1
        return
      }

      ingredients.forEach((ingredient) => {
        rows.push([
          rowNumber,
          formatCreatedDate(menu.submittedAt),
          toSpreadsheetDate(menu.productionDate ?? group.date),
          menu.clientName ?? '',
          menu.productionCode ?? group.productionCode ?? '',
          menu.group ?? '',
          menu.menuName,
          formatRecipeVersion(menu.recipeVersion),
          menu.recipeCode ?? menu.recipeId ?? '',
          menu.category,
          menu.portion,
          ingredient.ingredientType ?? '',
          ingredient.productCode,
          ingredient.name,
          ingredient.vendor ?? '',
          toSpreadsheetDecimal(formatQuantity(ingredient.qty)),
          formatUnitLabel(ingredient.unitOfMeasures),
        ])
        rowNumber += 1
      })
    })

    const summaryRows: SpreadsheetCell[][] = [
      ['Client Name', 'Product Type', 'Product Code', 'Ingredient Name', 'Vendor', 'QTY', 'Unit'],
      ...aggregateStoreRequestSummaryByVendor(group).map((item) => [
        group.items[0]?.clientName ?? '',
        item.ingredientType ?? '',
        item.productCode,
        item.name,
        item.vendor ?? '',
        toSpreadsheetDecimal(formatQuantity(item.qty)),
        formatUnitLabel(item.unitOfMeasures),
      ]),
    ]

    const safeDate = group.date.replace(/[\\/:*?"<>|]/g, '-')
    const safeProductionCode = (group.productionCode ?? 'no-code').replace(
      /[\\/:*?"<>|]/g,
      '-',
    )
    downloadSpreadsheet(`menu-production-${safeDate}-${safeProductionCode}.xlsx`, [
      { name: 'Menu Production', rows },
      { name: 'Ingredient Summary', rows: summaryRows },
    ])
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
      await clearApprovalNotification('RECIPE_APPROVAL_REQUESTS')
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
      await clearApprovalNotification('MENU_PRODUCTION_APPROVAL_REQUESTS')
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
      await clearApprovalNotification('MENU_PRODUCTION_APPROVAL_REQUESTS')
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
            {corporateOnly
              ? 'Review recipes from your assigned sites.'
              : 'Review recipes and production menus from the Chef team.'}
          </p>
          {corporateOnly && assignedSites.length > 0 ? (
            <label className="mt-4 block max-w-sm text-sm font-medium text-foreground">
              Site
              <select
                value={selectedSite ?? ''}
                onChange={(event) => {
                  const next = new URLSearchParams(searchParams)
                  next.set('section', 'recipes')
                  next.set('site', event.target.value)
                  setSearchParams(next)
                }}
                className="mt-2 w-full rounded-md border border-border bg-white px-3 py-2 text-sm"
              >
                {assignedSites.map((site) => (
                  <option key={site} value={site}>
                    {user?.siteOptions?.find((item) => item.code === site)?.name ?? site}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
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
                    <th className="px-4 py-3 font-semibold">Version</th>
                    <th className="px-4 py-3 font-semibold">Category</th>
                    <th className="px-4 py-3 font-semibold">Chef</th>
                    <th className="px-4 py-3 font-semibold">Recipe status</th>
                    <th className="px-4 py-3 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingRecipes.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-6 text-center text-muted">
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
                            <td className="px-4 py-3 font-semibold text-foreground">
                              {formatRecipeVersion(item.version)}
                            </td>
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
                                      await clearApprovalNotification(
                                        'RECIPE_APPROVAL_REQUESTS',
                                      )
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
                              <td colSpan={8} className="px-4 py-4">
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
                                    {item.approvalHistory?.length ? (
                                      <div className="mt-4 border-t border-border pt-4">
                                        <p className="text-xs font-semibold text-foreground">
                                          Approval history
                                        </p>
                                        <div className="mt-2 space-y-2">
                                          {item.approvalHistory.map((entry, historyIndex) => (
                                            <div
                                              key={`${entry.rejectedAt ?? 'rejection'}-${historyIndex}`}
                                              className="rounded-md border border-border bg-background p-3 text-xs"
                                            >
                                              <p className="font-semibold text-danger">
                                                Rejection {historyIndex + 1}
                                              </p>
                                              <p className="mt-1 text-foreground">
                                                {entry.rejectionReason || 'No rejection note.'}
                                              </p>
                                              {entry.resubmissionFeedback?.trim() ? (
                                                <div className="mt-2 rounded-md border border-primary/20 bg-primary-soft p-2">
                                                  <p className="font-semibold text-primary">
                                                    Chef feedback
                                                  </p>
                                                  <p className="mt-1 text-foreground">
                                                    {entry.resubmissionFeedback}
                                                  </p>
                                                </div>
                                              ) : null}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    ) : null}
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
            <div className="mt-4 overflow-hidden rounded-md border border-border">
              <table className="dm-table !w-full !table-fixed bg-white text-sm [&_td]:!whitespace-normal [&_th]:!whitespace-normal">
                <colgroup>
                  <col className="w-[5%]" />
                  <col className="w-[15%]" />
                  <col className="w-[14%]" />
                  <col className="w-[16%]" />
                  <col className="w-[15%]" />
                  <col className="w-[17%]" />
                  <col className="w-[18%]" />
                </colgroup>
                <thead className="bg-background">
                  <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                    <th className="px-4 py-3 font-semibold">No</th>
                    <th className="px-4 py-3 font-semibold">Created date</th>
                    <th className="px-4 py-3 font-semibold">Production date</th>
                    <th className="px-4 py-3 font-semibold">Production code</th>
                    <th className="px-4 py-3 font-semibold">Client name</th>
                    <th className="px-4 py-3 font-semibold">Approval status</th>
                    <th className="px-4 py-3 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {menuProductionGroups.length === 0 ? (
                    <tr className="border-t border-border">
                      <td colSpan={7} className="px-4 py-8 text-center text-muted">
                        No production menus pending approval.
                      </td>
                    </tr>
                  ) : (
                    paginatedMenuGroups.map((group, index) => {
                      const groupKey = getGroupKey(group)
                      const isExpanded = expandedGroups.includes(groupKey)
                      const summaryItems =
                        aggregateStoreRequestSummaryByVendor(group)
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
                      const salesInputByLabel =
                        group.items[0]?.salesInputBy?.trim() || '-'
                      const pendingMenuCount = group.items.filter(
                        (item) => item.approvalStatus === 'pending',
                      ).length
                      const totalEstimatedCost = group.items.reduce(
                        (total, item) =>
                          total +
                          (Number.isFinite(Number(item.estimatedCost))
                            ? Number(item.estimatedCost)
                            : Number.isFinite(Number(item.cost))
                              ? Number(item.cost)
                              : 0),
                        0,
                      )
                      const totalEstimatedCostPerPax = group.items.reduce(
                        (total, item) => {
                          const estimatedCost = Number.isFinite(
                            Number(item.estimatedCost),
                          )
                            ? Number(item.estimatedCost)
                            : Number.isFinite(Number(item.cost))
                              ? Number(item.cost)
                              : undefined
                          const costPerPax = Number.isFinite(
                            Number(item.estimatedCostPerPax),
                          )
                            ? Number(item.estimatedCostPerPax)
                            : estimatedCost !== undefined && item.portion > 0
                              ? estimatedCost / item.portion
                              : 0
                          return total + costPerPax
                        },
                        0,
                      )
                      const firstMenu = group.items[0]
                      const sellingPricePerPax = Number.isFinite(
                        Number(firstMenu?.sellingPricePerPax),
                      )
                        ? Number(firstMenu?.sellingPricePerPax)
                        : undefined
                      const sellingQuantity = Number.isFinite(
                        Number(firstMenu?.sellingQuantity),
                      )
                        ? Number(firstMenu?.sellingQuantity)
                        : undefined
                      const estimatedRevenue =
                        sellingPricePerPax !== undefined &&
                        sellingQuantity !== undefined
                          ? sellingPricePerPax * sellingQuantity
                          : undefined
                      const foodCostPercentage = calculateFoodCostPercentage(
                        totalEstimatedCost,
                        estimatedRevenue,
                      )
                      const portionSummary = summarizePortionsByGroup(
                        group.items,
                      )

                      return (
                        <Fragment key={groupKey}>
                          <tr className="border-t border-border">
                            <td className="px-4 py-3 text-sm text-muted">
                              {(menuGroupPage - 1) * MENU_GROUP_ITEMS_PER_PAGE +
                                index +
                                1}
                            </td>
                            <td className="px-4 py-3 text-sm text-muted">
                              {formatCreatedDate(getGroupSubmittedAt(group))}
                            </td>
                            <td className="px-4 py-3">{group.date}</td>
                            <td className="px-4 py-3 text-xs text-muted">
                              {group.productionCode ?? '-'}
                            </td>
                            <td className="px-4 py-3">
                              {group.items[0]?.clientName ?? '-'}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-nowrap items-center gap-1.5">
                                <span className="whitespace-nowrap rounded-full bg-primary-soft px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                                  {getApprovalStatusLabel('pending')}
                                </span>
                                <span className="whitespace-nowrap text-[11px] text-muted">
                                  {pendingMenuCount} of {group.items.length} menus
                                  pending
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-nowrap items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => toggleExpandedDate(groupKey)}
                                  className="whitespace-nowrap rounded-md border border-primary bg-primary-soft px-2.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary-soft/80"
                                >
                                  {isExpanded ? 'Hide details' : 'View details'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleExportMenuProductionGroup(group)
                                  }
                                  className="whitespace-nowrap rounded-md border border-success bg-white px-2.5 py-1.5 text-xs font-semibold text-success shadow-sm hover:bg-success/10"
                                >
                                  <span className="flex items-center gap-1.5">
                                    <i
                                      className="bi bi-download text-sm"
                                      aria-hidden="true"
                                    />
                                    <span>Export</span>
                                  </span>
                                </button>
                              </div>
                            </td>
                          </tr>
                          {isExpanded ? (
                            <tr className="border-t border-border bg-background">
                              <td colSpan={7} className="px-4 py-4">
                                <div className="space-y-4">
                                  <section className="border-b border-border pb-4">
                                    <h3 className="text-sm font-semibold text-foreground">
                                      Production information
                                    </h3>
                                    <dl className="mt-3 space-y-2 text-sm">
                                      <div className="flex gap-2">
                                        <dt className="w-16 font-medium text-muted">
                                          Chef
                                        </dt>
                                        <dd className="font-semibold text-foreground">
                                          : {submittedByLabel}
                                        </dd>
                                      </div>
                                      <div className="flex gap-2">
                                        <dt className="w-16 font-medium text-muted">
                                          Admin
                                        </dt>
                                        <dd className="font-semibold text-foreground">
                                          : {salesInputByLabel}
                                        </dd>
                                      </div>
                                    </dl>
                                  </section>

                                  <section>
                                    <h3 className="text-sm font-semibold text-foreground">
                                      Menu list
                                    </h3>
                                    <div className="mt-3 overflow-hidden rounded-md border border-border bg-white">
                                      <table className="dm-table !w-full !table-fixed text-sm [&_td]:!whitespace-normal [&_th]:!whitespace-normal">
                                        <colgroup>
                                          <col className="w-[5%]" />
                                          <col className="w-[10%]" />
                                          <col className="w-[20%]" />
                                          <col className="w-[8%]" />
                                          <col className="w-[12%]" />
                                          <col className="w-[10%]" />
                                          <col className="w-[10%]" />
                                          <col className="w-[12%]" />
                                          <col className="w-[13%]" />
                                        </colgroup>
                                        <thead className="bg-background">
                                          <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                                            <th className="px-3 py-3 font-semibold">
                                              No
                                            </th>
                                            <th className="px-3 py-3 font-semibold">
                                              Group By
                                            </th>
                                            <th className="px-3 py-3 font-semibold">
                                              Menu
                                            </th>
                                            <th className="px-3 py-3 font-semibold">
                                              Portion
                                            </th>
                                            <th className="px-3 py-3 font-semibold">
                                              Estimated Cost
                                            </th>
                                            <th className="px-3 py-3 font-semibold">
                                              Food Cost %
                                            </th>
                                            <th className="px-3 py-3 font-semibold">
                                              Cost/Pax
                                            </th>
                                            <th className="px-3 py-3 font-semibold">
                                              Approval Status
                                            </th>
                                            <th className="px-3 py-3 font-semibold">
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
                                                Number.isFinite(
                                                  Number(item.estimatedCostPerPax),
                                                )
                                                  ? Number(
                                                      item.estimatedCostPerPax,
                                                    )
                                                  : estimatedCost !== undefined &&
                                                      item.portion > 0
                                                    ? estimatedCost / item.portion
                                                    : undefined
                                              return (
                                                <tr
                                                  key={item.id}
                                                  className="border-t border-border"
                                                >
                                                  <td className="px-3 py-3 text-sm text-muted">
                                                    {itemIndex + 1}
                                                  </td>
                                                  <td className="px-3 py-3">
                                                    {item.group ?? '-'}
                                                  </td>
                                                  <td className="px-3 py-3">
                                                    <p
                                                      className="truncate !whitespace-nowrap font-semibold text-foreground"
                                                      title={item.menuName}
                                                    >
                                                      {item.menuName}
                                                    </p>
                                                    <p className="mt-1 truncate !whitespace-nowrap text-xs text-muted">
                                                      {item.recipeCode ?? '-'} ·{' '}
                                                      {item.category}
                                                    </p>
                                                  </td>
                                                  <td className="px-3 py-3">
                                                    {item.portion}
                                                  </td>
                                                  <td className="px-3 py-3 font-medium">
                                                    {formatPrice(estimatedCost)}
                                                  </td>
                                                  <td className="px-3 py-3 font-medium">
                                                    {formatFoodCostPercentage(
                                                      estimatedCost,
                                                      estimatedRevenue,
                                                    )}
                                                  </td>
                                                  <td className="px-3 py-3 font-medium">
                                                    {formatPrice(
                                                      estimatedCostPerPax,
                                                    )}
                                                  </td>
                                                  <td className="px-3 py-3">
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
                                                  <td className="px-3 py-3">
                                                    {item.approvalStatus ===
                                                    'pending' ? (
                                                      <div className="flex flex-nowrap items-center gap-1.5">
                                                        <button
                                                          type="button"
                                                          onClick={() =>
                                                            handleMenuApproval(
                                                              item,
                                                            )
                                                          }
                                                          className="whitespace-nowrap rounded-md bg-primary px-2.5 py-1.5 text-xs font-semibold text-white"
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
                                                          className="whitespace-nowrap rounded-md border border-danger bg-white px-2.5 py-1.5 text-xs font-semibold text-danger hover:bg-danger/10"
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
                                        <tfoot className="bg-[#ccd9ec]">
                                          <tr className="border-t-2 border-primary">
                                            <td
                                              colSpan={4}
                                              className="px-3 py-3 text-center text-xs font-bold uppercase tracking-[0.12em]"
                                            >
                                              Total
                                            </td>
                                            <td className="px-3 py-3 font-bold">
                                              {formatPrice(totalEstimatedCost)}
                                            </td>
                                            <td className="px-3 py-3 font-bold">
                                              {foodCostPercentage === undefined
                                                ? '-'
                                                : `${foodCostPercentage.toFixed(2)}%`}
                                            </td>
                                            <td className="px-3 py-3 font-bold">
                                              {formatPrice(
                                                totalEstimatedCostPerPax,
                                              )}
                                            </td>
                                            <td colSpan={2} />
                                          </tr>
                                          {portionSummary.groups.map((item) => (
                                            <tr
                                              key={`group-portion-${item.name}`}
                                              className="border-t border-border"
                                            >
                                              <td
                                                colSpan={4}
                                                className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-[0.12em]"
                                              >
                                                {item.name} Qty
                                              </td>
                                              <td
                                                colSpan={5}
                                                className="px-3 py-3 font-semibold"
                                              >
                                                {formatQuantity(item.portion)}
                                              </td>
                                            </tr>
                                          ))}
                                          <tr className="border-t border-border">
                                            <td
                                              colSpan={4}
                                              className="px-3 py-3 text-center text-xs font-bold uppercase tracking-[0.12em]"
                                            >
                                              Total Qty
                                            </td>
                                            <td colSpan={5} className="px-3 py-3 font-bold">
                                              {formatQuantity(portionSummary.total)}
                                            </td>
                                          </tr>
                                          <tr className="border-t border-border">
                                            <td
                                              colSpan={4}
                                              className="px-3 py-3 text-center text-xs font-bold uppercase tracking-[0.12em]"
                                            >
                                              Selling Price/Pax
                                            </td>
                                            <td colSpan={5} className="px-3 py-3 font-bold">
                                              {formatPrice(sellingPricePerPax)}
                                            </td>
                                          </tr>
                                          <tr className="border-t border-border">
                                            <td
                                              colSpan={4}
                                              className="px-3 py-3 text-center text-xs font-bold uppercase tracking-[0.12em]"
                                            >
                                              Pax Calculation
                                            </td>
                                            <td colSpan={5} className="px-3 py-3 font-bold">
                                              {sellingQuantity ?? '-'}
                                            </td>
                                          </tr>
                                          <tr className="border-t border-border">
                                            <td
                                              colSpan={4}
                                              className="px-3 py-3 text-center text-xs font-bold uppercase tracking-[0.12em]"
                                            >
                                              Estimated Revenue
                                            </td>
                                            <td colSpan={5} className="px-3 py-3 font-bold">
                                              {formatPrice(estimatedRevenue)}
                                            </td>
                                          </tr>
                                          <tr className="border-t border-border">
                                            <td
                                              colSpan={4}
                                              className="px-3 py-3 text-center text-xs font-bold uppercase tracking-[0.12em]"
                                            >
                                              Food Cost Percentage
                                            </td>
                                            <td colSpan={5} className="px-3 py-3 font-bold">
                                              {foodCostPercentage === undefined
                                                ? '-'
                                                : `${foodCostPercentage.toFixed(2)}%`}
                                            </td>
                                          </tr>
                                        </tfoot>
                                      </table>
                                    </div>
                                    {group.missingRecipes.length > 0 ? (
                                      <p className="mt-3 text-xs text-danger">
                                        Recipe not found for:{' '}
                                        {group.missingRecipes.join(', ')}
                                      </p>
                                    ) : null}
                                  </section>

                                  <section>
                                    <h3 className="text-sm font-semibold text-foreground">
                                      Ingredient requirements per menu
                                    </h3>
                                    <div className="mt-3 space-y-3">
                                      {group.items.map((item) => (
                                        <article key={`ingredients-${item.id}`}>
                                          <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                                            <div>
                                              <p className="font-semibold text-foreground">
                                                {item.menuName}
                                              </p>
                                              <p className="mt-1 text-xs text-muted">
                                                {item.recipeCode ?? '-'} ·{' '}
                                                {item.category} · {item.portion} pax
                                              </p>
                                            </div>
                                            <span className="rounded-full bg-primary-soft px-2 py-1 text-xs font-semibold text-primary">
                                              {item.ingredients.length} ingredients
                                            </span>
                                          </div>
                                          <div className="overflow-hidden rounded-md border border-border bg-white">
                                            <table className="dm-table !w-full !table-fixed text-sm [&_td]:!whitespace-normal [&_th]:!whitespace-normal">
                                              <colgroup>
                                                <col className="w-[5%]" />
                                                <col className="w-[13%]" />
                                                <col className="w-[39%]" />
                                                <col className="w-[8%]" />
                                                <col className="w-[8%]" />
                                                <col className="w-[27%]" />
                                              </colgroup>
                                              <thead className="bg-background">
                                              <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                                                <th className="px-3 py-3 font-semibold">No</th>
                                                <th className="px-3 py-3 font-semibold">
                                                  Product code
                                                </th>
                                                <th className="px-3 py-3 font-semibold">
                                                  Ingredient name
                                                </th>
                                                <th className="px-3 py-3 font-semibold">Qty</th>
                                                <th className="px-3 py-3 font-semibold">Unit</th>
                                                <th className="px-3 py-3 font-semibold">
                                                  Vendor
                                                </th>
                                              </tr>
                                              </thead>
                                              <tbody>
                                              {item.ingredients.length === 0 ? (
                                                <tr className="border-t border-border">
                                                  <td
                                                    colSpan={6}
                                                    className="px-4 py-5 text-center text-muted"
                                                  >
                                                    No ingredients available.
                                                  </td>
                                                </tr>
                                              ) : (
                                                item.ingredients.map(
                                                  (ingredient, ingredientIndex) => (
                                                    <tr
                                                      key={`${item.id}-${ingredient.productCode}-${ingredientIndex}`}
                                                      className="border-t border-border"
                                                    >
                                                      <td className="px-3 py-3 text-muted">
                                                        {ingredientIndex + 1}
                                                      </td>
                                                      <td className="break-all px-3 py-3">
                                                        {ingredient.productCode || '-'}
                                                      </td>
                                                      <td className="break-words px-3 py-3 font-medium">
                                                        {ingredient.name || '-'}
                                                      </td>
                                                      <td className="px-3 py-3">
                                                        {formatQuantity(ingredient.qty)}
                                                      </td>
                                                      <td className="break-words px-3 py-3">
                                                        {formatUnitLabel(
                                                          ingredient.unitOfMeasures,
                                                        )}
                                                      </td>
                                                      <td className="break-words px-3 py-3">
                                                        {ingredient.vendor ?? '-'}
                                                      </td>
                                                    </tr>
                                                  ),
                                                )
                                              )}
                                              </tbody>
                                            </table>
                                          </div>
                                        </article>
                                      ))}
                                    </div>
                                  </section>

                                  <section>
                                    <h3 className="text-sm font-semibold text-foreground">
                                      Ingredient summary
                                    </h3>
                                    <div className="mt-3 overflow-hidden rounded-md border border-border bg-white">
                                      <table className="dm-table !w-full !table-fixed text-sm [&_td]:!whitespace-normal [&_th]:!whitespace-normal">
                                        <colgroup>
                                          <col className="w-[5%]" />
                                          <col className="w-[12%]" />
                                          <col className="w-[30%]" />
                                          <col className="w-[7%]" />
                                          <col className="w-[7%]" />
                                          <col className="w-[18%]" />
                                          <col className="w-[10%]" />
                                          <col className="w-[11%]" />
                                        </colgroup>
                                        <thead className="bg-background">
                                          <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                                            <th className="px-3 py-3 font-semibold">No</th>
                                            <th className="px-3 py-3 font-semibold">
                                              Product code
                                            </th>
                                            <th className="px-3 py-3 font-semibold">
                                              Ingredient name
                                            </th>
                                            <th className="px-3 py-3 font-semibold">Qty</th>
                                            <th className="px-3 py-3 font-semibold">Unit</th>
                                            <th className="px-3 py-3 font-semibold">
                                              Vendor
                                            </th>
                                            <th className="px-3 py-3 font-semibold">Price</th>
                                            <th className="px-3 py-3 font-semibold">
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
                                                No ingredients available to calculate.
                                              </td>
                                            </tr>
                                          ) : (
                                            summaryItems.map((item, itemIndex) => (
                                              <tr
                                                key={`${item.productCode}-${item.unitOfMeasures}-${itemIndex}`}
                                                className="border-t border-border"
                                              >
                                                <td className="px-3 py-3 text-muted">
                                                  {itemIndex + 1}
                                                </td>
                                                <td className="break-all px-3 py-3">
                                                  {item.productCode}
                                                </td>
                                                <td className="break-words px-3 py-3 font-medium">
                                                  {item.name}
                                                </td>
                                                <td className="px-3 py-3">
                                                  {formatQuantity(item.qty)}
                                                </td>
                                                <td className="break-words px-3 py-3">
                                                  {formatUnitLabel(item.unitOfMeasures)}
                                                </td>
                                                <td className="break-words px-3 py-3">
                                                  {item.vendor ?? '-'}
                                                </td>
                                                <td className="break-words px-3 py-3 font-medium">
                                                  {formatPrice(item.price)}
                                                </td>
                                                <td className="break-words px-3 py-3 font-medium">
                                                  {formatPrice(item.ingredientCost)}
                                                </td>
                                              </tr>
                                            ))
                                          )}
                                        </tbody>
                                      </table>
                                    </div>
                                  </section>
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
