import { Fragment, useCallback, useEffect, useState } from 'react'
import TablePagination from '../components/TablePagination'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'
import { formatQuantity } from '../lib/quantity'
import { formatRecipeVersion } from '../lib/recipe-version'
import { aggregateStoreRequestSummary } from '../lib/store-request-summary'
import {
  getApprovalStatusLabel,
  getStoreRequestStatusLabel,
} from '../lib/status-labels'
import { formatUnitLabel } from '../lib/unit-of-measures'
import ChefCreateMenu, { type BaseRecipe } from './ChefCreateMenu'

type ApprovalStatus = 'pending' | 'approved' | 'rejected'
type ApprovalSection = 'recipes' | 'menu-productions'
type OverrideAction =
  | { kind: 'recipe'; recipe: Recipe; nextStatus: ApprovalStatus }
  | { kind: 'menu'; group: StoreRequestGroup; nextStatus: ApprovalStatus }

type SiteApi = {
  id?: string
  _id?: string
  name?: string
  code?: string
}

type SiteOption = {
  code: string
  name: string
}

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
  site?: string
  description?: string
  imageUrl?: string
  portionSize?: number
  ingredients?: RecipeIngredient[]
  createdBy?: string
  createdByName?: string
  createdByEmail?: string
  approvalHistory?: Array<{
    rejectionReason: string
    resubmissionFeedback?: string
  }>
  status: 'draft' | 'active'
  isActive?: boolean
  approvalStatus: ApprovalStatus
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
  productionDate: string
  approvalStatus: ApprovalStatus
  storeRequestStatus: 'not-requested' | 'requested' | 'fulfilled' | 'cancelled'
  portionSize: number
  ingredients: StoreRequestIngredient[]
  missingRecipe: boolean
  reviewedBy?: string
  salesInputBy?: string
}

type StoreRequestGroup = {
  date: string
  productionCode?: string
  items: StoreRequestMenu[]
  summary: StoreRequestIngredient[]
  missingRecipes: string[]
}

const ITEMS_PER_PAGE = 10

const sections: Array<{ id: ApprovalSection; label: string; icon: string }> = [
  { id: 'recipes', label: 'Recipe Approval', icon: 'bi-journal-check' },
  {
    id: 'menu-productions',
    label: 'Menu Production Approval',
    icon: 'bi-clipboard2-check',
  },
]

const isApprovalSection = (value: string | null): value is ApprovalSection =>
  sections.some((section) => section.id === value)

const mapSite = (item: SiteApi): SiteOption => ({
  code: item.code ?? '',
  name: item.name ?? '',
})

const getSequentialSiteCodeNumber = (code: string) => {
  const match = /^S(\d+)$/i.exec(code.trim())
  return match ? Number(match[1]) : undefined
}

const compareSiteOptionsByCode = (a: SiteOption, b: SiteOption) => {
  const aNumber = getSequentialSiteCodeNumber(a.code)
  const bNumber = getSequentialSiteCodeNumber(b.code)

  if (aNumber !== undefined && bNumber !== undefined) {
    return aNumber - bNumber
  }

  return a.code.localeCompare(b.code, undefined, {
    numeric: true,
    sensitivity: 'base',
  })
}

const approvalStatusClass = (status: ApprovalStatus) => {
  if (status === 'approved') return 'text-primary'
  if (status === 'rejected') return 'text-danger'
  return 'text-muted'
}

const getRecipeKey = (recipe: Recipe) =>
  recipe.id ?? recipe._id ?? recipe.recipeCode ?? recipe.name

const getGroupKey = (group: StoreRequestGroup) =>
  `${group.date}__${group.productionCode ?? 'no-code'}`

const getSubmittedByLabel = (items: StoreRequestMenu[]) => {
  const names = Array.from(
    new Set(
      items
        .map((item) => item.submittedByName?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  )
  return names.length ? names.join(', ') : '-'
}

const SuperadminApprovalCentersPage = ({ corporateOnly = false }: { corporateOnly?: boolean }) => {
  const { accessToken, user, updateUser } = useAuth()
  const [searchParams] = useSearchParams()
  const sectionParam = searchParams.get('section')
  const [siteOptions, setSiteOptions] = useState<SiteOption[]>([])
  const [selectedSite, setSelectedSite] = useState('')
  const [activeSection, setActiveSection] = useState<ApprovalSection>(() =>
    isApprovalSection(sectionParam) ? sectionParam : 'recipes',
  )
  const [approvalFilter, setApprovalFilter] = useState<'' | ApprovalStatus>(
    corporateOnly ? 'pending' : '',
  )
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [menuGroups, setMenuGroups] = useState<StoreRequestGroup[]>([])
  const [expandedRecipes, setExpandedRecipes] = useState<string[]>([])
  const [expandedGroups, setExpandedGroups] = useState<string[]>([])
  const [recipePage, setRecipePage] = useState(1)
  const [menuPage, setMenuPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [processingKey, setProcessingKey] = useState<string | null>(null)
  const [overrideAction, setOverrideAction] = useState<OverrideAction | null>(null)
  const [overrideReason, setOverrideReason] = useState('')
  const [overrideError, setOverrideError] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [editingRecipe, setEditingRecipe] = useState<BaseRecipe | null>(null)

  const openCorporateRecipeEdit = (recipe: Recipe) => {
    const recipeId = recipe.id ?? recipe._id
    if (!corporateOnly || recipe.approvalStatus !== 'pending' || !recipeId) return

    setEditingRecipe({
      id: recipeId,
      recipeCode: recipe.recipeCode,
      version: recipe.version,
      name: recipe.name,
      category: recipe.category,
      description: recipe.description ?? '',
      portionSize: recipe.portionSize ?? 1,
      site: recipe.site,
      approvalStatus: recipe.approvalStatus,
      ingredients: (recipe.ingredients ?? []).map((ingredient) => ({
        ...ingredient,
        productCode: ingredient.productCode ?? '',
        name: ingredient.name ?? '',
        unitOfMeasures: ingredient.unitOfMeasures ?? '',
        qty: Number(ingredient.qty) || 0,
      })),
    })
  }

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

  const fetchSites = useCallback(async () => {
    if (!accessToken) {
      setSiteOptions([])
      return
    }

    if (corporateOnly) {
      const assigned = Array.from(
        new Set([...(user?.site ? [user.site] : []), ...(user?.sites ?? [])]),
      ).map((code) => ({
        code,
        name: user?.siteOptions?.find((site) => site.code === code)?.name ?? code,
      }))
      setSiteOptions(assigned)
      setSelectedSite((current) => current || assigned[0]?.code || '')
      return
    }

    try {
      const data = await apiFetch<{ items?: SiteApi[] }>(
        '/superadmin/sites?limit=200',
        undefined,
        accessToken,
      )
      setSiteOptions(
        (data.items ?? [])
          .map(mapSite)
          .filter((site) => site.code)
          .sort(compareSiteOptionsByCode),
      )
    } catch {
      setSiteOptions([])
    }
  }, [accessToken, corporateOnly, user?.site, user?.siteOptions, user?.sites])

  const fetchApprovals = useCallback(async () => {
    if (!accessToken) {
      setError('Please log in first to load approval data.')
      return
    }
    if (!selectedSite) {
      setRecipes([])
      setMenuGroups([])
      setError('')
      return
    }

    setLoading(true)
    setError('')
    try {
      const recipeParams = new URLSearchParams()
      recipeParams.set('site', selectedSite)
      recipeParams.set('strictSite', 'true')
      recipeParams.set('limit', '100')
      if (approvalFilter) recipeParams.set('approvalStatus', approvalFilter)

      const menuParams = new URLSearchParams()
      menuParams.set('site', selectedSite)
      if (approvalFilter) menuParams.set('approvalStatus', approvalFilter)

      const recipesData = await apiFetch<{ items?: Recipe[] }>(
        `/recipes?${recipeParams.toString()}`,
        undefined,
        accessToken,
      )
      const menusData = corporateOnly
        ? { items: [] as StoreRequestGroup[] }
        : await apiFetch<{ items?: StoreRequestGroup[] }>(
            `/menu-productions/store-requests?${menuParams.toString()}`,
            undefined,
            accessToken,
          )

      setRecipes(recipesData.items ?? [])
      setMenuGroups(
        [...(menusData.items ?? [])].sort((a, b) => {
          const byDate = b.date.localeCompare(a.date)
          if (byDate !== 0) return byDate
          return (b.productionCode ?? '').localeCompare(a.productionCode ?? '')
        }),
      )
    } catch (caught) {
      const nextError =
        caught instanceof Error ? caught.message : 'Failed to load approval data.'
      setRecipes([])
      setMenuGroups([])
      setError(nextError)
    } finally {
      setLoading(false)
    }
  }, [accessToken, approvalFilter, corporateOnly, selectedSite])

  useEffect(() => {
    fetchSites().catch(() => null)
  }, [fetchSites])

  useEffect(() => {
    fetchApprovals().catch(() => null)
  }, [fetchApprovals])

  useEffect(() => {
    const nextSection = corporateOnly
      ? 'recipes'
      : isApprovalSection(sectionParam)
        ? sectionParam
        : 'recipes'
    setActiveSection((current) =>
      current === nextSection ? current : nextSection,
    )
  }, [corporateOnly, sectionParam])

  useEffect(() => {
    setRecipePage(1)
    setMenuPage(1)
    setExpandedRecipes([])
    setExpandedGroups([])
    setOverrideAction(null)
    setOverrideReason('')
    setOverrideError('')
    setMessage('')
    setError('')
  }, [selectedSite, approvalFilter])

  const recipeTotalPages = Math.max(1, Math.ceil(recipes.length / ITEMS_PER_PAGE))
  const menuTotalPages = Math.max(1, Math.ceil(menuGroups.length / ITEMS_PER_PAGE))
  const paginatedRecipes = recipes.slice(
    (recipePage - 1) * ITEMS_PER_PAGE,
    recipePage * ITEMS_PER_PAGE,
  )
  const paginatedMenuGroups = menuGroups.slice(
    (menuPage - 1) * ITEMS_PER_PAGE,
    menuPage * ITEMS_PER_PAGE,
  )

  const toggleRecipe = (recipeKey: string) => {
    setExpandedRecipes((prev) =>
      prev.includes(recipeKey)
        ? prev.filter((item) => item !== recipeKey)
        : [...prev, recipeKey],
    )
  }

  const toggleGroup = (groupKey: string) => {
    setExpandedGroups((prev) =>
      prev.includes(groupKey)
        ? prev.filter((item) => item !== groupKey)
        : [...prev, groupKey],
    )
  }

  const openOverrideAction = (action: OverrideAction) => {
    setOverrideAction(action)
    setOverrideReason('')
    setOverrideError('')
    setMessage('')
    setError('')
  }

  const closeOverrideAction = () => {
    if (processingKey) return
    setOverrideAction(null)
    setOverrideReason('')
    setOverrideError('')
  }

  const getOverrideActionLabel = (action: OverrideAction) => {
    if (action.kind === 'recipe') return action.recipe.name
    return action.group.productionCode
      ? `${action.group.date} (${action.group.productionCode})`
      : action.group.date
  }

  const updateRecipeApproval = async ({
    recipe,
    nextStatus,
    reason,
  }: {
    recipe: Recipe
    nextStatus: ApprovalStatus
    reason?: string
  }) => {
    if (!accessToken) return
    const recipeId = recipe.id ?? recipe._id
    if (!recipeId || recipe.approvalStatus === nextStatus) return

    const action = nextStatus === 'approved' ? 'approve' : 'reject'
    const normalizedReason = reason?.trim()

    const recipeKey = getRecipeKey(recipe)
    setProcessingKey(recipeKey)
    setError('')
    setMessage('')
    try {
      await apiFetch(
        `/recipes/${recipeId}/${nextStatus === 'approved' ? 'approve' : 'reject'}`,
        {
          method: 'PATCH',
          ...(nextStatus === 'rejected'
            ? { body: JSON.stringify({ reason: normalizedReason }) }
            : {}),
        },
        accessToken,
      )
      setMessage(`${recipe.name} set to ${nextStatus}.`)
      await fetchApprovals()
      setOverrideAction(null)
      setOverrideReason('')
    } catch (caught) {
      setOverrideError(
        caught instanceof Error
          ? caught.message
          : `Failed to ${action} recipe.`,
      )
    } finally {
      setProcessingKey(null)
    }
  }

  const updateMenuApproval = async ({
    group,
    nextStatus,
  }: {
    group: StoreRequestGroup
    nextStatus: ApprovalStatus
  }) => {
    if (!accessToken) return
    const targetItems = group.items.filter(
      (item) => item.approvalStatus !== nextStatus,
    )
    if (targetItems.length === 0) return

    const action = nextStatus === 'approved' ? 'approve' : 'reject'
    const label = group.productionCode
      ? `${group.date} (${group.productionCode})`
      : group.date

    const groupKey = getGroupKey(group)
    setProcessingKey(groupKey)
    setError('')
    setMessage('')
    try {
      const requests = targetItems.map((item) =>
        apiFetch(
          `/menu-productions/${item.id}/${nextStatus === 'approved' ? 'approve' : 'reject'}`,
          { method: 'PATCH' },
          accessToken,
        ),
      )
      const results = await Promise.allSettled(requests)
      const successCount = results.filter((result) => result.status === 'fulfilled')
        .length
      const failedCount = results.length - successCount

      if (successCount > 0) {
        setMessage(`${successCount} menu(s) in ${label} set to ${nextStatus}.`)
      }
      if (failedCount > 0) {
        setOverrideError(`${failedCount} menu(s) failed to force ${action}.`)
        return
      }
      await fetchApprovals()
      setOverrideAction(null)
    } catch (caught) {
      setOverrideError(
        caught instanceof Error
          ? caught.message
          : `Failed to force ${action} menu production.`,
      )
    } finally {
      setProcessingKey(null)
    }
  }

  const handleConfirmOverride = async () => {
    if (!overrideAction) return

    if (
      overrideAction.kind === 'recipe' &&
      overrideAction.nextStatus === 'rejected' &&
      !overrideReason.trim()
    ) {
      setOverrideError('Rejection reason is required.')
      return
    }

    setOverrideError('')
    if (overrideAction.kind === 'recipe') {
      await updateRecipeApproval({
        recipe: overrideAction.recipe,
        nextStatus: overrideAction.nextStatus,
        reason: overrideReason,
      })
      return
    }

    await updateMenuApproval({
      group: overrideAction.group,
      nextStatus: overrideAction.nextStatus,
    })
  }

  return (
    <div className="space-y-6">
      {editingRecipe ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4">
          <div className="mx-auto min-h-full max-w-6xl rounded-md border border-border bg-background p-4 shadow-xl sm:p-6">
            <ChefCreateMenu
              embedded
              baseRecipe={editingRecipe}
              enableIngredientUomConversion
              lockSrUomToRawMaterial
              showImport={false}
              onClose={() => setEditingRecipe(null)}
              onSaved={() => {
                setEditingRecipe(null)
                setError('')
                setMessage(
                  'Recipe updated and automatically approved. It is now available in Recipe Data.',
                )
                fetchApprovals().catch(() => null)
              }}
            />
          </div>
        </div>
      ) : null}
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Approval Centers</h1>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full max-w-xs">
            <label className="text-xs font-medium text-muted">Site</label>
            <select
              value={selectedSite}
              onChange={(event) => setSelectedSite(event.target.value)}
              className="mt-2 h-10 w-full rounded-xl border border-border bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
            >
              <option value="">Select site</option>
              {siteOptions.map((site) => (
                <option key={site.code} value={site.code}>
                  {site.name || site.code}
                </option>
              ))}
            </select>
          </div>
          <div className="w-full max-w-xs">
            <label className="text-xs font-medium text-muted">
              Approval status
            </label>
            <select
              value={approvalFilter}
              onChange={(event) =>
                setApprovalFilter(event.target.value as '' | ApprovalStatus)
              }
              className="mt-2 h-10 w-full rounded-xl border border-border bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
            >
              <option value="">{corporateOnly ? 'All status' : 'All status'}</option>
              <option value="pending">Submitted</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <button
            type="button"
            onClick={() => fetchApprovals().catch(() => null)}
            disabled={loading || !selectedSite}
            className="rounded-md border border-primary/40 bg-primary-soft px-4 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            Refresh
          </button>
        </div>
        {error ? <p className="text-xs font-medium text-red-600">{error}</p> : null}
        {message ? (
          <p className="text-xs font-medium text-primary">{message}</p>
        ) : null}
      </div>

      {activeSection === 'recipes' ? (
        <section className="rounded-md border border-border bg-surface shadow-sm">
          <TablePagination
            page={recipePage}
            totalPages={recipeTotalPages}
            loading={loading}
            onPageChange={setRecipePage}
            summary={`Showing ${paginatedRecipes.length} of ${recipes.length} recipes`}
            className="border-b border-border bg-white px-5 py-4"
          />
          <div className="max-w-full overflow-x-auto">
            <table className="dm-table min-w-full text-sm">
              <thead className="bg-background">
                <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                  <th className="w-16 px-5 py-4 font-semibold">No</th>
                  <th className="px-5 py-4 font-semibold">Recipe ID</th>
                  <th className="px-5 py-4 font-semibold">Name</th>
                  <th className="px-5 py-4 font-semibold">Version</th>
                  <th className="px-5 py-4 font-semibold">Category</th>
                  <th className="px-5 py-4 font-semibold">Recipe status</th>
                  <th className="px-5 py-4 font-semibold">Approval status</th>
                  <th className="px-5 py-4 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr className="border-t border-border">
                    <td colSpan={8} className="px-5 py-10 text-center text-muted">
                      Loading approval data...
                    </td>
                  </tr>
                ) : recipes.length === 0 ? (
                  <tr className="border-t border-border">
                    <td colSpan={8} className="px-5 py-10 text-center text-muted">
                      {selectedSite ? 'No recipes found.' : 'Select a site first.'}
                    </td>
                  </tr>
                ) : (
                  paginatedRecipes.map((recipe, index) => {
                    const recipeKey = getRecipeKey(recipe)
                    const isExpanded = expandedRecipes.includes(recipeKey)
                    const ingredients = recipe.ingredients ?? []
                    const canReviewRecipe = corporateOnly
                      ? recipe.approvalStatus === 'pending'
                      : true
                    return (
                      <Fragment key={recipeKey}>
                        <tr className="border-t border-border">
                          <td className="px-5 py-4 text-sm text-muted">
                            {(recipePage - 1) * ITEMS_PER_PAGE + index + 1}
                          </td>
                          <td className="px-5 py-4 font-medium">
                            {recipe.recipeCode ?? '-'}
                          </td>
                          <td className="px-5 py-4">{recipe.name}</td>
                          <td className="px-5 py-4 font-semibold text-foreground">
                            {formatRecipeVersion(recipe.version)}
                          </td>
                          <td className="px-5 py-4">{recipe.category || '-'}</td>
                          <td className="px-5 py-4">
                            {recipe.isActive === false
                              ? 'Disabled'
                              : recipe.status === 'active'
                                ? 'Active'
                                : 'Draft'}
                          </td>
                          <td className="px-5 py-4">
                            <span
                              className={`font-medium ${approvalStatusClass(
                                recipe.approvalStatus,
                              )}`}
                            >
                              {getApprovalStatusLabel(recipe.approvalStatus)}
                            </span>
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => toggleRecipe(recipeKey)}
                                className="rounded-md border border-primary bg-background px-3 py-1 text-xs font-semibold text-primary hover:bg-primary-soft/80"
                              >
                                {isExpanded ? 'Hide details' : 'View details'}
                              </button>
                              {corporateOnly && recipe.approvalStatus === 'pending' ? (
                                <button
                                  type="button"
                                  onClick={() => openCorporateRecipeEdit(recipe)}
                                  disabled={processingKey === recipeKey}
                                  className="rounded-md border border-primary bg-white px-3 py-2 text-xs font-semibold text-primary disabled:opacity-60"
                                >
                                  Edit recipe
                                </button>
                              ) : null}
                              {canReviewRecipe && recipe.approvalStatus !== 'approved' ? (
                              <button
                                type="button"
                                onClick={() =>
                                    corporateOnly
                                      ? void updateRecipeApproval({
                                          recipe,
                                          nextStatus: 'approved',
                                        })
                                      : openOverrideAction({
                                          kind: 'recipe',
                                          recipe,
                                          nextStatus: 'approved',
                                        })
                                  }
                                  disabled={processingKey === recipeKey}
                                  className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                                >
                                  Approve
                                </button>
                              ) : null}
                              {canReviewRecipe && recipe.approvalStatus !== 'rejected' ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    openOverrideAction({
                                      kind: 'recipe',
                                      recipe,
                                      nextStatus: 'rejected',
                                    })
                                  }
                                  disabled={processingKey === recipeKey}
                                  className="rounded-md border border-danger bg-white px-3 py-2 text-xs font-semibold text-danger disabled:opacity-60"
                                >
                                  Reject
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                        {isExpanded ? (
                          <tr className="border-t border-border bg-background">
                            <td colSpan={8} className="px-5 py-5">
                              <div className="grid gap-4 lg:grid-cols-12">
                                <div className="rounded-md border border-border bg-surface p-4 lg:col-span-4">
                                  <p className="text-xs text-muted">Recipe details</p>
                                  <div className="mt-3 h-40 overflow-hidden rounded-md border border-border bg-background">
                                    {recipe.imageUrl ? (
                                      <img src={recipe.imageUrl} alt={`${recipe.name} photo`} className="h-full w-full object-cover" />
                                    ) : (
                                      <div className="flex h-full items-center justify-center text-xs text-muted">No photo</div>
                                    )}
                                  </div>
                                  <p className="mt-3 text-xs text-muted">Description</p>
                                  <p className="mt-1 text-sm text-foreground">
                                    {recipe.description?.trim() || 'No description.'}
                                  </p>
                                  <p className="mt-3 text-xs text-muted">
                                    Submitted by
                                  </p>
                                  <p className="mt-1 text-sm font-medium">
                                    {recipe.createdByName?.trim() ||
                                      recipe.createdByEmail?.trim() ||
                                      recipe.createdBy?.trim() ||
                                      '-'}
                                  </p>
                                  {recipe.approvalHistory?.length ? (
                                    <div className="mt-4 border-t border-border pt-4">
                                      <p className="text-xs font-semibold text-foreground">Approval history</p>
                                      <div className="mt-2 space-y-2">
                                        {recipe.approvalHistory.map((entry, historyIndex) => (
                                          <div key={historyIndex} className="rounded-md border border-border bg-background p-3 text-xs">
                                            <p className="font-semibold text-danger">Rejection {historyIndex + 1}</p>
                                            <p className="mt-1">{entry.rejectionReason || 'No rejection note.'}</p>
                                            {entry.resubmissionFeedback?.trim() ? (
                                              <div className="mt-2 rounded-md border border-primary/20 bg-primary-soft p-2">
                                                <p className="font-semibold text-primary">Chef feedback</p>
                                                <p className="mt-1">{entry.resubmissionFeedback}</p>
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
                                            Ingredient
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
                                          ingredients.map((ingredient, idx) => (
                                            <tr
                                              key={`${ingredient.productCode ?? ingredient.name ?? idx}-${idx}`}
                                              className="border-t border-border"
                                            >
                                              <td className="px-4 py-3 text-sm text-muted">
                                                {idx + 1}
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
        </section>
      ) : (
        <section className="rounded-md border border-border bg-surface shadow-sm">
          <TablePagination
            page={menuPage}
            totalPages={menuTotalPages}
            loading={loading}
            onPageChange={setMenuPage}
            summary={`Showing ${paginatedMenuGroups.length} of ${menuGroups.length} production batches`}
            className="border-b border-border bg-white px-5 py-4"
          />
          <div className="max-w-full overflow-x-auto">
            <table className="dm-table min-w-full text-sm">
              <thead className="bg-background">
                <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                  <th className="w-16 px-5 py-4 font-semibold">No</th>
                  <th className="px-5 py-4 font-semibold">Production date</th>
                  <th className="px-5 py-4 font-semibold">Production code</th>
                  <th className="px-5 py-4 font-semibold">Chef</th>
                  <th className="px-5 py-4 font-semibold">Admin</th>
                  <th className="px-5 py-4 font-semibold">Approval status</th>
                  <th className="px-5 py-4 font-semibold">
                    Store request status
                  </th>
                  <th className="px-5 py-4 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr className="border-t border-border">
                    <td colSpan={8} className="px-5 py-10 text-center text-muted">
                      Loading approval data...
                    </td>
                  </tr>
                ) : menuGroups.length === 0 ? (
                  <tr className="border-t border-border">
                    <td colSpan={8} className="px-5 py-10 text-center text-muted">
                      {selectedSite
                        ? 'No production batches found.'
                        : 'Select a site first.'}
                    </td>
                  </tr>
                ) : (
                  paginatedMenuGroups.map((group, index) => {
                    const groupKey = getGroupKey(group)
                    const isExpanded = expandedGroups.includes(groupKey)
                    const summaryItems = aggregateStoreRequestSummary(group.summary)
                    const hasApproved = group.items.some(
                      (item) => item.approvalStatus === 'approved',
                    )
                    const hasRejected = group.items.some(
                      (item) => item.approvalStatus === 'rejected',
                    )
                    const hasPending = group.items.some(
                      (item) => item.approvalStatus === 'pending',
                    )
                    const hasRequested = group.items.some(
                      (item) => item.storeRequestStatus === 'requested',
                    )
                    const hasFulfilled = group.items.some(
                      (item) => item.storeRequestStatus === 'fulfilled',
                    )
                    const hasCancelled = group.items.some(
                      (item) => item.storeRequestStatus === 'cancelled',
                    )
                    const hasNotRequested = group.items.some(
                      (item) => item.storeRequestStatus === 'not-requested',
                    )

                    return (
                      <Fragment key={groupKey}>
                        <tr className="border-t border-border">
                          <td className="px-5 py-4 text-sm text-muted">
                            {(menuPage - 1) * ITEMS_PER_PAGE + index + 1}
                          </td>
                          <td className="px-5 py-4">{group.date}</td>
                          <td className="px-5 py-4 text-xs text-muted">
                            {group.productionCode ?? '-'}
                          </td>
                          <td className="px-5 py-4">
                            {getSubmittedByLabel(group.items)}
                          </td>
                          <td className="px-5 py-4">
                            {group.items[0]?.salesInputBy ?? '-'}
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex flex-wrap items-center gap-2 text-sm">
                              {hasPending ? (
                                <span className="text-muted">Submitted</span>
                              ) : null}
                              {hasApproved ? (
                                <span className="text-primary">Approved</span>
                              ) : null}
                              {hasRejected ? (
                                <span className="text-danger">Rejected</span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex flex-wrap items-center gap-2 text-sm">
                              {hasNotRequested ? (
                                <span className="text-muted">
                                  {getStoreRequestStatusLabel('not-requested')}
                                </span>
                              ) : null}
                              {hasRequested ? (
                                <span className="text-primary">Requested</span>
                              ) : null}
                              {hasFulfilled ? (
                                <span className="text-success">Completed</span>
                              ) : null}
                              {hasCancelled ? (
                                <span className="text-danger">Cancelled</span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => toggleGroup(groupKey)}
                                className="rounded-md border border-primary bg-background px-3 py-1 text-xs font-semibold text-primary hover:bg-primary-soft/80"
                              >
                                {isExpanded ? 'Hide details' : 'View details'}
                              </button>
                              <select
                                value=""
                                onChange={(event) => {
                                  const nextStatus = event.target.value as
                                    | ApprovalStatus
                                    | ''
                                  if (!nextStatus) return
                                  openOverrideAction({
                                    kind: 'menu',
                                    group,
                                    nextStatus,
                                  })
                                }}
                                disabled={processingKey === groupKey}
                                className="h-8 w-36 rounded-md border border-border bg-white px-3 py-1 text-xs font-semibold text-primary shadow-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <option value="">Select action</option>
                                {group.items.some(
                                  (item) => item.approvalStatus !== 'approved',
                                ) ? (
                                  <option value="approved">Force approve</option>
                                ) : null}
                                {group.items.some(
                                  (item) => item.approvalStatus !== 'rejected',
                                ) ? (
                                  <option value="rejected">Force reject</option>
                                ) : null}
                              </select>
                            </div>
                          </td>
                        </tr>
                        {isExpanded ? (
                          <tr className="border-t border-border bg-background">
                            <td colSpan={8} className="px-5 py-5">
                              <div className="grid gap-4 lg:grid-cols-12">
                                <div className="rounded-md border border-border bg-surface p-4 lg:col-span-6">
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
                                            Approval
                                          </th>
                                          <th className="px-4 py-3 font-semibold">
                                            Portion
                                          </th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {group.items.map((menu, idx) => (
                                          <tr
                                            key={menu.id}
                                            className="border-t border-border"
                                          >
                                            <td className="px-4 py-3 text-sm text-muted">
                                              {idx + 1}
                                            </td>
                                            <td className="px-4 py-3 font-medium">
                                              {menu.recipeCode ?? menu.recipeId ?? '-'}
                                            </td>
                                            <td className="px-4 py-3">
                                              {menu.menuName}
                                            </td>
                                            <td
                                              className={`px-4 py-3 font-medium ${approvalStatusClass(
                                                menu.approvalStatus,
                                              )}`}
                                            >
                                              {getApprovalStatusLabel(
                                                menu.approvalStatus,
                                              )}
                                            </td>
                                            <td className="px-4 py-3">
                                              {menu.portion}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                                <div className="rounded-md border border-border bg-surface p-4 lg:col-span-6">
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
                                            Ingredient
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
                                        {summaryItems.length === 0 ? (
                                          <tr className="border-t border-border">
                                            <td
                                              colSpan={5}
                                              className="px-4 py-6 text-center text-muted"
                                            >
                                              No ingredient summary available.
                                            </td>
                                          </tr>
                                        ) : (
                                          summaryItems.map((ingredient, idx) => (
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
                                                {formatQuantity(ingredient.qty)}
                                              </td>
                                              <td className="px-4 py-3">
                                                {formatUnitLabel(
                                                  ingredient.unitOfMeasures,
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
        </section>
      )}

      {overrideAction ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            className="w-full max-w-xl rounded-md border border-border bg-surface p-6 shadow-xl"
            role="dialog"
            aria-modal="true"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs text-muted">
                  {corporateOnly
                    ? 'Recipe approval'
                    : overrideAction.kind === 'recipe'
                      ? 'Recipe approval override'
                      : 'Menu production approval override'}
                </p>
                <h2 className="mt-1 text-lg font-semibold text-foreground">
                  {corporateOnly
                    ? overrideAction.nextStatus === 'approved'
                      ? 'Approve'
                      : 'Reject'
                    : `Force ${
                        overrideAction.nextStatus === 'approved'
                          ? 'approve'
                          : 'reject'
                      }`}
                </h2>
                <p className="mt-2 text-sm text-muted">
                  {getOverrideActionLabel(overrideAction)}
                </p>
              </div>
              <button
                type="button"
                onClick={closeOverrideAction}
                disabled={Boolean(processingKey)}
                className="dm-x-button disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Close override confirmation"
                title="Close"
              >
                <i className="bi bi-x-lg text-sm leading-none" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-border bg-background p-4">
                <p className="text-xs text-muted">Target status</p>
                <p
                  className={`mt-2 text-sm font-semibold ${approvalStatusClass(
                    overrideAction.nextStatus,
                  )}`}
                >
                  {getApprovalStatusLabel(overrideAction.nextStatus)}
                </p>
              </div>
              <div className="rounded-md border border-border bg-background p-4">
                <p className="text-xs text-muted">
                  {overrideAction.kind === 'recipe' ? 'Record type' : 'Menus affected'}
                </p>
                <p className="mt-2 text-sm font-semibold text-foreground">
                  {overrideAction.kind === 'recipe'
                    ? 'Recipe'
                    : overrideAction.group.items.filter(
                        (item) =>
                          item.approvalStatus !== overrideAction.nextStatus,
                      ).length}
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-md border border-warning/40 bg-warning/10 p-4 text-sm text-warning">
              {corporateOnly
                ? 'This follows the normal recipe review flow used by the Unit Manager.'
                : overrideAction.kind === 'recipe'
                  ? 'This changes the recipe approval state outside the normal Unit Manager review flow.'
                  : 'This changes production menu approval outside the normal Unit Manager review flow and resets related store request or actual qty data for affected menus.'}
            </div>

            {overrideAction.kind === 'recipe' &&
            overrideAction.nextStatus === 'rejected' ? (
              <div className="mt-5">
                <label className="text-sm font-medium text-foreground">
                  Rejection reason
                </label>
                <textarea
                  value={overrideReason}
                  onChange={(event) => {
                    setOverrideReason(event.target.value)
                    if (overrideError) setOverrideError('')
                  }}
                  rows={4}
                  maxLength={500}
                  placeholder={
                    corporateOnly
                      ? 'Explain why this recipe is rejected.'
                      : 'Explain why this recipe approval is being overridden.'
                  }
                  className="mt-2 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                />
                <p className="mt-2 text-xs text-muted">
                  {overrideReason.trim().length}/500 characters
                </p>
              </div>
            ) : null}

            {overrideError ? (
              <p className="mt-4 text-xs font-medium text-red-600">
                {overrideError}
              </p>
            ) : null}

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={closeOverrideAction}
                disabled={Boolean(processingKey)}
                className="rounded-md border border-border bg-background px-4 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleConfirmOverride}
                disabled={Boolean(processingKey)}
                className={
                  overrideAction.nextStatus === 'approved'
                    ? 'rounded-md bg-success px-4 py-2 text-xs font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60'
                    : 'rounded-md bg-warning px-4 py-2 text-xs font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60'
                }
              >
                {processingKey
                  ? 'Saving...'
                  : corporateOnly
                    ? overrideAction.nextStatus === 'approved'
                      ? 'Approve'
                      : 'Reject'
                    : overrideAction.nextStatus === 'approved'
                      ? 'Confirm approve'
                      : 'Confirm reject'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default SuperadminApprovalCentersPage
