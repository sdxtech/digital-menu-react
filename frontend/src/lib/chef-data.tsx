import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { apiFetch } from './api'
import { readStoredToken, useAuth } from './auth'

export type ApprovalStatus = 'pending' | 'approved' | 'rejected'
export type RecipeStatus = 'draft' | 'active'
export type StoreRequestStatus = 'not-requested' | 'requested' | 'fulfilled'

export type RecipeIngredient = {
  productCode: string
  name: string
  unitOfMeasures: string
  qty: number
}

export type Recipe = {
  id: string
  name: string
  category: string
  description: string
  imageUrl?: string
  price: number
  portionSize: number
  status: RecipeStatus
  approvalStatus: ApprovalStatus
  ingredients: RecipeIngredient[]
  createdAt: string
  updatedAt?: string
  createdBy?: string
  createdByName?: string
  createdByEmail?: string
  updatedBy?: string
  updatedByName?: string
  updatedByEmail?: string
}

export type MenuProduction = {
  id: string
  menuName: string
  category: string
  portion: number
  productionDate: string
  approvalStatus: ApprovalStatus
  storeRequestStatus: StoreRequestStatus
  createdAt: string
}

export type RawMaterial = {
  id: string
  productCode: string
  name: string
  unitOfMeasures: string
  createdAt: string
}

type RecipeApi = Omit<Recipe, 'id'> & { id?: string; _id?: string }
type MenuProductionApi = Omit<MenuProduction, 'id'> & { id?: string; _id?: string }

type ChefDataState = {
  recipes: Recipe[]
  menuProductions: MenuProduction[]
  rawMaterials: RawMaterial[]
}

type CreateRecipeInput = {
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
  menuName: string
  category: string
  portion: number
  productionDate: string
}

type AddRawMaterialInput = {
  productCode: string
  name: string
  unitOfMeasures: string
}

type UpdateRawMaterialInput = AddRawMaterialInput

type RawMaterialsMeta = {
  page: number
  limit: number
  total: number
  totalPages: number
  loading: boolean
  error: string
}

type ChefDataContextValue = ChefDataState & {
  createRecipe: (input: CreateRecipeInput) => Promise<void>
  updateRecipe: (id: string, input: UpdateRecipeInput) => Promise<void>
  importRecipesFromExcel: (file: File) => Promise<number>
  approveRecipe: (id: string) => Promise<void>
  rejectRecipe: (id: string) => Promise<void>
  addMenuProduction: (input: AddMenuProductionInput) => Promise<void>
  approveMenuProduction: (id: string) => Promise<void>
  rejectMenuProduction: (id: string) => Promise<void>
  rawMaterialsMeta: RawMaterialsMeta
  fetchRawMaterials: (page?: number, limit?: number, search?: string) => Promise<void>
  searchRawMaterials: (search: string, limit?: number) => Promise<RawMaterial[]>
  addRawMaterial: (input: AddRawMaterialInput) => Promise<void>
  updateRawMaterial: (id: string, input: UpdateRawMaterialInput) => Promise<void>
  importRawMaterialsFromExcel: (file: File) => Promise<string>
  markStoreRequested: (menuProductionId: string) => Promise<void>
  markStoreFulfilled: (menuProductionId: string) => Promise<void>
  fetchRecipes: () => Promise<void>
  fetchMenuProductions: () => Promise<void>
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
    name: item.name ?? '',
    category: item.category ?? '',
    description: item.description ?? '',
    imageUrl: item.imageUrl ?? undefined,
    price: Number.isFinite(Number(item.price)) ? Number(item.price) : 0,
    portionSize: Number.isFinite(Number(item.portionSize))
      ? Number(item.portionSize)
      : 1,
    status: (item.status ?? 'draft') as RecipeStatus,
    approvalStatus,
    ingredients: Array.isArray(item.ingredients)
      ? item.ingredients.map((ingredient) => ({
          productCode: ingredient.productCode ?? '',
          name: ingredient.name ?? '',
          unitOfMeasures: ingredient.unitOfMeasures ?? '',
          qty: Number.isFinite(Number(ingredient.qty))
            ? Number(ingredient.qty)
            : 0,
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
  }
}

const mapMenuProduction = (item: MenuProductionApi): MenuProduction => ({
  id: pickId(item.id ?? item._id, 'menu-production'),
  menuName: item.menuName ?? '',
  category: item.category ?? '',
  portion: Number.isFinite(Number(item.portion)) ? Number(item.portion) : 0,
  productionDate: item.productionDate ?? '',
  approvalStatus: item.approvalStatus ?? 'pending',
  storeRequestStatus: item.storeRequestStatus ?? 'not-requested',
  createdAt: item.createdAt ?? new Date().toISOString(),
})

const mapRawMaterial = (item: RawMaterial & { _id?: string }): RawMaterial => ({
  id: item.id || item._id || makeId('raw-material'),
  productCode: item.productCode,
  name: item.name,
  unitOfMeasures: item.unitOfMeasures,
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
  const { accessToken } = useAuth()
  const [state, setState] = useState<ChefDataState>(initialState)
  const [rawMaterialsMeta, setRawMaterialsMeta] = useState<RawMaterialsMeta>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
    loading: false,
    error: '',
  })

  const fetchRecipes = useCallback(async () => {
    if (!accessToken) return

    const data = await apiFetch<{ items: RecipeApi[] } | RecipeApi[]>(
      '/recipes',
      undefined,
      accessToken,
    )
    const items = Array.isArray(data) ? data : data.items ?? []
    setState((prev) => ({
      ...prev,
      recipes: items.map(mapRecipe),
    }))
  }, [accessToken])

  const fetchMenuProductions = useCallback(async () => {
    if (!accessToken) return

    const data = await apiFetch<{ items: MenuProductionApi[] } | MenuProductionApi[]>(
      '/menu-productions',
      undefined,
      accessToken,
    )
    const items = Array.isArray(data) ? data : data.items ?? []
    setState((prev) => ({
      ...prev,
      menuProductions: items.map(mapMenuProduction),
    }))
  }, [accessToken])

  useEffect(() => {
    if (!accessToken) {
      setState((prev) => ({ ...prev, recipes: [], menuProductions: [] }))
      return
    }
    fetchRecipes().catch(() => null)
    fetchMenuProductions().catch(() => null)
  }, [accessToken, fetchMenuProductions, fetchRecipes])

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

  const rejectRecipe = async (id: string) => {
    if (!accessToken) {
      throw new Error('Please log in first to save data to the database.')
    }
    const updated = await apiFetch<RecipeApi>(
      `/recipes/${id}/reject`,
      { method: 'PATCH' },
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

  const rejectMenuProduction = async (id: string) => {
    if (!accessToken) {
      throw new Error('Please log in first to save data to the database.')
    }
    const updated = await apiFetch<MenuProductionApi>(
      `/menu-productions/${id}/reject`,
      { method: 'PATCH' },
      accessToken,
    )
    const mapped = mapMenuProduction(updated)
    setState((prev) => ({
      ...prev,
      menuProductions: upsertById(prev.menuProductions, mapped),
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
    [accessToken],
  )

  const searchRawMaterials = useCallback(
    async (search: string, limit = 5) => {
      const token = accessToken ?? readStoredToken()
      if (!token) return []

      const safeLimit = Math.min(limit, 100)
      const params = new URLSearchParams()
      params.set('page', '1')
      params.set('limit', String(safeLimit))
      if (search?.trim()) params.set('search', search.trim())

      const data = await apiFetch<{
        items: Array<RawMaterial & { _id?: string }>
        total: number
        page: number
        limit: number
        totalPages?: number
      }>(`/raw-materials?${params.toString()}`, undefined, token)

      return (data.items ?? []).map(mapRawMaterial)
    },
    [accessToken],
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

  const value = useMemo(
    () => ({
      ...state,
      addRawMaterial,
      updateRawMaterial,
      createRecipe,
      updateRecipe,
      importRecipesFromExcel,
      approveRecipe,
      rejectRecipe,
      addMenuProduction,
      approveMenuProduction,
      rejectMenuProduction,
      importRawMaterialsFromExcel,
      fetchRawMaterials,
      searchRawMaterials,
      rawMaterialsMeta,
      markStoreRequested,
      markStoreFulfilled,
      fetchRecipes,
      fetchMenuProductions,
    }),
    [
      addRawMaterial,
      addMenuProduction,
      approveMenuProduction,
      approveRecipe,
      createRecipe,
      updateRecipe,
      fetchMenuProductions,
      fetchRawMaterials,
      fetchRecipes,
      importRawMaterialsFromExcel,
      importRecipesFromExcel,
      markStoreFulfilled,
      markStoreRequested,
      searchRawMaterials,
      updateRawMaterial,
      rawMaterialsMeta,
      rejectMenuProduction,
      rejectRecipe,
      state,
    ],
  )

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
