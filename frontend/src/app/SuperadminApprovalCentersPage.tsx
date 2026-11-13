import LoadingTableBody from '../components/LoadingTableBody'
import { applyProductionTableFilters } from '../lib/production-table-query'
import ProductionBulkExportButton from '../components/ProductionBulkExportButton'
import ProductionInformation from '../components/ProductionInformation'
import { DateRangeFilter } from './UnitManagerMenuProductionRecordsPage'
import PageHeading from '../components/PageHeading'
import MenuProductionSalesActions from '../components/MenuProductionSalesActions'
import { formatCreatedDate, formatProductionDate } from '../lib/date-format'
import RecipeCookingMethod from '../components/RecipeCookingMethod'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import TablePagination from '../components/TablePagination'
import SiteMultiSelect from '../components/SiteMultiSelect'
import { RecipeStatusBadge, RecipeApprovalStatusBadge } from '../components/RecipeStatusBadge'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useCorporateSite } from '../lib/corporate-site'
import { calculateFoodCostPercentage, formatFoodCostPercentage } from '../lib/food-cost'
import { formatQuantity } from '../lib/quantity'
import { formatRecipeVersion } from '../lib/recipe-version'
import { aggregateStoreRequestSummaryByVendor } from '../lib/store-request-summary'
import { summarizePortionsByGroup } from '../lib/menu-production-quantity'
import {
  getApprovalStatusLabel,
  getStoreRequestStatusLabel,
} from '../lib/status-labels'
import { formatUnitLabel } from '../lib/unit-of-measures'
import ChefCreateMenu, { type BaseRecipe } from './ChefCreateMenu'
import RecipeSalesRecommendation from '../components/RecipeSalesRecommendation'
import { buildMenuProductionApprovalSheets, downloadMenuProductionApproval } from '../lib/menu-production-approval-export'

type ApprovalStatus = 'pending' | 'approved' | 'rejected'
type ApprovalSection = 'recipes' | 'menu-productions'
type OverrideAction =
  | { kind: 'recipe'; recipe: Recipe; nextStatus: ApprovalStatus }
  | { kind: 'menu-item'; menu: StoreRequestMenu; nextStatus: ApprovalStatus }
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
  priceUom?: number
  ingredientType?: 'IT' | 'NMP'
  productCode?: string
  name?: string
  unitOfMeasures?: string
  qty?: number
  foodCost?: number
}

type Recipe = {
  cookingMethod?: string[]
  targetFoodCostPercentage?: number
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
  foodCostRecipe?: number
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
  ingredientType?: 'IT' | 'NMP'
  vendor?: string
  vendorSite?: string
  price?: number
  ingredientCost?: number
  productCode: string
  name: string
  unitOfMeasures: string
  qty: number
}

type StoreRequestMenu = {
  estimatedCost?: number
  estimatedCostPerPax?: number
  cost?: number
  sellingPricePerPax?: number
  sellingQuantity?: number
  estimatedRevenue?: number
  groupSales?: Array<{ name: string; quantity: number; sellingPricePerPax: number; estimatedRevenue: number }>
  submittedAt?: string
  recipeVersion?: number
  group?: string
  clientName?: string
  fulfilledBy?: string
  cancelledBy?: string
  salesRejectionReason?: string
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
  financeApprovalRequired?: boolean
  financeCostStatus?: 'pending' | 'approved' | 'rejected'
  financeSalesStatus?: 'pending' | 'approved' | 'rejected'
  financeCostReviewedBy?: string
  financeSalesReviewedBy?: string
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

const formatPrice = (value?: number) => {
  if (value === undefined || value === null || !Number.isFinite(value)) return '-'
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(value)
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

const getRecipeCostLabels = (recipe: Recipe) => {
  if (recipe.approvalStatus === 'approved') {
    return { estimatedTotalCost: '-', costPerPax: '-' }
  }
  const ingredientCosts = (recipe.ingredients ?? [])
    .map((ingredient) => ingredient.foodCost)
    .filter((cost): cost is number => cost != null && Number.isFinite(cost))
  const totalCost =
    recipe.foodCostRecipe != null && Number.isFinite(recipe.foodCostRecipe)
      ? recipe.foodCostRecipe
      : ingredientCosts.length
        ? ingredientCosts.reduce((total, cost) => total + cost, 0)
        : undefined
  if (totalCost === undefined) return { estimatedTotalCost: '-', costPerPax: '-' }
  const basePax =
    recipe.portionSize != null &&
    Number.isFinite(recipe.portionSize) &&
    recipe.portionSize > 0
      ? recipe.portionSize
      : 1
  const formatter = new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  })
  return {
    estimatedTotalCost: formatter.format(totalCost),
    costPerPax: formatter.format(totalCost / basePax),
  }
}

const getGroupKey = (group: StoreRequestGroup) =>
  `${group.date}__${group.productionCode ?? 'no-code'}`

const SuperadminApprovalCentersPage = ({ corporateOnly = false }: { corporateOnly?: boolean }) => {
  const { accessToken, user } = useAuth()
  const isSuperadmin = user?.role === 'superadmin' || user?.roles?.includes('superadmin') === true
  const corporateSettings = useCorporateSite(corporateOnly)
  const isCorporateSite = corporateOnly && corporateSettings.context?.corporateSite === true
  const [searchParams] = useSearchParams()
  const sectionParam = searchParams.get('section')
  const [siteOptions, setSiteOptions] = useState<SiteOption[]>([])
  const [selectedSite, setSelectedSite] = useState('')
  const [selectedCorporateSites, setSelectedCorporateSites] = useState<string[] | null>(null)
  const corporateSiteCodes = useMemo(() =>
    selectedCorporateSites === null
      ? siteOptions.map((site) => site.code)
      : selectedCorporateSites.filter((code) => siteOptions.some((site) => site.code === code)),
    [selectedCorporateSites, siteOptions],
  )
  const hasApprovalScope = corporateOnly ? corporateSiteCodes.length > 0 : Boolean(selectedSite)
  const [activeSection, setActiveSection] = useState<ApprovalSection>(() =>
    isApprovalSection(sectionParam) ? sectionParam : 'recipes',
  )
  const [approvalFilter, setApprovalFilter] = useState<'' | ApprovalStatus>(
    corporateOnly ? 'pending' : '',
  )
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [recipeTotal, setRecipeTotal] = useState(0)
  const approvalRequestId = useRef(0)
  const [menuTotal, setMenuTotal] = useState(0)
  const [menuClients, setMenuClients] = useState<string[]>([])
  const [menuGroups, setMenuGroups] = useState<StoreRequestGroup[]>([])
  const [productionDateFrom, setProductionDateFrom] = useState('')
  const [productionDateTo, setProductionDateTo] = useState('')
  const [createdDateFrom, setCreatedDateFrom] = useState('')
  const [createdDateTo, setCreatedDateTo] = useState('')
  const [dateSort, setDateSort] = useState('production-desc')
  const [clientName, setClientName] = useState('')
  const invalidProductionRange = Boolean(productionDateFrom && productionDateTo && productionDateFrom > productionDateTo)
  const invalidCreatedRange = Boolean(createdDateFrom && createdDateTo && createdDateFrom > createdDateTo)
  const clientOptions = menuClients
  const filteredMenuGroups = useMemo(() => menuGroups.filter((group) =>
    !invalidProductionRange && !invalidCreatedRange &&
    (!productionDateFrom || group.date >= productionDateFrom) &&
    (!productionDateTo || group.date <= productionDateTo) &&
    (!(createdDateFrom || createdDateTo) || (() => {
      const submittedAt = getGroupSubmittedAt(group)
      if (!submittedAt) return false
      const date = new Date(submittedAt)
      if (Number.isNaN(date.getTime())) return false
      const createdDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      return (!createdDateFrom || createdDate >= createdDateFrom) && (!createdDateTo || createdDate <= createdDateTo)
    })()) &&
    (!clientName || group.items.some((item) => item.clientName?.trim().toLowerCase() === clientName.toLowerCase())),
  ).sort((a, b) => {
    const direction = dateSort.endsWith('-asc') ? 1 : -1
    if (dateSort.startsWith('created-')) {
      return direction * new Date(getGroupSubmittedAt(a) ?? '').getTime() - direction * new Date(getGroupSubmittedAt(b) ?? '').getTime()
    }
    return direction * a.date.localeCompare(b.date)
  }),
  [menuGroups, invalidProductionRange, invalidCreatedRange, productionDateFrom, productionDateTo, createdDateFrom, createdDateTo, clientName, dateSort])

  useEffect(() => {
    setMenuPage(1)
  }, [productionDateFrom, productionDateTo, createdDateFrom, createdDateTo, clientName, dateSort])

  const [expandedRecipes, setExpandedRecipes] = useState<string[]>([])
  const [expandedGroups, setExpandedGroups] = useState<string[]>([])
  const [recipePage, setRecipePage] = useState(1)
  const [menuPage, setMenuPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [processingKey, setProcessingKey] = useState<string | null>(null)
  const [salesActionRequest, setSalesActionRequest] = useState<{
    groupKey: string
    mode: 'edit' | 'reject'
    requestId: number
  } | null>(null)
  const salesActionRequestId = useRef(0)
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
      cookingMethod: recipe.cookingMethod ?? [],
      portionSize: recipe.portionSize ?? 1,
      targetFoodCostPercentage: recipe.targetFoodCostPercentage,
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

  const fetchSites = useCallback(async () => {
    if (!accessToken) {
      setSiteOptions([])
      return
    }

    if (corporateOnly) {
      const context = corporateSettings.context
      if (!context) return
      const assigned = Array.from(
        new Set([...(context.site ? [context.site] : []), ...(context.sites ?? [])]),
      ).map((code) => ({
        code,
        name: context.siteOptions?.find((site) => site.code === code)?.name ?? code,
      }))
      const options = isCorporateSite ? context.approvalSiteOptions ?? [] : assigned
      setSiteOptions(options)
      setSelectedCorporateSites((current) => current === null
        ? null
        : current.filter((code) => options.some((site) => site.code === code)))
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
  }, [accessToken, corporateOnly, corporateSettings.context, isCorporateSite])

  const fetchApprovals = useCallback(async (signal?: AbortSignal) => {
    const requestId = ++approvalRequestId.current
    if (!accessToken) {
      setError('Please log in first to load approval data.')
      return
    }
    if (corporateOnly && (corporateSettings.loading || corporateSettings.error)) {
      setRecipes([])
      setRecipeTotal(0)
      setMenuGroups([])
      setMenuTotal(0)
      setMenuClients([])
      setLoading(false)
      setError(corporateSettings.error)
      return
    }
    if (!hasApprovalScope) {
      setRecipes([])
      setRecipeTotal(0)
      setMenuGroups([])
      setMenuTotal(0)
      setMenuClients([])
      setLoading(false)
      setError('')
      return
    }

    setLoading(true)
    setError('')
    try {
      const recipeParams = new URLSearchParams()
      if (corporateOnly) {
        if (selectedCorporateSites !== null || !isCorporateSite) {
          recipeParams.set('sites', corporateSiteCodes.join(','))
        }
      } else if (selectedSite) recipeParams.set('site', selectedSite)
      recipeParams.set('strictSite', 'true')
      recipeParams.set('page', String(recipePage))
      recipeParams.set('limit', String(ITEMS_PER_PAGE))
      if (approvalFilter) recipeParams.set('approvalStatus', approvalFilter)

      const menuParams = new URLSearchParams({ view: 'approval', page: String(menuPage), limit: String(ITEMS_PER_PAGE) })
      applyProductionTableFilters(menuParams, { productionDateFrom, productionDateTo, createdDateFrom, createdDateTo, clientName, dateSort })
      menuParams.set('site', selectedSite)
      if (approvalFilter) menuParams.set('approvalStatus', approvalFilter)

      const recipesData = activeSection === 'recipes' ? await apiFetch<{ items?: Recipe[]; total: number }>(
        `/recipes?${recipeParams.toString()}`,
        { signal },
        accessToken,
      ) : { items: [], total: 0 }
      const menusData = corporateOnly || activeSection !== 'menu-productions'
        ? { items: [] as StoreRequestGroup[], total: 0, clients: [] as string[] }
        : await apiFetch<{ items?: StoreRequestGroup[]; total: number; clients: string[] }>(
            `/menu-productions/store-requests?${menuParams.toString()}`,
            { signal },
            accessToken,
          )

      if (requestId !== approvalRequestId.current || signal?.aborted) return

      if (activeSection === 'recipes') {
        const total = recipesData.total ?? 0
        const totalPages = Math.max(1, Math.ceil(total / ITEMS_PER_PAGE))
        setRecipeTotal(total)
        setRecipePage((current) => Math.min(current, totalPages))
        setRecipes(recipesData.items ?? [])
      } else {
        setMenuGroups(
          [...(menusData.items ?? [])].sort((a, b) => {
            const byDate = b.date.localeCompare(a.date)
            if (byDate !== 0) return byDate
            return (b.productionCode ?? '').localeCompare(a.productionCode ?? '')
          }),
        )
        setMenuTotal(menusData.total)
        setMenuClients(menusData.clients)
      }
    } catch (caught) {
      if (requestId !== approvalRequestId.current || signal?.aborted) return
      const nextError =
        caught instanceof Error ? caught.message : 'Failed to load approval data.'
      setRecipes([])
      setRecipeTotal(0)
      setMenuGroups([])
      setError(nextError)
    } finally {
      if (requestId === approvalRequestId.current && !signal?.aborted) setLoading(false)
    }
  }, [accessToken, approvalFilter, corporateOnly, recipePage, selectedSite, hasApprovalScope, corporateSettings.loading, corporateSettings.error, corporateSiteCodes, selectedCorporateSites, isCorporateSite, activeSection, menuPage, productionDateFrom, productionDateTo, createdDateFrom, createdDateTo, clientName, dateSort])

  useEffect(() => {
    fetchSites().catch(() => null)
  }, [fetchSites])

  useEffect(() => {
    const controller = new AbortController()
    fetchApprovals(controller.signal).catch(() => null)
    return () => {
      controller.abort()
      approvalRequestId.current += 1
    }
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
    setMenuPage(1)
    setExpandedRecipes([])
    setExpandedGroups([])
    setOverrideAction(null)
    setOverrideReason('')
    setOverrideError('')
    setMessage('')
    setError('')
  }, [selectedSite, selectedCorporateSites, approvalFilter])

  const recipeTotalPages = Math.max(1, Math.ceil(recipeTotal / ITEMS_PER_PAGE))
  const menuTotalPages = Math.max(1, Math.ceil(menuTotal / ITEMS_PER_PAGE))
  const paginatedMenuGroups = filteredMenuGroups
  useEffect(() => {
    setMenuPage((current) => Math.min(current, Math.max(1, Math.ceil(menuTotal / ITEMS_PER_PAGE))))
  }, [menuTotal])

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
    if (action.kind === 'menu-item') return action.menu.menuName
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
      if (editingRecipe?.id === recipeId) setEditingRecipe(null)
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

  const updateMenuItemApproval = async ({
    menu,
    nextStatus,
    reason,
  }: {
    menu: StoreRequestMenu
    nextStatus: ApprovalStatus
    reason?: string
  }) => {
    if (!accessToken || menu.approvalStatus === nextStatus) return

    const action = nextStatus === 'approved' ? 'approve' : 'reject'
    setProcessingKey(menu.id)
    setError('')
    setMessage('')
    try {
      await apiFetch(
        `/menu-productions/${menu.id}/${action}`,
        {
          method: 'PATCH',
          ...(nextStatus === 'rejected'
            ? { body: JSON.stringify({ reason: reason?.trim() }) }
            : {}),
        },
        accessToken,
      )
      setMessage(`${menu.menuName} set to ${nextStatus}.`)
      await fetchApprovals()
      setOverrideAction(null)
      setOverrideReason('')
    } catch (caught) {
      setOverrideError(
        caught instanceof Error ? caught.message : `Failed to ${action} menu.`,
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

    if (
      overrideAction.kind === 'menu-item' &&
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

    if (overrideAction.kind === 'menu-item') {
      await updateMenuItemApproval({
        menu: overrideAction.menu,
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
              onReject={corporateOnly ? () => {
                const recipe = recipes.find((item) => (item.id ?? item._id) === editingRecipe.id)
                if (!recipe) {
                  setError('Recipe is no longer available. Close the editor and reopen this page.')
                  setEditingRecipe(null)
                  return
                }
                openOverrideAction({ kind: 'recipe', recipe, nextStatus: 'rejected' })
              } : undefined}
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
      <div>
        <PageHeading className="text-2xl font-semibold">Approval Centers</PageHeading>
      </div>

      <div className="!mt-2 rounded-md border border-border bg-surface shadow-sm">
        <div className="space-y-2 border-b border-border px-5 py-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full max-w-xs">
              <label className="text-xs font-medium text-muted">Site</label>
              {corporateOnly ? (
                <SiteMultiSelect
                  options={siteOptions}
                  selected={selectedCorporateSites}
                  onChange={(sites) => {
                    setSelectedCorporateSites(sites)
                    setRecipePage(1)
                  }}
                  disabled={corporateSettings.loading || Boolean(corporateSettings.error)}
                />
              ) : <select
                value={selectedSite}
                onChange={(event) => {
                  setSelectedSite(event.target.value)
                  setRecipePage(1)
                }}
                className="mt-2 h-10 w-full rounded-xl border border-border bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
              >
                <option value="">Select site</option>
                {siteOptions.map((site) => (
                  <option key={site.code} value={site.code}>
                    {site.name || site.code}
                  </option>
                ))}
              </select>}
            </div>
            <div className="w-full max-w-xs">
              <label className="text-xs font-medium text-muted">
                Approval status
              </label>
              <select
                value={approvalFilter}
                onChange={(event) => {
                  setApprovalFilter(event.target.value as '' | ApprovalStatus)
                  setRecipePage(1)
                }}
                className="mt-2 h-10 w-full rounded-xl border border-border bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
              >
                <option value="">{corporateOnly ? 'All status' : 'All status'}</option>
                <option value="pending">Submitted</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
          </div>
          {error ? <p className="text-xs font-medium text-red-600">{error}</p> : null}
          {message ? (
            <p className="text-xs font-medium text-primary">{message}</p>
          ) : null}
        </div>
        {activeSection === 'recipes' ? (
        <section className="min-w-0">
          <TablePagination
            page={recipePage}
            totalPages={recipeTotalPages}
            loading={loading}
            onPageChange={setRecipePage}
            summary={`Showing ${recipes.length} of ${recipeTotal} recipes`}
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
                  {corporateOnly ? (
                    <>
                      <th className="px-5 py-4 font-semibold">Estimated Total Cost</th>
                      <th className="px-5 py-4 font-semibold">Cost/Pax</th>
                    </>
                  ) : null}
                  <th className="px-5 py-4 font-semibold">Action</th>
                </tr>
              </thead>
              <LoadingTableBody
                key={JSON.stringify([recipePage, selectedSite, selectedCorporateSites, approvalFilter])}
                loading={loading}
                columns={corporateOnly ? 10 : 8}
                rowCount={recipes.length}
                label="Loading approval data..."
                error={error}
                onRetry={() => { void fetchApprovals() }}
              >
                {recipes.length === 0 ? (
                  <tr className="border-t border-border">
                    <td colSpan={corporateOnly ? 10 : 8} className="px-5 py-10 text-center text-muted">
                      {corporateSettings.loading ? 'Loading approval sites...' : hasApprovalScope ? 'No recipes found.' : corporateOnly ? 'Select at least one site.' : 'Select a site first.'}
                    </td>
                  </tr>
                ) : (
                  recipes.map((recipe, index) => {
                    const recipeKey = getRecipeKey(recipe)
                    const isExpanded = expandedRecipes.includes(recipeKey)
                    const ingredients = recipe.ingredients ?? []
                    const costLabels = getRecipeCostLabels(recipe)
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
                            <RecipeStatusBadge status={recipe.status} isActive={recipe.isActive} />
                          </td>
                          <td className="px-5 py-4">
                            <RecipeApprovalStatusBadge status={recipe.approvalStatus} />
                          </td>
                          {corporateOnly ? (
                            <>
                              <td className="whitespace-nowrap px-5 py-4 font-medium">
                                {costLabels.estimatedTotalCost}
                              </td>
                              <td className="whitespace-nowrap px-5 py-4 font-medium">
                                {costLabels.costPerPax}
                              </td>
                            </>
                          ) : null}
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
                            <td colSpan={corporateOnly ? 10 : 8} className="px-5 py-5">
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
                                  <RecipeSalesRecommendation recipe={recipe} />
                                  <p className="mt-3 text-xs text-muted">Description</p>
                                  <p className="mt-1 text-sm text-foreground">
                                    {recipe.description?.trim() || 'No description.'}
                                  </p>
                                  <RecipeCookingMethod steps={recipe.cookingMethod} />
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
                                          <th className="px-3 py-3 font-semibold">No</th>
                                          <th className="px-3 py-3 font-semibold">Product code</th>
                                          <th className="px-3 py-3 font-semibold">Ingredient name</th>
                                          <th className="px-3 py-3 font-semibold">Qty</th>
                                          <th className="px-3 py-3 font-semibold">Unit</th>
                                          <th className="px-3 py-3 font-semibold">Vendor</th>
                                          <th className="px-3 py-3 font-semibold">Price</th>
                                          <th className="px-3 py-3 font-semibold">Ingredient Cost</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {ingredients.length === 0 ? (
                                          <tr className="border-t border-border">
                                            <td
                                              colSpan={8}
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
              </LoadingTableBody>
            </table>
          </div>
        </section>
      ) : (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="superadmin-production-client" className="sr-only">Client Name</label>
            <select
              id="superadmin-production-client"
              value={clientName}
              onChange={(event) => setClientName(event.target.value)}
              disabled={loading}
              className="h-10 rounded-lg border border-border bg-white px-3 text-sm"
            >
              <option value="">All clients</option>
              {clientOptions.map((client) => <option key={client} value={client}>{client}</option>)}
            </select>
            <DateRangeFilter
              id="superadmin-production-date"
              label="Production Date"
              from={productionDateFrom}
              to={productionDateTo}
              sortDirection={dateSort.startsWith('production-') ? dateSort.endsWith('-asc') ? 'asc' : 'desc' : undefined}
              onSort={(direction) => setDateSort(`production-${direction}`)}
              onApply={(from, to) => { setProductionDateFrom(from); setProductionDateTo(to) }}
            />
            <DateRangeFilter
              id="superadmin-created-date"
              label="Created Date"
              from={createdDateFrom}
              to={createdDateTo}
              sortDirection={dateSort.startsWith('created-') ? dateSort.endsWith('-asc') ? 'asc' : 'desc' : undefined}
              onSort={(direction) => setDateSort(`created-${direction}`)}
              onApply={(from, to) => { setCreatedDateFrom(from); setCreatedDateTo(to) }}
            />
            <button
              type="button"
              onClick={() => { setProductionDateFrom(''); setProductionDateTo(''); setCreatedDateFrom(''); setCreatedDateTo(''); setClientName(''); setDateSort('production-desc') }}
              className="h-10 rounded-lg border border-primary bg-primary px-3 py-2 text-xs font-medium text-white hover:bg-primary/90"
            >Reset filters</button>
            <ProductionBulkExportButton
              groups={menuGroups}
              loadGroups={async ({ from, to, client, summaryOnly }) => {
                const params = new URLSearchParams({ site: selectedSite, view: 'approval' })
                if (from) params.set('startDate', from)
                if (to) params.set('endDate', to)
                if (client) params.set('clientName', client)
                if (summaryOnly) params.set('summaryOnly', 'true')
                if (approvalFilter) params.set('approvalStatus', approvalFilter)
                return apiFetch<{ items: StoreRequestGroup[]; total: number; clients: string[] }>(`/menu-productions/store-requests?${params}`, undefined, accessToken ?? undefined)
              }}
              disabled={loading || Boolean(error) || !hasApprovalScope}
              filename="menu-production-approvals-bulk.xlsx"
              buildBatch={buildMenuProductionApprovalSheets}
            />
          </div>
          <div className="p-6">
          <TablePagination
            page={menuPage}
            totalPages={menuTotalPages}
            loading={loading}
            onPageChange={setMenuPage}
            summary={`Showing ${paginatedMenuGroups.length} of ${menuTotal} production batches`}
            className="border-b border-border bg-white px-5 py-4"
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
              <LoadingTableBody
                key={JSON.stringify([menuPage, selectedSite, selectedCorporateSites, approvalFilter, productionDateFrom, productionDateTo, createdDateFrom, createdDateTo, clientName, dateSort])}
                loading={loading}
                columns={7}
                rowCount={filteredMenuGroups.length}
                label="Loading approval data..."
                error={error}
                onRetry={() => { void fetchApprovals() }}
              >
                {filteredMenuGroups.length === 0 ? (
                  <tr className="border-t border-border">
                    <td colSpan={7} className="px-4 py-8 text-center text-muted">
                      {selectedSite
                        ? 'No production batches found.'
                        : 'Select a site first.'}
                    </td>
                  </tr>
                ) : (
                  paginatedMenuGroups.map((group, index) => {
                    const groupKey = getGroupKey(group)
                    const isExpanded = expandedGroups.includes(groupKey)
                    const summaryItems = aggregateStoreRequestSummaryByVendor(group)
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
                    const canRejectSales = group.items.length > 0 && group.items.every((item) =>
                      ['not-requested', 'requested'].includes(item.storeRequestStatus) &&
                      item.approvalStatus !== 'rejected' && !item.salesRejectionReason &&
                      item.sellingPricePerPax != null && item.sellingQuantity != null,
                    )
                    const submittedByLabel = getSubmittedByLabel(group.items)
                    const salesInputByLabel = group.items[0]?.salesInputBy?.trim() || '-'
                    const totalEstimatedCost = group.items.reduce(
                      (total, item) => total + (Number.isFinite(Number(item.estimatedCost))
                        ? Number(item.estimatedCost)
                        : Number.isFinite(Number(item.cost)) ? Number(item.cost) : 0),
                      0,
                    )
                    const totalEstimatedCostPerPax = group.items.reduce((total, item) => {
                      const estimatedCost = Number.isFinite(Number(item.estimatedCost))
                        ? Number(item.estimatedCost)
                        : Number.isFinite(Number(item.cost)) ? Number(item.cost) : undefined
                      const costPerPax = Number.isFinite(Number(item.estimatedCostPerPax))
                        ? Number(item.estimatedCostPerPax)
                        : estimatedCost !== undefined && item.portion > 0 ? estimatedCost / item.portion : 0
                      return total + costPerPax
                    }, 0)
                    const firstMenu = group.items[0]
                    const sellingPricePerPax = Number.isFinite(Number(firstMenu?.sellingPricePerPax))
                      ? Number(firstMenu?.sellingPricePerPax)
                      : undefined
                    const sellingQuantity = Number.isFinite(Number(firstMenu?.sellingQuantity))
                      ? Number(firstMenu?.sellingQuantity)
                      : undefined
                    const estimatedRevenue = sellingPricePerPax !== undefined && sellingQuantity !== undefined
                      ? sellingPricePerPax * sellingQuantity
                      : undefined
                    const foodCostPercentage = calculateFoodCostPercentage(totalEstimatedCost, estimatedRevenue)
                    const portionSummary = summarizePortionsByGroup(group.items)
                    const groupSales = firstMenu?.groupSales ?? []
                    const groupSalesRevenue = groupSales.reduce((total, sale) => total + sale.estimatedRevenue, 0)

                    return (
                      <Fragment key={groupKey}>
                        <tr className="border-t border-border">
                          <td className="px-4 py-3 text-sm font-bold text-black">
                            {(menuPage - 1) * ITEMS_PER_PAGE + index + 1}
                          </td>
                          <td className="px-4 py-3 text-sm font-bold text-black">
                            {formatCreatedDate(getGroupSubmittedAt(group))}
                          </td>
                          <td className="px-4 py-3 font-bold text-black">{formatProductionDate(group.date)}</td>
                          <td className="px-4 py-3 text-xs font-bold text-black">
                            {group.productionCode ?? '-'}
                          </td>
                          <td className="px-4 py-3 font-bold text-black">
                            {group.items[0]?.clientName ?? '-'}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-nowrap items-center gap-1.5">
                              {hasPending ? (
                                <span className="whitespace-nowrap rounded-full bg-primary-soft px-1.5 py-0.5 text-[11px] font-semibold text-primary">Submitted</span>
                              ) : null}
                              {hasApproved ? (
                                <span className="whitespace-nowrap rounded-full bg-primary-soft px-1.5 py-0.5 text-[11px] font-semibold text-primary">Approved</span>
                              ) : null}
                              {hasRejected ? (
                                <span className="whitespace-nowrap rounded-full bg-danger/10 px-1.5 py-0.5 text-[11px] font-semibold text-danger">Rejected</span>
                              ) : null}
                              <span className="whitespace-nowrap text-[11px] text-muted">{group.items.filter((item) => item.approvalStatus === 'pending').length} of {group.items.length} menus pending</span>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
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
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap items-center gap-2">
                              {!isSuperadmin ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => toggleGroup(groupKey)}
                                    className="rounded-md border border-primary bg-background px-3 py-1 text-xs font-semibold text-primary hover:bg-primary-soft/80"
                                  >
                                    {isExpanded ? 'Hide details' : 'View details'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => downloadMenuProductionApproval(group)}
                                    className="rounded-md border border-success bg-white px-3 py-1 text-xs font-semibold text-success hover:bg-success/10"
                                  >
                                    <span className="flex items-center gap-1.5">
                                      <i className="bi bi-download" aria-hidden="true" />
                                      Export
                                    </span>
                                  </button>
                                </>
                              ) : null}
                              <select
                                value=""
                                onChange={(event) => {
                                  const action = event.target.value
                                  event.currentTarget.value = ''
                                  if (!action) return
                                  if (action === 'toggle-details') {
                                    toggleGroup(groupKey)
                                    return
                                  }
                                  if (action === 'export') {
                                    downloadMenuProductionApproval(group)
                                    return
                                  }
                                  if (action === 'edit-sales' || action === 'reject-sales') {
                                    setSalesActionRequest({
                                      groupKey,
                                      mode: action === 'edit-sales' ? 'edit' : 'reject',
                                      requestId: ++salesActionRequestId.current,
                                    })
                                    return
                                  }
                                  openOverrideAction({
                                    kind: 'menu',
                                    group,
                                    nextStatus: action as ApprovalStatus,
                                  })
                                }}
                                disabled={processingKey === groupKey}
                                className="h-8 w-44 rounded-md border border-border bg-white px-3 py-1 text-xs font-semibold text-primary shadow-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <option value="">Select action</option>
                                {isSuperadmin ? <option value="toggle-details">{isExpanded ? 'Hide details' : 'View details'}</option> : null}
                                {isSuperadmin ? <option value="export">Export</option> : null}
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
                                {isSuperadmin ? <option value="edit-sales">Edit Sales</option> : null}
                                {isSuperadmin && canRejectSales ? <option value="reject-sales">Reject Sales</option> : null}
                              </select>
                              <MenuProductionSalesActions
                                group={group}
                                onSaved={fetchApprovals}
                                showButtons={!isSuperadmin}
                                actionRequest={isSuperadmin ? salesActionRequest : null}
                              />
                            </div>
                          </td>
                        </tr>
                        {isExpanded ? (
                          <tr className="border-t border-border bg-background">
                            <td colSpan={7} className="px-4 py-5">
                              <div className="space-y-4">
                                <ProductionInformation
                                  financeItems={group.items}
                                  productionCode={group.productionCode}
                                  createdAt={getGroupSubmittedAt(group)}
                                  submittedBy={submittedByLabel}
                                  admin={salesInputByLabel}
                                  batchStatus={group.items[0]?.salesInputBy?.trim() ? 'Waiting for Approval' : 'Waiting for Sales Input'}
                                  productionDate={group.date}
                                  client={group.items[0]?.clientName}
                                  totalMenu={group.items.length}
                                  approvalStatus={[hasPending ? getApprovalStatusLabel('pending') : '', hasApproved ? getApprovalStatusLabel('approved') : '', hasRejected ? getApprovalStatusLabel('rejected') : ''].filter(Boolean).join(', ')}
                                  storeRequestStatus={[hasNotRequested ? getStoreRequestStatusLabel('not-requested') : '', hasRequested ? getStoreRequestStatusLabel('requested') : '', hasFulfilled ? getStoreRequestStatusLabel('fulfilled') : '', hasCancelled ? getStoreRequestStatusLabel('cancelled') : ''].filter(Boolean).join(', ')}
                                />
                                <section>
                                  <h3 className="text-sm font-semibold text-foreground">Menu list</h3>
                                  <div className="mt-3 overflow-hidden rounded-md border border-black bg-white">
                                    <table className="dm-table !w-full !table-fixed text-sm [&_td]:!whitespace-normal [&_th]:!whitespace-normal">
                                      <thead className="bg-background">
                                        <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                                          <th className="px-3 py-3 font-semibold">No</th>
                                          <th className="px-3 py-3 font-semibold">Group By</th>
                                          <th className="px-3 py-3 font-semibold">Menu</th>
                                          <th className="px-3 py-3 font-semibold">Portion</th>
                                          <th className="px-3 py-3 font-semibold">Estimated Cost</th>
                                          <th className="px-3 py-3 font-semibold">Cost Contribution (%)</th>
                                          <th className="px-3 py-3 font-semibold">Cost/Pax</th>
                                          <th className="px-3 py-3 font-semibold">Approval Status</th>
                                          <th className="px-3 py-3 font-semibold">Action</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {group.items.map((menu, idx) => {
                                          const estimatedCost = Number.isFinite(Number(menu.estimatedCost)) ? Number(menu.estimatedCost) : Number.isFinite(Number(menu.cost)) ? Number(menu.cost) : undefined
                                          const estimatedCostPerPax = Number.isFinite(Number(menu.estimatedCostPerPax)) ? Number(menu.estimatedCostPerPax) : estimatedCost !== undefined && menu.portion > 0 ? estimatedCost / menu.portion : undefined
                                          return (
                                          <tr
                                            key={menu.id}
                                            className="border-t border-border"
                                          >
                                            <td className="px-3 py-3 text-sm text-muted">{idx + 1}</td>
                                            <td className="px-3 py-3">{menu.group ?? '-'}</td>
                                            <td className="px-3 py-3"><p className="truncate !whitespace-nowrap font-semibold text-foreground" title={menu.menuName}>{menu.menuName}</p><p className="mt-1 truncate !whitespace-nowrap text-xs text-muted">{menu.recipeCode ?? '-'} · {menu.category}</p></td>
                                            <td className="px-3 py-3">{menu.portion}</td>
                                            <td className="px-3 py-3 font-medium">{formatPrice(estimatedCost)}</td>
                                            <td className="px-3 py-3 font-medium">{estimatedRevenue ? `${(((estimatedCost ?? 0) / estimatedRevenue) * 100).toFixed(2)}%` : '-'}</td>
                                            <td className="px-3 py-3 font-medium">{formatPrice(estimatedCostPerPax)}</td>
                                            <td
                                              className="px-3 py-3"
                                            >
                                              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${menu.approvalStatus === 'approved' ? 'bg-primary-soft text-primary' : menu.approvalStatus === 'rejected' ? 'bg-danger/10 text-danger' : 'bg-background text-muted'}`}>{getApprovalStatusLabel(menu.approvalStatus)}</span>
                                            </td>
                                            {isSuperadmin ? (
                                              <td className="px-3 py-3">
                                                <div className="flex flex-nowrap items-center gap-1.5">
                                                  {menu.approvalStatus !== 'approved' ? (
                                                    <button
                                                      type="button"
                                                      onClick={() => openOverrideAction({
                                                        kind: 'menu-item',
                                                        menu,
                                                        nextStatus: 'approved',
                                                      })}
                                                      disabled={processingKey === menu.id}
                                                      className="whitespace-nowrap rounded-md bg-primary px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                                                    >
                                                      {menu.approvalStatus === 'pending' ? 'Approve' : 'Force approve'}
                                                    </button>
                                                  ) : null}
                                                  {menu.approvalStatus !== 'rejected' ? (
                                                    <button
                                                      type="button"
                                                      onClick={() => openOverrideAction({
                                                        kind: 'menu-item',
                                                        menu,
                                                        nextStatus: 'rejected',
                                                      })}
                                                      disabled={processingKey === menu.id}
                                                      className="whitespace-nowrap rounded-md border border-danger bg-white px-2.5 py-1.5 text-xs font-semibold text-danger hover:bg-danger/10 disabled:opacity-60"
                                                    >
                                                      {menu.approvalStatus === 'pending' ? 'Reject' : 'Force reject'}
                                                    </button>
                                                  ) : null}
                                                </div>
                                              </td>
                                            ) : null}
                                          </tr>
                                          )
                                        })}
                                      </tbody>
                                      <tfoot className="bg-[#ccd9ec]">
                                        <tr className="border-t-2 border-primary"><td colSpan={4} className="px-3 py-3 text-center text-xs font-bold uppercase tracking-[0.12em]">Total</td><td className="px-3 py-3 font-bold">{formatPrice(totalEstimatedCost)}</td><td className="px-3 py-3 font-bold">{foodCostPercentage === undefined ? '-' : `${foodCostPercentage.toFixed(2)}%`}</td><td className="px-3 py-3 font-bold">{formatPrice(totalEstimatedCostPerPax)}</td><td colSpan={2} /></tr>
                                        {portionSummary.groups.map((item) => <tr key={`group-portion-${item.name}`} className="border-t border-border"><td colSpan={4} className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-[0.12em]">{item.name} Qty</td><td colSpan={5} className="px-3 py-3 font-semibold">{formatQuantity(item.portion)}</td></tr>)}
                                        <tr className="border-t border-border"><td colSpan={4} className="px-3 py-3 text-right text-xs font-bold uppercase tracking-[0.12em]">Total Qty</td><td colSpan={5} className="px-3 py-3 font-bold">{formatQuantity(portionSummary.total)}</td></tr>
                                        <tr className="border-t border-border"><td colSpan={4} className="px-3 py-3 text-center text-xs font-bold uppercase tracking-[0.12em]">Selling Price/Pax</td><td colSpan={5} className="px-3 py-3 font-bold">{formatPrice(sellingPricePerPax)}</td></tr>
                                        <tr className="border-t border-border"><td colSpan={4} className="px-3 py-3 text-center text-xs font-bold uppercase tracking-[0.12em]">Pax Calculation</td><td colSpan={5} className="px-3 py-3 font-bold">{sellingQuantity ?? '-'}</td></tr>
                                        <tr className="border-t border-border"><td colSpan={4} className="px-3 py-3 text-center text-xs font-bold uppercase tracking-[0.12em]">Estimated Revenue</td><td colSpan={5} className="px-3 py-3 font-bold">{formatPrice(estimatedRevenue)}</td></tr>
                                        <tr className="border-t border-border"><td colSpan={4} className="px-3 py-3 text-center text-xs font-bold uppercase tracking-[0.12em]">Food Cost Percentage</td><td colSpan={5} className="px-3 py-3 font-bold">{foodCostPercentage === undefined ? '-' : `${foodCostPercentage.toFixed(2)}%`}</td></tr>
                                        {groupSales.length > 0 ? <>
                                          <tr className="border-y border-primary bg-primary text-xs font-bold uppercase tracking-[0.12em] text-white"><td colSpan={2} className="px-3 py-3">Menu Group Summary</td><td>Qty</td><td>Selling Price/Pax</td><td colSpan={2}>Estimated Revenue</td><td colSpan={3}>Cost Contribution (%)</td></tr>
                                          {groupSales.map((sale) => {
                                            const groupCost = group.items.reduce((total, menu) => (menu.group?.trim() || '-') === sale.name ? total + (Number.isFinite(Number(menu.estimatedCost)) ? Number(menu.estimatedCost) : Number.isFinite(Number(menu.cost)) ? Number(menu.cost) : 0) : total, 0)
                                            return <tr key={`sales-${sale.name}`} className="border-t border-border"><td colSpan={2} className="px-3 py-3 text-right font-semibold">{sale.name}</td><td>{formatQuantity(sale.quantity)}</td><td>{formatPrice(sale.sellingPricePerPax)}</td><td colSpan={2}>{formatPrice(sale.estimatedRevenue)}</td><td colSpan={3}>{formatFoodCostPercentage(groupCost, groupSalesRevenue)}</td></tr>
                                          })}
                                        </> : null}
                                      </tfoot>
                                    </table>
                                  </div>
                                  {group.missingRecipes.length > 0 ? <p className="mt-3 text-xs text-danger">Recipe not found for: {group.missingRecipes.join(', ')}</p> : null}
                                </section>
                                <section>
                                  <h3 className="text-sm font-semibold text-foreground">Ingredient requirements per menu</h3>
                                  <div className="mt-3 space-y-3">
                                    {group.items.map((menu) => (
                                      <article key={`ingredients-${menu.id}`}>
                                        <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                                          <div><p className="font-semibold text-foreground">{menu.menuName}</p><p className="mt-1 text-xs text-muted">{menu.recipeCode ?? '-'} · {menu.category} · {menu.portion} pax</p></div>
                                          <span className="rounded-full bg-primary-soft px-2 py-1 text-xs font-semibold text-primary">{menu.ingredients.length} ingredients</span>
                                        </div>
                                        <div className="overflow-hidden rounded-md border border-border bg-white">
                                          <table className="dm-table !w-full !table-fixed text-sm [&_td]:!whitespace-normal [&_th]:!whitespace-normal">
                                            <thead className="bg-background"><tr className="text-left text-xs uppercase tracking-[0.18em] text-muted"><th className="px-3 py-3 font-semibold">No</th><th className="px-3 py-3 font-semibold">Product code</th><th className="px-3 py-3 font-semibold">Ingredient name</th><th className="px-3 py-3 font-semibold">Qty</th><th className="px-3 py-3 font-semibold">Unit</th><th className="px-3 py-3 font-semibold">Vendor</th><th className="px-3 py-3 font-semibold">Price</th><th className="px-3 py-3 font-semibold">Ingredient Cost</th></tr></thead>
                                            <tbody>{menu.ingredients.length === 0 ? <tr className="border-t border-border"><td colSpan={8} className="px-4 py-5 text-center text-muted">No ingredients available.</td></tr> : menu.ingredients.map((ingredient, ingredientIndex) => <tr key={`${menu.id}-${ingredient.productCode}-${ingredientIndex}`} className="border-t border-border"><td className="px-3 py-3 text-muted">{ingredientIndex + 1}</td><td className="break-all px-3 py-3">{ingredient.productCode || '-'}</td><td className="break-words px-3 py-3 font-medium">{ingredient.name || '-'}</td><td className="px-3 py-3">{formatQuantity(ingredient.qty)}</td><td className="break-words px-3 py-3">{formatUnitLabel(ingredient.unitOfMeasures)}</td><td className="break-words px-3 py-3">{ingredient.vendor ?? '-'}</td><td className="break-words px-3 py-3 font-medium">{formatPrice(ingredient.price)}</td><td className="break-words px-3 py-3 font-medium">{formatPrice(ingredient.ingredientCost)}</td></tr>)}</tbody>
                                          </table>
                                        </div>
                                      </article>
                                    ))}
                                  </div>
                                </section>
                                <section>
                                  <h3 className="text-sm font-semibold text-foreground">Ingredient summary</h3>
                                  <div className="mt-3 overflow-hidden rounded-md border border-border bg-white">
                                    <table className="dm-table !w-full !table-fixed text-sm [&_td]:!whitespace-normal [&_th]:!whitespace-normal">
                                      <thead className="bg-background">
                                        <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                                          <th className="px-3 py-3 font-semibold">No</th>
                                          <th className="px-3 py-3 font-semibold">Product code</th>
                                          <th className="px-3 py-3 font-semibold">Ingredient name</th>
                                          <th className="px-3 py-3 font-semibold">Qty</th>
                                          <th className="px-3 py-3 font-semibold">Unit</th>
                                          <th className="px-3 py-3 font-semibold">Vendor</th>
                                          <th className="px-3 py-3 font-semibold">Price</th>
                                          <th className="px-3 py-3 font-semibold">Ingredient Cost</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {summaryItems.length === 0 ? (
                                          <tr className="border-t border-border">
                                            <td
                                              colSpan={8}
                                              className="px-4 py-6 text-center text-muted"
                                            >
                                              No ingredient summary available.
                                            </td>
                                          </tr>
                                        ) : (
                                          summaryItems.map((ingredient, idx) => (
                                            <tr
                                              key={`${ingredient.productCode}-${ingredient.unitOfMeasures}-${idx}`}
                                              className="border-t border-border"
                                            >
                                              <td className="px-3 py-3 text-sm text-muted">
                                                {idx + 1}
                                              </td>
                                              <td className="break-all px-3 py-3">
                                                {ingredient.productCode}
                                              </td>
                                              <td className="break-words px-3 py-3 font-medium">
                                                {ingredient.name}
                                              </td>
                                              <td className="px-3 py-3">
                                                {formatQuantity(ingredient.qty)}
                                              </td>
                                              <td className="break-words px-3 py-3">
                                                {formatUnitLabel(
                                                  ingredient.unitOfMeasures,
                                                )}
                                              </td>
                                              <td className="break-words px-3 py-3">{ingredient.vendor ?? '-'}</td>
                                              <td className="break-words px-3 py-3 font-medium">{formatPrice(ingredient.price)}</td>
                                              <td className="break-words px-3 py-3 font-medium">{formatPrice(ingredient.ingredientCost)}</td>
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
              </LoadingTableBody>
            </table>
          </div>
          </div>
        </section>
      )}
      </div>

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
                  {overrideAction.kind === 'recipe'
                    ? 'Record type'
                    : overrideAction.kind === 'menu-item'
                      ? 'Menus affected'
                      : 'Menus affected'}
                </p>
                <p className="mt-2 text-sm font-semibold text-foreground">
                  {overrideAction.kind === 'recipe'
                    ? 'Recipe'
                    : overrideAction.kind === 'menu-item'
                      ? 1
                      : overrideAction.group.items.filter(
                          (item) => item.approvalStatus !== overrideAction.nextStatus,
                        ).length}
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-md border border-warning/40 bg-warning/10 p-4 text-sm text-warning">
              {corporateOnly
                ? 'This follows the normal recipe review flow used by the Unit Manager.'
              : overrideAction.kind === 'recipe'
                ? 'This changes the recipe approval state outside the normal Unit Manager review flow.'
                : overrideAction.kind === 'menu-item'
                  ? 'This changes the menu approval state outside the normal Unit Manager review flow and resets related store request or actual qty data for this menu.'
                  : 'This changes production menu approval outside the normal Unit Manager review flow and resets related store request or actual qty data for affected menus.'}
            </div>

            {(overrideAction.kind === 'recipe' || overrideAction.kind === 'menu-item') &&
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
                  placeholder={overrideAction.kind === 'menu-item'
                    ? 'Explain why this menu is being rejected.'
                    : corporateOnly
                      ? 'Explain why this recipe is rejected.'
                      : 'Explain why this recipe approval is being overridden.'}
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
