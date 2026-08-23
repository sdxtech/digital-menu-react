import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { apiFetch } from './api'
import { readStoredToken, useAuth } from './auth'
import { getRecipeVersion } from './recipe-version'

export type ApprovalStatus = 'pending' | 'approved' | 'rejected'
export type RecipeStatus = 'draft' | 'active'
export type StoreRequestStatus =
  | 'not-requested'
  | 'requested'
  | 'fulfilled'
  | 'cancelled'

export type RecipeIngredient = {
  ingredientType?: 'IT' | 'NMP'
  productCode: string
  name: string
  unitOfMeasures: string
  qty: number
  prodQty?: number
  prodUomCode?: string
  srQty?: number
  srQtyManual?: boolean
  srUomCode?: string
  conversionId?: string
  conversionMultiplier?: number
  priceUom?: number
  foodCost?: number
}

export type RecipeApprovalHistoryEntry = {
  rejectionReason: string
  rejectedBy?: string
  rejectedByName?: string
  rejectedByEmail?: string
  rejectedAt?: string
  resubmissionFeedback?: string
  resubmittedBy?: string
  resubmittedByName?: string
  resubmittedByEmail?: string
  resubmittedAt?: string
}

export type Recipe = {
  id: string
  recipeCode?: string
  name: string
  version: number
  versionGroupId?: string
  parentRecipeId?: string
  category: string
  description: string
  imageUrl?: string
  price: number
  portionSize: number
  status: RecipeStatus
  approvalStatus: ApprovalStatus
  isActive: boolean
  ingredients: RecipeIngredient[]
  createdAt: string
  updatedAt?: string
  createdBy?: string
  createdByName?: string
  createdByEmail?: string
  updatedBy?: string
  updatedByName?: string
  updatedByEmail?: string
  reviewedBy?: string
  reviewedByName?: string
  reviewedByEmail?: string
  reviewedAt?: string
  rejectionReason?: string
  approvalHistory?: RecipeApprovalHistoryEntry[]
  site?: string
  siteName?: string
}

export type MenuProduction = {
  id: string
  productionCode?: string
  recipeId?: string
  recipeCode?: string
  recipeVersion?: number
  menuName: string
  category: string
  site?: string
  clientId?: string
  clientName?: string
  unitManagerId?: string
  assistedBy?: string
  portion: number
  cost?: number
  estimatedTotalCost?: number
  estimatedCostPerPax?: number
  sellingPricePerPax?: number
  sellingQuantity?: number
  estimatedRevenue?: number
  productionDate: string
  approvalStatus: ApprovalStatus
  rejectionReason?: string
  storeRequestStatus: StoreRequestStatus
  createdAt: string
}

export type RawMaterial = {
  id: string
  productCode: string
  name: string
  unitOfMeasures: string
  baseUnitOfMeasures?: string
  conversionFactor?: number
  specificConversions?: RawMaterialSpecificConversion[]
  vendor?: string
  createdAt: string
}

export type RawMaterialSpecificConversion = {
  prodUomCode: string
  srUomCode: string
  conversionFactor: number
}

type RecipeApi = Omit<Recipe, 'id'> & { id?: string; _id?: string }
type MenuProductionApi = Omit<MenuProduction, 'id'> & { id?: string; _id?: string }

type ChefDataState = {
  recipes: Recipe[]
  menuProductions: MenuProduction[]
  rawMaterials: RawMaterial[]
}

type CreateRecipeInput = {
  site?: string
  baseRecipeId?: string
  name: string
  category: string
  description: string
  imageUrl?: string
  price: number
  portionSize: number
  status: RecipeStatus
  ingredients: RecipeIngredient[]
}

type UpdateRecipeInput = {
  name?: string
  category?: string
  description?: string
  imageUrl?: string
  price?: number
  portionSize?: number
  ingredients?: RecipeIngredient[]
}

type AddMenuProductionInput = {
  recipeId: string
  menuName: string
  category: string
  site?: string
  clientId?: string
  clientName?: string
  chefId?: string
  unitManagerId?: string
  portion: number
  cost: number
  ingredientVendors?: Array<{
    ingredientIndex?: number
    productCode?: string
    name?: string
    unitOfMeasures?: string
    vendor?: string
    site?: string
    currency?: string
    minimumQuantity?: number
    price?: number
  }>
  productionDate: string
}

type AddRawMaterialInput = {
  productCode: string
  name: string
  unitOfMeasures: string
}

type UpdateRawMaterialInput = AddRawMaterialInput

type FulfillStoreRequestBatchInput = {
  menuProductionIds: string[]
  items: Array<{
    productCode: string
    name: string
    unitOfMeasures: string
    vendor?: string
    vendorSite?: string
    actualQty: number
    actualPrice?: number
    reason?: string
  }>
  note?: string
}

type CancelStoreRequestBatchInput = {
  menuProductionIds: string[]
  reason: string
}

type CancelPendingMenuProductionBatchInput = {
  menuProductionIds: string[]
}

type RawMaterialsMeta = {
  page: number
  limit: number
  total: number
  totalPages: number
  loading: boolean
  error: string
}

type SiteScopedFetchOptions = {
  site?: string
}

type RecipeSearchOptions = SiteScopedFetchOptions & {
  limit?: number
}

type ChefDataContextValue = ChefDataState & {
  createRecipe: (input: CreateRecipeInput) => Promise<Recipe>
  updateRecipe: (id: string, input: UpdateRecipeInput) => Promise<void>
  importRecipesFromExcel: (file: File) => Promise<number>
  approveRecipe: (id: string) => Promise<void>
  rejectRecipe: (id: string, reason: string) => Promise<void>
  resubmitRecipe: (id: string, feedback: string) => Promise<void>
  addMenuProduction: (input: AddMenuProductionInput) => Promise<void>
  addMenuProductionsBulk: (inputs: AddMenuProductionInput[]) => Promise<void>
  updateMenuProductionSalesDetails: (
    id: string,
    input: { sellingPricePerPax: number; sellingQuantity: number },
  ) => Promise<void>
  updateMenuProductionBatchSalesDetails: (
    productionCode: string,
    input: { sellingPricePerPax: number; sellingQuantity: number },
  ) => Promise<void>
  approveMenuProduction: (id: string) => Promise<void>
  rejectMenuProduction: (id: string, reason: string) => Promise<void>
  rawMaterialsMeta: RawMaterialsMeta
  fetchRawMaterials: (page?: number, limit?: number, search?: string) => Promise<void>
  searchRawMaterials: (search: string, limit?: number, site?: string) => Promise<RawMaterial[]>
  addRawMaterial: (input: AddRawMaterialInput) => Promise<void>
  updateRawMaterial: (id: string, input: UpdateRawMaterialInput) => Promise<void>
  importRawMaterialsFromExcel: (file: File) => Promise<string>
  markStoreRequested: (menuProductionId: string) => Promise<void>
  markStoreFulfilled: (menuProductionId: string) => Promise<void>
  fulfillStoreRequestBatch: (input: FulfillStoreRequestBatchInput) => Promise<void>
  cancelStoreRequestBatch: (input: CancelStoreRequestBatchInput) => Promise<void>
  cancelPendingMenuProductionBatch: (
    input: CancelPendingMenuProductionBatchInput,
  ) => Promise<void>
  fetchRecipes: (options?: SiteScopedFetchOptions) => Promise<Recipe[]>
  searchRecipes: (search: string, options?: RecipeSearchOptions) => Promise<Recipe[]>
  fetchMenuProductions: (
    options?: SiteScopedFetchOptions,
  ) => Promise<MenuProduction[]>
}

const initialState: ChefDataState = {
  recipes: [],
  menuProductions: [],
  rawMaterials: [],
}

const ChefDataContext = createContext<ChefDataContextValue | undefined>(undefined)

const makeId = (prefix: string) => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

const pickId = (id: string | undefined, fallbackPrefix: string) =>
  id ?? makeId(fallbackPrefix)

// FRONTEND MAPPER: status/approval values come from backend.
const mapRecipe = (item: RecipeApi): Recipe => {
  const approvalStatus = item.approvalStatus ?? 'pending'

  return {
    id: pickId(item.id ?? item._id, 'recipe'),
    recipeCode: item.recipeCode ?? undefined,
    name: item.name ?? '',
    version: getRecipeVersion(item.version),
    versionGroupId: item.versionGroupId ?? undefined,
    parentRecipeId: item.parentRecipeId ?? undefined,
    category: item.category ?? '',
    description: item.description ?? '',
    imageUrl: item.imageUrl ?? undefined,
    price: Number.isFinite(Number(item.price)) ? Number(item.price) : 0,
    portionSize: Number.isFinite(Number(item.portionSize))
      ? Number(item.portionSize)
      : 1,
    status: (item.status ?? 'draft') as RecipeStatus,
    approvalStatus,
    isActive: item.isActive !== false,
    ingredients: Array.isArray(item.ingredients)
      ? item.ingredients.map((ingredient) => ({
          ingredientType: ingredient.ingredientType,
          productCode: ingredient.productCode ?? '',
          name: ingredient.name ?? '',
          unitOfMeasures: ingredient.unitOfMeasures ?? '',
          qty: Number.isFinite(Number(ingredient.qty))
            ? Number(ingredient.qty)
            : 0,
          priceUom: Number.isFinite(Number(ingredient.priceUom))
            ? Number(ingredient.priceUom)
            : undefined,
          foodCost: Number.isFinite(Number(ingredient.foodCost))
            ? Number(ingredient.foodCost)
            : undefined,
        }))
      : [],
    createdAt: item.createdAt ?? new Date().toISOString(),
    updatedAt: item.updatedAt ?? item.createdAt ?? new Date().toISOString(),
    createdBy: item.createdBy ?? '',
    createdByName: item.createdByName ?? '',
    createdByEmail: item.createdByEmail ?? '',
    updatedBy: item.updatedBy ?? '',
    updatedByName: item.updatedByName ?? '',
    updatedByEmail: item.updatedByEmail ?? '',
    reviewedBy: item.reviewedBy ?? '',
    reviewedByName: item.reviewedByName ?? '',
    reviewedByEmail: item.reviewedByEmail ?? '',
    reviewedAt: item.reviewedAt ?? '',
    rejectionReason: item.rejectionReason ?? '',
    approvalHistory: Array.isArray(item.approvalHistory)
      ? item.approvalHistory.map((entry) => ({
          rejectionReason: entry.rejectionReason ?? '',
          rejectedBy: entry.rejectedBy ?? '',
          rejectedByName: entry.rejectedByName ?? '',
          rejectedByEmail: entry.rejectedByEmail ?? '',
          rejectedAt: entry.rejectedAt ?? '',
          resubmissionFeedback: entry.resubmissionFeedback ?? '',
          resubmittedBy: entry.resubmittedBy ?? '',
          resubmittedByName: entry.resubmittedByName ?? '',
          resubmittedByEmail: entry.resubmittedByEmail ?? '',
          resubmittedAt: entry.resubmittedAt ?? '',
        }))
      : [],
    site: item.site ?? undefined,
    siteName: item.siteName ?? undefined,
  }
}

const mapMenuProduction = (item: MenuProductionApi): MenuProduction => ({
  id: pickId(item.id ?? item._id, 'menu-production'),
  productionCode: item.productionCode ?? undefined,
  recipeId: item.recipeId ?? undefined,
  recipeCode: item.recipeCode ?? undefined,
  recipeVersion: getRecipeVersion(item.recipeVersion),
  menuName: item.menuName ?? '',
  category: item.category ?? '',
  site: item.site ?? undefined,
  unitManagerId: item.unitManagerId ?? undefined,
  assistedBy: item.assistedBy ?? undefined,
  portion: Number.isFinite(Number(item.portion)) ? Number(item.portion) : 0,
  cost: Number.isFinite(Number(item.cost)) ? Number(item.cost) : undefined,
  estimatedTotalCost: Number.isFinite(Number(item.estimatedTotalCost))
    ? Number(item.estimatedTotalCost)
    : undefined,
  estimatedCostPerPax: Number.isFinite(Number(item.estimatedCostPerPax))
    ? Number(item.estimatedCostPerPax)
    : undefined,
  sellingPricePerPax: Number.isFinite(Number(item.sellingPricePerPax))
    ? Number(item.sellingPricePerPax)
    : undefined,
  sellingQuantity: Number.isFinite(Number(item.sellingQuantity))
    ? Number(item.sellingQuantity)
    : undefined,
  estimatedRevenue: Number.isFinite(Number(item.estimatedRevenue))
    ? Number(item.estimatedRevenue)
    : undefined,
  productionDate: item.productionDate ?? '',
  approvalStatus: item.approvalStatus ?? 'pending',
  rejectionReason: item.rejectionReason ?? undefined,
  storeRequestStatus: item.storeRequestStatus ?? 'not-requested',
  createdAt: item.createdAt ?? new Date().toISOString(),
})

const mapRawMaterial = (item: RawMaterial & { _id?: string }): RawMaterial => ({
  id: item.id || item._id || makeId('raw-material'),
  productCode: item.productCode,
  name: item.name,
  unitOfMeasures: item.unitOfMeasures,
  baseUnitOfMeasures: item.baseUnitOfMeasures,
  conversionFactor: Number.isFinite(Number(item.conversionFactor))
    ? Number(item.conversionFactor)
    : undefined,
  specificConversions: Array.isArray(item.specificConversions)
    ? item.specificConversions
        .map((rule) => ({
          prodUomCode: rule.prodUomCode ?? '',
          srUomCode: rule.srUomCode ?? '',
          conversionFactor: Number(rule.conversionFactor),
        }))
        .filter(
          (rule) =>
            rule.prodUomCode &&
            rule.srUomCode &&
            Number.isFinite(rule.conversionFactor) &&
            rule.conversionFactor > 0,
        )
    : [],
  vendor: item.vendor,
  createdAt: item.createdAt,
})

const upsertById = <T extends { id: string }>(items: T[], next: T) => {
  const idx = items.findIndex((item) => item.id === next.id)
  if (idx === -1) return [next, ...items]
  const copy = [...items]
  copy[idx] = next
  return copy
}

export const ChefDataProvider = ({ children }: { children: ReactNode }) => {
  const { accessToken, user } = useAuth()
  const [state, setState] = useState<ChefDataState>(initialState)
  const [rawMaterialsMeta, setRawMaterialsMeta] = useState<RawMaterialsMeta>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
    loading: false,
    error: '',
  })

  const fetchRecipes = useCallback(async (options?: SiteScopedFetchOptions) => {
    if (!accessToken) return []

    const params = new URLSearchParams()
    if (options?.site?.trim()) params.set('site', options.site.trim())
    const query = params.toString()
    const data = await apiFetch<{ items: RecipeApi[] } | RecipeApi[]>(
      query ? `/recipes?${query}` : '/recipes',
      undefined,
      accessToken,
    )
    const items = Array.isArray(data) ? data : data.items ?? []
    const mapped = items.map(mapRecipe)
    setState((prev) => ({
      ...prev,
      recipes: mapped,
    }))
    return mapped
  }, [accessToken])

  const searchRecipes = useCallback(async (
    search: string,
    options?: RecipeSearchOptions,
  ) => {
    if (!accessToken || !search.trim()) return []

    const params = new URLSearchParams({
      search: search.trim(),
      limit: String(options?.limit ?? 20),
    })
    if (options?.site?.trim()) params.set('site', options.site.trim())

    const data = await apiFetch<{ items: RecipeApi[] } | RecipeApi[]>(
      `/recipes?${params.toString()}`,
      undefined,
      accessToken,
    )
    const items = Array.isArray(data) ? data : data.items ?? []
    return items.map(mapRecipe)
  }, [accessToken])

  const fetchMenuProductions = useCallback(async (options?: SiteScopedFetchOptions) => {
    if (!accessToken) return []

    const params = new URLSearchParams()
    if (options?.site?.trim()) params.set('site', options.site.trim())
    const query = params.toString()
    const data = await apiFetch<{ items: MenuProductionApi[] } | MenuProductionApi[]>(
      query ? `/menu-productions?${query}` : '/menu-productions',
      undefined,
      accessToken,
    )
    const items = Array.isArray(data) ? data : data.items ?? []
    const mapped = items.map(mapMenuProduction)
    setState((prev) => ({
      ...prev,
      menuProductions: mapped,
    }))
    return mapped
  }, [accessToken])

  useEffect(() => {
    if (!accessToken) {
      setState((prev) => ({ ...prev, recipes: [], menuProductions: [] }))
      return
    }
    if (user?.role === 'superadmin') {
      setState((prev) => ({ ...prev, recipes: [], menuProductions: [] }))
      return
    }
    fetchRecipes().catch(() => null)
    fetchMenuProductions().catch(() => null)
  }, [accessToken, fetchMenuProductions, fetchRecipes, user?.role])

  const createRecipe = async (input: CreateRecipeInput) => {
    if (!accessToken) {
      throw new Error('Please log in first to save data to the database.')
    }

    const created = await apiFetch<RecipeApi>(
      '/recipes',
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
      accessToken,
    )
    const mapped = mapRecipe(created)
    setState((prev) => ({
      ...prev,
      recipes: upsertById(prev.recipes, mapped),
    }))
    return mapped
  }

  const updateRecipe = async (id: string, input: UpdateRecipeInput) => {
    if (!accessToken) {
      throw new Error('Please log in first to save data to the database.')
    }

    const updated = await apiFetch<RecipeApi>(
      `/recipes/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      },
      accessToken,
    )
    const mapped = mapRecipe(updated)
    setState((prev) => ({
      ...prev,
      recipes: upsertById(prev.recipes, mapped),
    }))
  }

  const importRecipesFromExcel = async (file: File) => {
    if (!accessToken) {
      throw new Error('Please log in first to save data to the database.')
    }
    const formData = new FormData()
    formData.append('file', file)

    const result = await apiFetch<{ insertedCount: number }>(
      '/recipes/import',
      {
        method: 'POST',
        body: formData,
      },
      accessToken,
    )

    await fetchRecipes()
    return result.insertedCount ?? 0
  }

  const approveRecipe = async (id: string) => {
    if (!accessToken) {
      throw new Error('Please log in first to save data to the database.')
    }
    const updated = await apiFetch<RecipeApi>(
      `/recipes/${id}/approve`,
      { method: 'PATCH' },
      accessToken,
    )
    const mapped = mapRecipe(updated)
    setState((prev) => ({
      ...prev,
      recipes: upsertById(prev.recipes, mapped),
    }))
  }

  const rejectRecipe = async (id: string, reason: string) => {
    if (!accessToken) {
      throw new Error('Please log in first to save data to the database.')
    }
    const updated = await apiFetch<RecipeApi>(
      `/recipes/${id}/reject`,
      {
        method: 'PATCH',
        body: JSON.stringify({ reason }),
      },
      accessToken,
    )
    const mapped = mapRecipe(updated)
    setState((prev) => ({
      ...prev,
      recipes: upsertById(prev.recipes, mapped),
    }))
  }

  const resubmitRecipe = async (id: string, feedback: string) => {
    if (!accessToken) {
      throw new Error('Please log in first to save data to the database.')
    }
    const updated = await apiFetch<RecipeApi>(
      `/recipes/${id}/resubmit`,
      {
        method: 'PATCH',
        body: JSON.stringify({ feedback }),
      },
      accessToken,
    )
    const mapped = mapRecipe(updated)
    setState((prev) => ({
      ...prev,
      recipes: upsertById(prev.recipes, mapped),
    }))
  }

  const addMenuProduction = async (input: AddMenuProductionInput) => {
    if (!accessToken) {
      throw new Error('Please log in first to save data to the database.')
    }
    const created = await apiFetch<MenuProductionApi>(
      '/menu-productions',
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
      accessToken,
    )
    const mapped = mapMenuProduction(created)
    setState((prev) => ({
      ...prev,
      menuProductions: upsertById(prev.menuProductions, mapped),
    }))
  }

  const addMenuProductionsBulk = async (inputs: AddMenuProductionInput[]) => {
    if (!accessToken) {
      throw new Error('Please log in first to save data to the database.')
    }
    if (!inputs.length) return

    const created = await apiFetch<
      MenuProductionApi[] | { items?: MenuProductionApi[] }
    >(
      '/menu-productions/bulk',
      {
        method: 'POST',
        body: JSON.stringify({ items: inputs }),
      },
      accessToken,
    )

    const items = Array.isArray(created) ? created : created.items ?? []
    const mappedItems = items.map(mapMenuProduction)
    setState((prev) => {
      let nextMenuProductions = prev.menuProductions
      mappedItems.forEach((item) => {
        nextMenuProductions = upsertById(nextMenuProductions, item)
      })
      return {
        ...prev,
        menuProductions: nextMenuProductions,
      }
    })
  }

  const approveMenuProduction = async (id: string) => {
    if (!accessToken) {
      throw new Error('Please log in first to save data to the database.')
    }
    const updated = await apiFetch<MenuProductionApi>(
      `/menu-productions/${id}/approve`,
      { method: 'PATCH' },
      accessToken,
    )
    const mapped = mapMenuProduction(updated)
    setState((prev) => ({
      ...prev,
      menuProductions: upsertById(prev.menuProductions, mapped),
    }))
  }

  const rejectMenuProduction = async (id: string, reason: string) => {
    if (!accessToken) {
      throw new Error('Please log in first to save data to the database.')
    }
    const updated = await apiFetch<MenuProductionApi>(
      `/menu-productions/${id}/reject`,
      {
        method: 'PATCH',
        body: JSON.stringify({ reason }),
      },
      accessToken,
    )
    const mapped = mapMenuProduction(updated)
    setState((prev) => ({
      ...prev,
      menuProductions: upsertById(prev.menuProductions, mapped),
    }))
  }

  const updateMenuProductionSalesDetails = async (
    id: string,
    input: { sellingPricePerPax: number; sellingQuantity: number },
  ) => {
    if (!accessToken) {
      throw new Error('Please log in first to save data to the database.')
    }
    const updated = await apiFetch<MenuProductionApi>(
      `/menu-productions/${id}/sales-details`,
      { method: 'PATCH', body: JSON.stringify(input) },
      accessToken,
    )
    const mapped = mapMenuProduction(updated)
    setState((prev) => ({
      ...prev,
      menuProductions: upsertById(prev.menuProductions, mapped),
    }))
  }

  const updateMenuProductionBatchSalesDetails = async (
    productionCode: string,
    input: { sellingPricePerPax: number; sellingQuantity: number },
  ) => {
    if (!accessToken) {
      throw new Error('Please log in first to save data to the database.')
    }
    const updated = await apiFetch<MenuProductionApi[]>(
      '/menu-productions/batch/sales-details',
      {
        method: 'PATCH',
        body: JSON.stringify({ productionCode, ...input }),
      },
      accessToken,
    )
    const mapped = updated.map(mapMenuProduction)
    setState((prev) => ({
      ...prev,
      menuProductions: mapped.reduce(
        (items, item) => upsertById(items, item),
        prev.menuProductions,
      ),
    }))
  }

  const addRawMaterial = (input: AddRawMaterialInput) => {
    if (!accessToken) {
      return Promise.reject(
        new Error('Please log in first to save data to the database.'),
      )
    }

    return apiFetch<RawMaterial>(
      '/raw-materials',
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
      accessToken,
    ).then(() => undefined)
  }

  const updateRawMaterial = async (id: string, input: UpdateRawMaterialInput) => {
    if (!accessToken) {
      throw new Error('Please log in first to save data to the database.')
    }

    const updated = await apiFetch<RawMaterial & { _id?: string }>(
      `/raw-materials/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      },
      accessToken,
    )

    const mapped: RawMaterial = {
      id: updated.id || updated._id || id,
      productCode: updated.productCode ?? input.productCode,
      name: updated.name ?? input.name,
      unitOfMeasures: updated.unitOfMeasures ?? input.unitOfMeasures,
      createdAt: updated.createdAt ?? new Date().toISOString(),
    }

    setState((prev) => ({
      ...prev,
      rawMaterials: upsertById(prev.rawMaterials, mapped),
    }))
  }

  const importRawMaterialsFromExcel = async (file: File) => {
    if (!accessToken) {
      throw new Error('Please log in first to save data to the database.')
    }
    const formData = new FormData()
    formData.append('file', file)

    const job = await apiFetch<{ jobId: string }>(
      '/imports/raw-materials/upload',
      {
        method: 'POST',
        body: formData,
      },
      accessToken,
    )

    return job.jobId
  }

  const fetchRawMaterials = useCallback(
    async (page = 1, limit = 10, search?: string) => {
      const token = accessToken ?? readStoredToken()
      if (!token) {
        setRawMaterialsMeta((prev) => ({
          ...prev,
          loading: false,
          error: 'Please log in first to load raw material data.',
        }))
        return
      }

      const safeLimit = Math.min(limit, 100)
      setRawMaterialsMeta((prev) => ({
        ...prev,
        loading: true,
        error: '',
      }))

      try {
        const params = new URLSearchParams()
        params.set('page', String(page))
        params.set('limit', String(safeLimit))
        if (search?.trim()) params.set('search', search.trim())
        if (user?.site?.trim()) params.set('site', user.site.trim())

        const data = await apiFetch<{
          items: Array<RawMaterial & { _id?: string }>
          total: number
          page: number
          limit: number
          totalPages?: number
        }>(`/raw-materials?${params.toString()}`, undefined, token)

        const mapped = (data.items ?? []).map(mapRawMaterial)

        setState((prev) => ({
          ...prev,
          rawMaterials: mapped,
        }))
        setRawMaterialsMeta({
          page: data.page ?? page,
          limit: data.limit ?? safeLimit,
          total: data.total ?? 0,
          totalPages:
            data.totalPages ??
            Math.max(1, Math.ceil((data.total ?? 0) / safeLimit)),
          loading: false,
          error: '',
        })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to load data.'
        setRawMaterialsMeta((prev) => ({
          ...prev,
          loading: false,
          error: message,
        }))
      }
    },
    [accessToken, user?.site],
  )

  const searchRawMaterials = useCallback(
    async (search: string, limit = 5, site?: string) => {
      const token = accessToken ?? readStoredToken()
      if (!token) return []

      const safeLimit = Math.min(limit, 100)
      const params = new URLSearchParams()
      params.set('page', '1')
      params.set('limit', String(safeLimit))
      if (search?.trim()) params.set('search', search.trim())
      const effectiveSite = site?.trim() || user?.site?.trim()
      if (effectiveSite) params.set('site', effectiveSite)

      const data = await apiFetch<{
        items: Array<RawMaterial & { _id?: string }>
        total: number
        page: number
        limit: number
        totalPages?: number
      }>(`/raw-materials?${params.toString()}`, undefined, token)

      return (data.items ?? []).map(mapRawMaterial)
    },
    [accessToken, user?.site],
  )

  const markStoreRequested = async (menuProductionId: string) => {
    if (!accessToken) {
      throw new Error('Please log in first to save data to the database.')
    }
    const updated = await apiFetch<MenuProductionApi>(
      `/menu-productions/${menuProductionId}/store-request`,
      { method: 'PATCH' },
      accessToken,
    )
    const mapped = mapMenuProduction(updated)
    setState((prev) => ({
      ...prev,
      menuProductions: upsertById(prev.menuProductions, mapped),
    }))
  }

  const markStoreFulfilled = async (menuProductionId: string) => {
    if (!accessToken) {
      throw new Error('Please log in first to save data to the database.')
    }
    const updated = await apiFetch<MenuProductionApi>(
      `/menu-productions/${menuProductionId}/fulfill`,
      { method: 'PATCH' },
      accessToken,
    )
    const mapped = mapMenuProduction(updated)
    setState((prev) => ({
      ...prev,
      menuProductions: upsertById(prev.menuProductions, mapped),
    }))
  }

  const fulfillStoreRequestBatch = async (input: FulfillStoreRequestBatchInput) => {
    if (!accessToken) {
      throw new Error('Please log in first to save data to the database.')
    }

    await apiFetch(
      '/menu-productions/fulfill-batch',
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      },
      accessToken,
    )

    await fetchMenuProductions()
  }

  const cancelStoreRequestBatch = async (input: CancelStoreRequestBatchInput) => {
    if (!accessToken) {
      throw new Error('Please log in first to save data to the database.')
    }

    await apiFetch(
      '/menu-productions/cancel-batch',
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      },
      accessToken,
    )

    await fetchMenuProductions()
  }

  const cancelPendingMenuProductionBatch = async (
    input: CancelPendingMenuProductionBatchInput,
  ) => {
    if (!accessToken) {
      throw new Error('Please log in first to save data to the database.')
    }

    await apiFetch(
      '/menu-productions/cancel-pending-batch',
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      },
      accessToken,
    )

    await fetchMenuProductions()
  }

  const value = {
    ...state,
    addRawMaterial,
    updateRawMaterial,
    createRecipe,
    updateRecipe,
    importRecipesFromExcel,
    approveRecipe,
    rejectRecipe,
    resubmitRecipe,
    addMenuProduction,
    addMenuProductionsBulk,
    updateMenuProductionSalesDetails,
    updateMenuProductionBatchSalesDetails,
    approveMenuProduction,
    rejectMenuProduction,
    importRawMaterialsFromExcel,
    fetchRawMaterials,
    searchRawMaterials,
    rawMaterialsMeta,
    markStoreRequested,
    markStoreFulfilled,
    fulfillStoreRequestBatch,
    cancelStoreRequestBatch,
    cancelPendingMenuProductionBatch,
    fetchRecipes,
    searchRecipes,
    fetchMenuProductions,
  }

  return (
    <ChefDataContext.Provider value={value}>{children}</ChefDataContext.Provider>
  )
}

export const useChefData = () => {
  const context = useContext(ChefDataContext)
  if (!context) {
    throw new Error('useChefData must be used within ChefDataProvider')
  }
  return context
}
