import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
  type ReactNode,
} from 'react'
import { apiFetch } from './api'
import { useAuth } from './auth'

export type ApprovalStatus = 'pending' | 'approved' | 'rejected'
export type RecipeStatus = 'draft' | 'active'
export type StoreRequestStatus = 'not-requested' | 'requested'

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
  price: number
  status: RecipeStatus
  approvalStatus: ApprovalStatus
  ingredients: RecipeIngredient[]
  createdAt: string
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

type ChefDataState = {
  recipes: Recipe[]
  menuProductions: MenuProduction[]
  rawMaterials: RawMaterial[]
}

type CreateRecipeInput = {
  name: string
  category: string
  description: string
  price: number
  status: RecipeStatus
  ingredients: RecipeIngredient[]
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

type RawMaterialsMeta = {
  page: number
  limit: number
  total: number
  totalPages: number
  loading: boolean
  error: string
}

type ChefDataContextValue = ChefDataState & {
  createRecipe: (input: CreateRecipeInput) => void
  importRecipesFromExcel: (fileName: string) => number
  approveRecipe: (id: string) => void
  rejectRecipe: (id: string) => void
  addMenuProduction: (input: AddMenuProductionInput) => void
  approveMenuProduction: (id: string) => void
  rejectMenuProduction: (id: string) => void
  rawMaterialsMeta: RawMaterialsMeta
  fetchRawMaterials: (page?: number, limit?: number, search?: string) => Promise<void>
  addRawMaterial: (input: AddRawMaterialInput) => Promise<void>
  importRawMaterialsFromExcel: (file: File) => Promise<string>
  markStoreRequested: (menuProductionId: string) => void
}

const STORAGE_KEY = 'dm-chef-data-v1'

const initialState: ChefDataState = {
  recipes: [],
  menuProductions: [],
  rawMaterials: [],
}

const ChefDataContext = createContext<ChefDataContextValue | undefined>(undefined)

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const readStoredState = (): ChefDataState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return initialState
    const parsed = JSON.parse(raw) as unknown
    if (!isObject(parsed)) return initialState

    return {
      recipes: Array.isArray(parsed.recipes) ? (parsed.recipes as Recipe[]) : [],
      menuProductions: Array.isArray(parsed.menuProductions)
        ? (parsed.menuProductions as MenuProduction[])
        : [],
      rawMaterials: [],
    }
  } catch {
    return initialState
  }
}

const makeId = (prefix: string) => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

const parseFileBaseName = (fileName: string, fallback: string) => {
  const name = fileName.replace(/\.(xlsx|xls)$/i, '').trim()
  return name || fallback
}

export const ChefDataProvider = ({ children }: { children: ReactNode }) => {
  const { accessToken } = useAuth()
  const [state, setState] = useState<ChefDataState>(readStoredState)
  const [rawMaterialsMeta, setRawMaterialsMeta] = useState<RawMaterialsMeta>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
    loading: false,
    error: '',
  })

  useEffect(() => {
    const snapshot = {
      recipes: state.recipes,
      menuProductions: state.menuProductions,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  }, [state.menuProductions, state.recipes])

  const createRecipe = (input: CreateRecipeInput) => {
    const now = new Date().toISOString()
    const nextRecipe: Recipe = {
      id: makeId('recipe'),
      ...input,
      approvalStatus: 'pending',
      createdAt: now,
    }

    setState((prev) => ({
      ...prev,
      recipes: [nextRecipe, ...prev.recipes],
    }))
  }

  const importRecipesFromExcel = (fileName: string) => {
    const now = new Date().toISOString()
    const base = parseFileBaseName(fileName, 'Recipe Import')
    const imported: Recipe[] = [1, 2, 3].map((idx) => ({
      id: makeId('recipe'),
      name: `${base} #${idx}`,
      category: 'Imported',
      description: `Recipe hasil import dari file ${fileName}`,
      price: 0,
      status: 'draft',
      approvalStatus: 'pending',
      ingredients: [],
      createdAt: now,
    }))

    setState((prev) => ({
      ...prev,
      recipes: [...imported, ...prev.recipes],
    }))

    return imported.length
  }

  const approveRecipe = (id: string) => {
    setState((prev) => ({
      ...prev,
      recipes: prev.recipes.map((recipe) =>
        recipe.id === id ? { ...recipe, approvalStatus: 'approved' } : recipe,
      ),
    }))
  }

  const rejectRecipe = (id: string) => {
    setState((prev) => ({
      ...prev,
      recipes: prev.recipes.map((recipe) =>
        recipe.id === id ? { ...recipe, approvalStatus: 'rejected' } : recipe,
      ),
    }))
  }

  const addMenuProduction = (input: AddMenuProductionInput) => {
    const now = new Date().toISOString()
    const next: MenuProduction = {
      id: makeId('menu-production'),
      ...input,
      approvalStatus: 'pending',
      storeRequestStatus: 'not-requested',
      createdAt: now,
    }

    setState((prev) => ({
      ...prev,
      menuProductions: [next, ...prev.menuProductions],
    }))
  }

  const approveMenuProduction = (id: string) => {
    setState((prev) => ({
      ...prev,
      menuProductions: prev.menuProductions.map((item) =>
        item.id === id ? { ...item, approvalStatus: 'approved' } : item,
      ),
    }))
  }

  const rejectMenuProduction = (id: string) => {
    setState((prev) => ({
      ...prev,
      menuProductions: prev.menuProductions.map((item) =>
        item.id === id ? { ...item, approvalStatus: 'rejected' } : item,
      ),
    }))
  }

  const addRawMaterial = (input: AddRawMaterialInput) => {
    if (!accessToken) {
      return Promise.reject(
        new Error('Login terlebih dahulu agar data tersimpan ke database.'),
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

  const importRawMaterialsFromExcel = async (file: File) => {
    if (!accessToken) {
      throw new Error('Login terlebih dahulu agar data tersimpan ke database.')
    }

    const presign = await apiFetch<{
      key: string
      url: string
      publicUrl: string
    }>(
      '/files/presign',
      {
        method: 'POST',
        body: JSON.stringify({
          contentType: file.type || 'application/octet-stream',
          prefix: 'raw-materials',
        }),
      },
      accessToken,
    )

    const uploadResponse = await fetch(presign.url, {
      method: 'PUT',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
      },
      body: file,
    })
    if (!uploadResponse.ok) {
      throw new Error('Upload file raw material gagal.')
    }

    const job = await apiFetch<{ jobId: string }>(
      '/imports/raw-materials',
      {
        method: 'POST',
        body: JSON.stringify({
          fileKey: presign.key,
          fileName: file.name,
          contentType: file.type,
        }),
      },
      accessToken,
    )

    return job.jobId
  }

  const fetchRawMaterials = useCallback(
    async (page = 1, limit = 10, search?: string) => {
      if (!accessToken) {
        setRawMaterialsMeta((prev) => ({
          ...prev,
          loading: false,
          error: 'Login terlebih dahulu untuk memuat data raw material.',
        }))
        return
      }

      setRawMaterialsMeta((prev) => ({
        ...prev,
        loading: true,
        error: '',
      }))

      try {
        const params = new URLSearchParams()
        params.set('page', String(page))
        params.set('limit', String(limit))
        if (search?.trim()) params.set('search', search.trim())

        const data = await apiFetch<{
          items: Array<RawMaterial & { _id?: string }>
          total: number
          page: number
          limit: number
          totalPages?: number
        }>(`/raw-materials?${params.toString()}`, undefined, accessToken)

        const mapped = (data.items ?? []).map((item) => ({
          id: item.id || item._id || makeId('raw-material'),
          productCode: item.productCode,
          name: item.name,
          unitOfMeasures: item.unitOfMeasures,
          createdAt: item.createdAt,
        }))

        setState((prev) => ({
          ...prev,
          rawMaterials: mapped,
        }))
        setRawMaterialsMeta({
          page: data.page ?? page,
          limit: data.limit ?? limit,
          total: data.total ?? 0,
          totalPages:
            data.totalPages ?? Math.max(1, Math.ceil((data.total ?? 0) / limit)),
          loading: false,
          error: '',
        })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Gagal memuat data.'
        setRawMaterialsMeta((prev) => ({
          ...prev,
          loading: false,
          error: message,
        }))
      }
    },
    [accessToken],
  )

  const markStoreRequested = (menuProductionId: string) => {
    setState((prev) => ({
      ...prev,
      menuProductions: prev.menuProductions.map((item) =>
        item.id === menuProductionId
          ? { ...item, storeRequestStatus: 'requested' }
          : item,
      ),
    }))
  }

  const value = useMemo(
    () => ({
      ...state,
      createRecipe,
      importRecipesFromExcel,
      approveRecipe,
      rejectRecipe,
      addMenuProduction,
      approveMenuProduction,
      rejectMenuProduction,
      addRawMaterial,
      importRawMaterialsFromExcel,
      fetchRawMaterials,
      rawMaterialsMeta,
      markStoreRequested,
    }),
    [fetchRawMaterials, rawMaterialsMeta, state],
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
