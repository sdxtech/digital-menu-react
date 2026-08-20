import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import TablePagination from '../components/TablePagination'
import ActionButton from '../components/ActionButton'
import {
  useChefData,
  type RawMaterial,
  type RecipeIngredient,
} from '../lib/chef-data'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'
import { formatQuantity, roundQuantity } from '../lib/quantity'
import {
  formatRecipeVersion,
  getRecipeVersion,
} from '../lib/recipe-version'
import { formatUnitLabel } from '../lib/unit-of-measures'

const INGREDIENT_ROWS_PER_PAGE = 8

type RecipeForm = {
  name: string
  category: string
  description: string
  portionSize: string
}

type IngredientRow = {
  id: string
  ingredientType: '' | 'IT' | 'NMP'
  productCode: string
  name: string
  unitOfMeasures: string
  qty: string
  prodUomCode: string
  srQty: string
  srQtyManual: boolean
  baseUnitOfMeasures?: string
  conversionFactor?: number
}

type UnitOfMeasureApi = {
  id?: string
  _id?: string
  code?: string
  name?: string
  isActive?: boolean
}

type UnitConversionApi = {
  id?: string
  _id?: string
  prodUomCode?: string
  srUomCode?: string
  conversionId?: string
  multiplier?: number
  isActive?: boolean
}

type UnitOfMeasureOption = {
  id: string
  code: string
  name: string
}

type PaginatedApiResponse<T> = {
  items?: T[]
  total?: number
  totalPages?: number
}

type UnitConversion = {
  id: string
  prodUomCode: string
  srUomCode: string
  conversionId: string
  multiplier: number
}

type CategoryApi = {
  id?: string
  _id?: string
  name?: string
  isActive?: boolean
}

export type BaseRecipe = {
  id?: string
  sourceRecipeId?: string
  recipeCode?: string
  version?: number
  name: string
  category: string
  description?: string
  portionSize?: number
  approvalStatus?: 'pending' | 'approved' | 'rejected'
  rejectionReason?: string
  reviewedBy?: string
  reviewedByName?: string
  reviewedByEmail?: string
  approvalHistory?: Array<{
    rejectionReason: string
    rejectedByName?: string
    rejectedAt?: string
    resubmissionFeedback?: string
    resubmittedByName?: string
    resubmittedAt?: string
  }>
  ingredients?: RecipeIngredient[]
}

const createIngredientRow = (
  values: Partial<IngredientRow> = {},
): IngredientRow => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  ingredientType: values.ingredientType ?? '',
  productCode: values.productCode ?? '',
  name: values.name ?? '',
  unitOfMeasures: values.unitOfMeasures ?? '',
  qty: values.qty ?? '',
  prodUomCode: values.prodUomCode ?? '',
  srQty: values.srQty ?? '',
  srQtyManual: values.srQtyManual ?? false,
  baseUnitOfMeasures: values.baseUnitOfMeasures,
  conversionFactor: values.conversionFactor,
})

const initialRecipeForm: RecipeForm = {
  name: '',
  category: '',
  description: '',
  portionSize: '1',
}

type ChefCreateMenuProps = {
  embedded?: boolean
  baseRecipe?: BaseRecipe
  enableIngredientUomConversion?: boolean
  lockSrUomToRawMaterial?: boolean
  onClose?: () => void
  onSaved?: () => void
}

const ChefCreateMenu = ({
  embedded = false,
  baseRecipe: baseRecipeProp,
  enableIngredientUomConversion = false,
  lockSrUomToRawMaterial = false,
  onClose,
  onSaved,
}: ChefCreateMenuProps) => {
  const location = useLocation()
  const navigate = useNavigate()
  const {
    createRecipe,
    updateRecipe,
    resubmitRecipe,
    importRecipesFromExcel,
    searchRawMaterials,
  } = useChefData()
  const { accessToken } = useAuth()

  const baseRecipe =
    baseRecipeProp ??
    (location.state as { baseRecipe?: BaseRecipe } | null)?.baseRecipe
  const editingRecipeId = baseRecipe?.id ?? ''
  const isEditMode = Boolean(editingRecipeId)
  const isCreateFromRecipe = Boolean(baseRecipe?.sourceRecipeId && !isEditMode)
  const isCreateFromTemplate = Boolean(
    baseRecipe && !isEditMode && !baseRecipe.sourceRecipeId,
  )
  const baseRecipeVersion = getRecipeVersion(baseRecipe?.version)
  const [currentApprovalStatus, setCurrentApprovalStatus] = useState(
    baseRecipe?.approvalStatus,
  )
  const [resubmitFeedback, setResubmitFeedback] = useState('')
  const [resubmitModalOpen, setResubmitModalOpen] = useState(false)
  const [recipeForm, setRecipeForm] = useState<RecipeForm>(initialRecipeForm)
  const [ingredientRows, setIngredientRows] = useState<IngredientRow[]>([
    createIngredientRow(),
  ])

  const [rawMaterialOptions, setRawMaterialOptions] = useState<RawMaterial[]>([])
  const rawMaterialCacheRef = useRef<Map<string, RawMaterial>>(new Map())
  const [uomOptions, setUomOptions] = useState<UnitOfMeasureOption[]>([])
  const [srUomOptions, setSrUomOptions] = useState<string[]>([])
  const [unitConversions, setUnitConversions] = useState<UnitConversion[]>([])
  const [submitError, setSubmitError] = useState('')
  const [submitMessage, setSubmitMessage] = useState('')
  const [categoryOptions, setCategoryOptions] = useState<string[]>([])
  const [categoriesLoading, setCategoriesLoading] = useState(false)
  const [categoriesError, setCategoriesError] = useState('')
  const [ingredientPage, setIngredientPage] = useState(1)
  const [activeIngredientDropdownId, setActiveIngredientDropdownId] = useState<string | null>(null)
  const [ingredientDropdownPosition, setIngredientDropdownPosition] = useState<{
    left: number
    top: number
  } | null>(null)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importError, setImportError] = useState('')
  const [importMessage, setImportMessage] = useState('')
  const [importOpen, setImportOpen] = useState(false)

  const searchTimeoutRef = useRef<number | null>(null)
  const searchRequestRef = useRef(0)
  const isMountedRef = useRef(true)
  const baseRecipeRef = useRef<BaseRecipe | null>(null)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      if (searchTimeoutRef.current !== null) {
        window.clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!baseRecipe || baseRecipeRef.current === baseRecipe) return
    baseRecipeRef.current = baseRecipe
    setCurrentApprovalStatus(baseRecipe.approvalStatus)

    const portionSize =
      Number.isFinite(baseRecipe.portionSize) && (baseRecipe.portionSize ?? 0) > 0
        ? String(baseRecipe.portionSize)
        : '1'

    setRecipeForm({
      name: baseRecipe.name ?? '',
      category: baseRecipe.category ?? '',
      description: baseRecipe.description ?? '',
      portionSize,
    })

    const baseIngredients = Array.isArray(baseRecipe.ingredients)
      ? baseRecipe.ingredients
      : []
    setIngredientRows(
      baseIngredients.length
        ? baseIngredients.map((ingredient) =>
            createIngredientRow({
              ingredientType: ingredient.ingredientType ?? '',
              productCode: ingredient.productCode ?? '',
              name: ingredient.name ?? '',
              unitOfMeasures: ingredient.unitOfMeasures ?? '',
              qty:
                enableIngredientUomConversion &&
                Number.isFinite(ingredient.prodQty)
                  ? String(ingredient.prodQty)
                  : Number.isFinite(ingredient.qty)
                    ? String(ingredient.qty)
                    : '',
              prodUomCode:
                ingredient.prodUomCode ??
                ingredient.srUomCode ??
                ingredient.unitOfMeasures ??
                '',
              srQty:
                ingredient.srQtyManual && Number.isFinite(ingredient.srQty)
                  ? String(ingredient.srQty)
                  : '',
              srQtyManual: ingredient.srQtyManual ?? false,
            }),
          )
        : [createIngredientRow()],
    )
    setIngredientPage(1)
    setResubmitFeedback('')
    setResubmitModalOpen(false)
    setSubmitError('')
    setSubmitMessage('')
  }, [baseRecipe, enableIngredientUomConversion])

  useEffect(() => {
    if (!accessToken) return

    let cancelled = false
    const fetchCategories = async () => {
      setCategoriesLoading(true)
      setCategoriesError('')
      try {
        const allCategories: CategoryApi[] = []
        const limit = 100
        let page = 1
        let total = 0

        do {
          const params = new URLSearchParams()
          params.set('page', String(page))
          params.set('limit', String(limit))
          params.set('isActive', 'true')

          const data = await apiFetch<{
            items?: CategoryApi[]
            total?: number
          }>(`/categories?${params.toString()}`, undefined, accessToken)

          const items = data.items ?? []
          allCategories.push(...items)
          total = data.total ?? allCategories.length
          if (items.length < limit) break
          page += 1
        } while (allCategories.length < total)

        if (cancelled) return
        const nextCategories = allCategories
          .map((category) => category.name?.trim() ?? '')
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b))
        setCategoryOptions(nextCategories)
      } catch {
        if (cancelled) return
        setCategoryOptions([])
        setCategoriesError('Unable to load categories.')
      } finally {
        if (!cancelled) setCategoriesLoading(false)
      }
    }

    fetchCategories().catch(() => null)

    return () => {
      cancelled = true
    }
  }, [accessToken])

  useEffect(() => {
    if (!enableIngredientUomConversion || !accessToken) {
      setUomOptions([])
      setSrUomOptions([])
      setUnitConversions([])
      return
    }

    let cancelled = false
    const fetchAllPages = async <T,>(path: string) => {
      const items: T[] = []
      const limit = 100
      let page = 1
      let total = 0

      do {
        const separator = path.includes('?') ? '&' : '?'
        const data = await apiFetch<PaginatedApiResponse<T>>(
          `${path}${separator}page=${page}&limit=${limit}`,
          undefined,
          accessToken,
        )
        const pageItems = data.items ?? []
        items.push(...pageItems)
        total = data.total ?? items.length
        if (pageItems.length < limit) break
        page += 1
      } while (items.length < total)

      return items
    }

    const fetchUomData = async () => {
      const [unitsResult, srUnitsResult, conversionsResult] =
        await Promise.allSettled([
          fetchAllPages<UnitOfMeasureApi>(
            '/unit-of-measures?isActive=true',
          ),
          apiFetch<string[]>(
            '/raw-materials/unit-options',
            undefined,
            accessToken,
          ),
          fetchAllPages<UnitConversionApi>(
            '/unit-of-measures/conversions?isActive=true',
          ),
        ])
      if (cancelled) return

      if (unitsResult.status === 'fulfilled') {
        setUomOptions(
          unitsResult.value
            .map((item) => ({
              id: item.id ?? item._id ?? item.code ?? '',
              code: item.code ?? '',
              name: item.name ?? '',
            }))
            .filter((item) => item.id && item.code),
        )
      } else {
        setUomOptions([])
      }

      if (srUnitsResult.status === 'fulfilled') {
        setSrUomOptions(srUnitsResult.value.filter(Boolean))
      } else {
        setSrUomOptions([])
      }

      if (conversionsResult.status === 'fulfilled') {
        setUnitConversions(
          conversionsResult.value
            .map((item) => ({
              id: item.id ?? item._id ?? item.conversionId ?? '',
              prodUomCode: item.prodUomCode ?? '',
              srUomCode: item.srUomCode ?? '',
              conversionId: item.conversionId ?? '',
              multiplier: item.multiplier ?? 0,
            }))
            .filter(
              (item) =>
                item.id &&
                item.prodUomCode &&
                item.srUomCode &&
                item.conversionId &&
                item.multiplier > 0,
            ),
        )
      } else {
        setUnitConversions([])
      }
    }

    fetchUomData().catch(() => null)

    return () => {
      cancelled = true
    }
  }, [accessToken, enableIngredientUomConversion, lockSrUomToRawMaterial])

  useEffect(() => {
    const requestId = ++searchRequestRef.current
    searchRawMaterials('', 5)
      .then((results) => {
        if (!isMountedRef.current || searchRequestRef.current !== requestId) {
          return
        }
        cacheRawMaterials(results)
        setRawMaterialOptions(results.slice(0, 5))
      })
      .catch(() => {
        if (!isMountedRef.current || searchRequestRef.current !== requestId) {
          return
        }
        setRawMaterialOptions([])
      })
  }, [searchRawMaterials])

  useEffect(() => {
    const nextTotalPages = Math.max(
      1,
      Math.ceil(ingredientRows.length / INGREDIENT_ROWS_PER_PAGE),
    )
    setIngredientPage((prev) => Math.min(prev, nextTotalPages))
  }, [ingredientRows.length])

  const normalizeValue = (value: string) => value.trim().toLowerCase()
  const normalizeUomCode = (value: string) => value.trim().toUpperCase()
  const getRawMaterialCacheKeys = (item: RawMaterial) =>
    [
      item.productCode ? `code:${normalizeValue(item.productCode)}` : '',
      item.name ? `name:${normalizeValue(item.name)}` : '',
    ].filter(Boolean)
  const cacheRawMaterials = (items: RawMaterial[]) => {
    items.forEach((item) => {
      getRawMaterialCacheKeys(item).forEach((key) => {
        rawMaterialCacheRef.current.set(key, item)
      })
    })
  }
  const findUnitConversion = (prodUomCode: string, srUomCode: string) => {
    const prod = normalizeUomCode(prodUomCode)
    const sr = normalizeUomCode(srUomCode)
    return unitConversions.find(
      (item) =>
        normalizeUomCode(item.prodUomCode) === prod &&
        normalizeUomCode(item.srUomCode) === sr,
    )
  }
  const findRawMaterialForRow = (row: IngredientRow) => {
    const codeKey = row.productCode.trim()
      ? `code:${normalizeValue(row.productCode)}`
      : ''
    const nameKey = row.name.trim() ? `name:${normalizeValue(row.name)}` : ''
    const byCode = codeKey
      ? rawMaterialCacheRef.current.get(codeKey) ??
        findRawMaterialByCode(row.productCode)
      : undefined
    if (byCode) return byCode
    return nameKey
      ? rawMaterialCacheRef.current.get(nameKey) ?? findRawMaterialByName(row.name)
      : undefined
  }
  const calculateSpecificSrQty = (row: IngredientRow, prodQty: number) => {
    const matchedRawMaterial = findRawMaterialForRow(row)
    const prodUomCode = normalizeUomCode(row.prodUomCode)
    const srUomCode = normalizeUomCode(row.unitOfMeasures)
    const rawMaterialSrUomCode = normalizeUomCode(
      matchedRawMaterial?.unitOfMeasures ?? '',
    )
    const matchingRule = matchedRawMaterial?.specificConversions?.find(
      (rule) =>
        normalizeUomCode(rule.prodUomCode) === prodUomCode &&
        normalizeUomCode(rule.srUomCode) === srUomCode,
    )
    const baseUomCode = normalizeUomCode(
      row.baseUnitOfMeasures ?? matchedRawMaterial?.baseUnitOfMeasures ?? '',
    )
    const legacyMatches =
      baseUomCode === prodUomCode &&
      (!rawMaterialSrUomCode || srUomCode === rawMaterialSrUomCode)
    const conversionFactor = Number(
      matchingRule?.conversionFactor ??
        (legacyMatches
          ? (row.conversionFactor ?? matchedRawMaterial?.conversionFactor)
          : undefined),
    )

    if (
      !prodUomCode ||
      !srUomCode ||
      !Number.isFinite(conversionFactor) ||
      conversionFactor <= 0
    ) {
      return null
    }

    return {
      conversion: {
        id: `specific-${row.productCode}`,
        prodUomCode,
        srUomCode,
        conversionId: `${prodUomCode} To ${srUomCode}`,
        multiplier: 1 / conversionFactor,
      },
      srQty: roundQuantity(prodQty / conversionFactor),
    }
  }
  const calculateSrQty = (row: IngredientRow) => {
    const prodQty = Number(row.qty)
    const srUomCode = row.unitOfMeasures.trim()
    if (
      !enableIngredientUomConversion ||
      !Number.isFinite(prodQty) ||
      prodQty <= 0 ||
      !row.prodUomCode ||
      !srUomCode
    ) {
      return null
    }

    if (normalizeUomCode(row.prodUomCode) === normalizeUomCode(srUomCode)) {
      return {
        conversion: {
          id: `identity-${normalizeUomCode(row.prodUomCode)}`,
          prodUomCode: normalizeUomCode(row.prodUomCode),
          srUomCode: normalizeUomCode(srUomCode),
          conversionId: `${normalizeUomCode(row.prodUomCode)} To ${normalizeUomCode(srUomCode)}`,
          multiplier: 1,
        },
        srQty: roundQuantity(prodQty),
      }
    }

    const specificConversion = calculateSpecificSrQty(row, prodQty)
    if (specificConversion) return specificConversion

    const conversion = findUnitConversion(row.prodUomCode, srUomCode)
    if (!conversion) return null
    return {
      conversion,
      srQty: roundQuantity(prodQty * conversion.multiplier),
    }
  }
  const findRawMaterialByCode = (value: string) => {
    const normalized = normalizeValue(value)
    return rawMaterialOptions.find(
      (item) => normalizeValue(item.productCode) === normalized,
    )
  }
  const findRawMaterialByName = (value: string) => {
    const normalized = normalizeValue(value)
    return rawMaterialOptions.find(
      (item) => normalizeValue(item.name) === normalized,
    )
  }
  const applyRawMaterialToRow = (
    row: IngredientRow,
    matched: RawMaterial,
  ): IngredientRow => {
    const srUomChanged =
      normalizeUomCode(row.unitOfMeasures) !==
      normalizeUomCode(matched.unitOfMeasures)

    return {
      ...row,
      productCode: matched.productCode,
      name: matched.name,
      unitOfMeasures: matched.unitOfMeasures,
      ...(srUomChanged ? { srQty: '', srQtyManual: false } : {}),
      baseUnitOfMeasures: matched.baseUnitOfMeasures,
      conversionFactor: matched.conversionFactor,
    }
  }

  const resolveRawMaterialByProductCode = async (productCode: string) => {
    const normalizedCode = normalizeValue(productCode)
    if (!normalizedCode) return undefined

    const cached = rawMaterialCacheRef.current.get(`code:${normalizedCode}`)
    if (cached) return cached

    try {
      const results = await searchRawMaterials(productCode, 40)
      cacheRawMaterials(results)
      return results.find(
        (item) => normalizeValue(item.productCode) === normalizedCode,
      )
    } catch {
      return undefined
    }
  }

  const updateRecipeForm = <K extends keyof RecipeForm>(
    field: K,
    value: RecipeForm[K],
  ) => {
    setRecipeForm((prev) => ({
      ...prev,
      [field]: value,
    }))
  }

  const updateIngredientRow = <K extends keyof IngredientRow>(
    id: string,
    field: K,
    value: IngredientRow[K],
  ) => {
    setIngredientRows((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row

        const next = { ...row, [field]: value }
        if (field === 'ingredientType') {
          if (value === 'NMP') {
            next.productCode = 'NMP'
          } else if (value === 'IT' && row.ingredientType === 'NMP') {
            next.productCode = ''
            next.name = ''
            next.unitOfMeasures = ''
          }
        }
        if (
          (field === 'productCode' ||
            field === 'name' ||
            field === 'prodUomCode' ||
            field === 'unitOfMeasures') &&
          typeof value === 'string' &&
          normalizeUomCode(value) !==
            normalizeUomCode(String(row[field] ?? ''))
        ) {
          next.srQty = ''
          next.srQtyManual = false
        }
        if (
          field === 'unitOfMeasures' &&
          typeof value === 'string' &&
          normalizeUomCode(value) !== normalizeUomCode(row.unitOfMeasures)
        ) {
          next.baseUnitOfMeasures = undefined
          next.conversionFactor = undefined
        }
        if (field === 'productCode' && typeof value === 'string') {
          const matched = findRawMaterialByCode(value)
          if (matched) {
            return applyRawMaterialToRow(next, matched)
          }
        }

        if (field === 'name' && typeof value === 'string') {
          const matched = findRawMaterialByName(value)
          if (matched) {
            return applyRawMaterialToRow(next, matched)
          }
        }

        return next
      }),
    )
  }

  const updateIngredientSrQty = (id: string, value: string) => {
    setIngredientRows((current) =>
      current.map((row) =>
        row.id === id
          ? { ...row, srQty: value, srQtyManual: true }
          : row,
      ),
    )
  }

  const rankRawMaterials = (query: string, items: RawMaterial[]) => {
    const normalized = normalizeValue(query)
    return [...items].sort((a, b) => {
      const aCode = normalizeValue(a.productCode)
      const bCode = normalizeValue(b.productCode)
      const aName = normalizeValue(a.name)
      const bName = normalizeValue(b.name)

      const aScore =
        aCode === normalized || aName === normalized
          ? 3
          : aCode.startsWith(normalized) || aName.startsWith(normalized)
            ? 2
            : 1
      const bScore =
        bCode === normalized || bName === normalized
          ? 3
          : bCode.startsWith(normalized) || bName.startsWith(normalized)
            ? 2
            : 1

      if (aScore !== bScore) return bScore - aScore
      return aName.localeCompare(bName)
    })
  }

  const scheduleRawMaterialSearch = (
    query: string,
    target?: { rowId: string; field: 'productCode' | 'name' },
  ) => {
    if (searchTimeoutRef.current !== null) {
      window.clearTimeout(searchTimeoutRef.current)
    }

    const requestId = ++searchRequestRef.current
    const trimmed = query.trim()
    const targetMeta = trimmed && target ? { ...target } : null
    const delay = trimmed ? 200 : 0
    const fetchLimit = trimmed ? 40 : 10

    searchTimeoutRef.current = window.setTimeout(async () => {
      try {
        const results = await searchRawMaterials(trimmed, fetchLimit)
        if (!isMountedRef.current || searchRequestRef.current !== requestId) {
          return
        }
        cacheRawMaterials(results)
        const ranked = trimmed ? rankRawMaterials(trimmed, results) : results
        setRawMaterialOptions(ranked.slice(0, 10))

        if (targetMeta) {
          setIngredientRows((prev) =>
            prev.map((row) => {
              if (row.id !== targetMeta.rowId) return row
              const matched =
                targetMeta.field === 'productCode'
                  ? results.find(
                      (item) =>
                        normalizeValue(item.productCode) ===
                        normalizeValue(row.productCode),
                    )
                  : results.find(
                      (item) =>
                        normalizeValue(item.name) === normalizeValue(row.name),
                    )
              if (!matched) return row
              return applyRawMaterialToRow(row, matched)
            }),
          )
        }
      } catch {
        if (!isMountedRef.current || searchRequestRef.current !== requestId) {
          return
        }
        setRawMaterialOptions([])
      }
    }, delay)
  }

  const handleIngredientInputChange = <K extends keyof IngredientRow>(
    id: string,
    field: K,
    value: IngredientRow[K],
  ) => {
    updateIngredientRow(id, field, value)
    if ((field === 'productCode' || field === 'name') && typeof value === 'string') {
      scheduleRawMaterialSearch(value, { rowId: id, field })
    }
  }

  const handleRawMaterialFocus = () => {
    scheduleRawMaterialSearch('')
  }

  const positionIngredientDropdown = (input: HTMLElement) => {
    const bounds = input.getBoundingClientRect()
    const dropdownWidth = Math.min(576, window.innerWidth - 32)
    const dropdownHeight = Math.min(296, window.innerHeight - 32)
    const gap = 4
    const canOpenBelow = bounds.bottom + gap + dropdownHeight <= window.innerHeight
    const top = canOpenBelow
      ? bounds.bottom + gap
      : Math.max(16, bounds.top - dropdownHeight - gap)
    const left = Math.min(
      Math.max(16, bounds.left),
      Math.max(16, window.innerWidth - dropdownWidth - 16),
    )

    setIngredientDropdownPosition({ left, top })
  }

  const selectRawMaterialForRow = (rowId: string, material: RawMaterial) => {
    setIngredientRows((prev) =>
      prev.map((row) => (
        row.id === rowId ? applyRawMaterialToRow(row, material) : row
      )),
    )
    setActiveIngredientDropdownId(null)
    setIngredientDropdownPosition(null)
  }

  const handleAddIngredientRow = () => {
    setIngredientRows((prev) => {
      const nextRows = [...prev, createIngredientRow()]
      const nextTotalPages = Math.max(
        1,
        Math.ceil(nextRows.length / INGREDIENT_ROWS_PER_PAGE),
      )
      setIngredientPage(nextTotalPages)
      return nextRows
    })
    setSubmitError('')
    setSubmitMessage('')
  }

  const handleRemoveIngredientRow = (id: string) => {
    setIngredientRows((prev) => {
      const nextRows = prev.filter((row) => row.id !== id)
      return nextRows.length === 0 ? [createIngredientRow()] : nextRows
    })
    setSubmitError('')
    setSubmitMessage('')
  }

  const handleImportFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] ?? null
    setImportMessage('')

    if (!nextFile) {
      setImportFile(null)
      setImportError('')
      return
    }

    const isExcelFile = /\.(xlsx|xls)$/i.test(nextFile.name)
    if (!isExcelFile) {
      setImportFile(null)
      setImportError('File must be .xlsx or .xls')
      return
    }

    setImportFile(nextFile)
    setImportError('')
  }

  const openImportModal = () => {
    setImportOpen(true)
  }

  const closeImportModal = () => {
    setImportOpen(false)
  }

  const handleImportRecipes = async () => {
    if (!importFile) {
      setImportError('Select an Excel file first')
      setImportMessage('')
      return
    }

    try {
      const importedCount = await importRecipesFromExcel(importFile)
      setImportError('')
      setImportMessage(
        `${importedCount} recipes imported from ${importFile.name}`,
      )
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to import recipes.'
      setImportError(message)
      setImportMessage('')
    }
  }

  const handleSaveRecipe = async (options: { resubmit?: boolean } = {}) => {
    const nextName = recipeForm.name.trim()
    const nextCategory = recipeForm.category.trim()
    const nextDescription = recipeForm.description.trim()
    const nextResubmitFeedback = resubmitFeedback.trim()

    if (options.resubmit && !nextResubmitFeedback) {
      setSubmitError('Feedback is required before resubmitting the recipe.')
      setSubmitMessage('')
      return
    }
    const portionRaw = recipeForm.portionSize.trim()

    if (!nextName || !nextCategory) {
      setSubmitError('Complete the recipe name and category first.')
      setSubmitMessage('')
      return
    }

    if (
      isCreateFromTemplate &&
      baseRecipe?.name?.trim() &&
      normalizeValue(nextName) === normalizeValue(baseRecipe.name)
    ) {
      setSubmitError(
        'Change the recipe name before creating a recipe from this recipe.',
      )
      setSubmitMessage('')
      return
    }

    const portionSize = Number(portionRaw)
    if (!Number.isFinite(portionSize) || portionSize <= 0) {
      setSubmitError('Base pax must be a number greater than 0.')
      setSubmitMessage('')
      return
    }

    const usedRows = ingredientRows.filter((row) => {
      return (
        row.productCode.trim() ||
        row.name.trim() ||
        row.unitOfMeasures.trim() ||
        row.prodUomCode.trim() ||
        row.qty.trim()
      )
    })

    if (usedRows.length === 0) {
      setSubmitError('Add at least 1 ingredient before submitting the recipe.')
      setSubmitMessage('')
      return
    }

    const parsedIngredients: RecipeIngredient[] = []
    for (const sourceRow of usedRows) {
      if (!sourceRow.ingredientType) {
        setSubmitError('Select IT or NMP for each ingredient row.')
        setSubmitMessage('')
        return
      }
      const enteredProductCode = sourceRow.productCode.trim()
      if (!enteredProductCode) {
        setSubmitError('Select a valid raw material for each ingredient row.')
        setSubmitMessage('')
        return
      }

      const matchedRawMaterial = sourceRow.ingredientType === 'IT'
        ? await resolveRawMaterialByProductCode(enteredProductCode)
        : null
      if (sourceRow.ingredientType === 'IT' && !matchedRawMaterial) {
        setSubmitError(
          `Raw material ${enteredProductCode} was not found. Select an IT code from raw material data.`,
        )
        setSubmitMessage('')
        return
      }

      const row = matchedRawMaterial
        ? applyRawMaterialToRow(sourceRow, matchedRawMaterial)
        : sourceRow
      if (
        row.productCode !== sourceRow.productCode ||
        row.name !== sourceRow.name ||
        row.unitOfMeasures !== sourceRow.unitOfMeasures
      ) {
        setIngredientRows((current) =>
          current.map((item) => (item.id === row.id ? row : item)),
        )
      }

      const productCode = row.productCode.trim()
      const name = row.name.trim()
      const unitOfMeasures = row.unitOfMeasures.trim()
      const prodUomCode = row.prodUomCode.trim()
      const qtyRaw = row.qty.trim()

      if (
        !productCode ||
        !name ||
        !unitOfMeasures ||
        !qtyRaw ||
        (enableIngredientUomConversion && !prodUomCode)
      ) {
        setSubmitError('Make sure each ingredient row is complete.')
        setSubmitMessage('')
        return
      }

      const qty = Number(qtyRaw)
      if (!Number.isFinite(qty) || qty <= 0) {
        setSubmitError('Ingredient qty must be a number greater than 0.')
        setSubmitMessage('')
        return
      }

      if (enableIngredientUomConversion) {
        const conversionResult = calculateSrQty(row)
        const srQtyRaw = row.srQtyManual
          ? row.srQty.trim()
          : conversionResult
            ? String(conversionResult.srQty)
            : row.srQty.trim()
        if (!srQtyRaw) {
          setSubmitError(
            `SR QTY is required for ${name}. Enter it manually when no conversion is configured.`,
          )
          setSubmitMessage('')
          return
        }
        const srQty = Number(srQtyRaw)
        if (!Number.isFinite(srQty) || srQty <= 0) {
          setSubmitError(`SR QTY for ${name} must be greater than 0.`)
          setSubmitMessage('')
          return
        }
        const srQtyManual = row.srQtyManual || !conversionResult
        parsedIngredients.push({
          ...(row.ingredientType ? { ingredientType: row.ingredientType } : {}),
          productCode,
          name,
          unitOfMeasures,
          qty: srQty,
          prodQty: qty,
          prodUomCode,
          srQty,
          srQtyManual,
          srUomCode: unitOfMeasures,
          ...(conversionResult && !srQtyManual
            ? {
                conversionId: conversionResult.conversion.conversionId,
                conversionMultiplier: conversionResult.conversion.multiplier,
              }
            : {}),
        })
      } else {
        parsedIngredients.push({
          ...(row.ingredientType ? { ingredientType: row.ingredientType } : {}),
          productCode,
          name,
          unitOfMeasures,
          qty,
        })
      }
    }

    try {
      const basePayload = {
        name: nextName,
        category: nextCategory,
        description: nextDescription,
        price: 0,
        portionSize,
        ingredients: parsedIngredients,
      }
      let createdRecipeVersion: number | undefined

      if (isEditMode && editingRecipeId) {
        await updateRecipe(editingRecipeId, basePayload)
        if (options.resubmit) {
          await resubmitRecipe(editingRecipeId, nextResubmitFeedback)
          setCurrentApprovalStatus('pending')
          onSaved?.()
          navigate('/chef/menu-bank', { replace: true })
          return
        }
        onSaved?.()
      } else {
        const createdRecipe = await createRecipe({
          ...basePayload,
          ...(isCreateFromRecipe && baseRecipe?.sourceRecipeId
            ? { baseRecipeId: baseRecipe.sourceRecipeId }
            : {}),
          status: 'draft',
        })
        createdRecipeVersion = createdRecipe.version
        setRecipeForm(initialRecipeForm)
        setIngredientRows([createIngredientRow()])
        onSaved?.()
      }

      setSubmitError('')
      setSubmitMessage(
        options.resubmit
          ? 'Recipe updated and resubmitted to the Unit Manager.'
          : isRejectedRecipe
            ? 'Recipe draft saved. Resubmit when ready.'
          : isEditMode
            ? 'Recipe updated successfully.'
            : isCreateFromRecipe
              ? `Recipe ${formatRecipeVersion(createdRecipeVersion)} saved without changing the base recipe.`
              : isCreateFromTemplate
                ? `New recipe ${formatRecipeVersion(createdRecipeVersion)} created from the template.`
                : 'Recipe saved and submitted to the Unit Manager.',
      )
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to save recipe.'
      setSubmitError(message)
      setSubmitMessage('')
    }
  }

  const ingredientTotalPages = Math.max(
    1,
    Math.ceil(ingredientRows.length / INGREDIENT_ROWS_PER_PAGE),
  )
  const paginatedIngredientRows = ingredientRows.slice(
    (ingredientPage - 1) * INGREDIENT_ROWS_PER_PAGE,
    ingredientPage * INGREDIENT_ROWS_PER_PAGE,
  )
  const isRejectedRecipe =
    isEditMode && currentApprovalStatus === 'rejected'
  const rejectionReviewer =
    baseRecipe?.reviewedByName?.trim() ||
    baseRecipe?.reviewedByEmail?.trim() ||
    baseRecipe?.reviewedBy?.trim() ||
    'Unit Manager'

  return (
    <div className="space-y-6">
      {resubmitModalOpen && isRejectedRecipe ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            className="w-full max-w-lg rounded-md border border-border bg-surface p-6 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="resubmit-feedback-title"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2
                  id="resubmit-feedback-title"
                  className="font-semibold text-foreground"
                >
                  Resubmit recipe
                </h2>
                <p className="mt-1 text-sm text-muted">
                  Explain what you changed before sending this recipe back to
                  the Unit Manager.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setResubmitModalOpen(false)}
                className="dm-x-button"
                aria-label="Close resubmit feedback"
              >
                <i className="bi bi-x-lg text-sm leading-none" aria-hidden="true" />
              </button>
            </div>
            <label className="mt-5 block text-sm font-medium text-foreground">
              Feedback <span className="text-danger">*</span>
              <textarea
                autoFocus
                value={resubmitFeedback}
                onChange={(event) => setResubmitFeedback(event.target.value)}
                rows={5}
                maxLength={1000}
                placeholder="Example: Reduced salt from 10 g to 7 g."
                className="mt-2 w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
              />
              <span className="mt-1 block text-xs text-muted">
                This feedback will be recorded in the approval history.
              </span>
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <ActionButton
                action="cancel"
                onClick={() => setResubmitModalOpen(false)}
                size="sm"
              />
              <ActionButton
                action="submit"
                onClick={() => {
                  if (!resubmitFeedback.trim()) {
                    setSubmitError('Feedback is required before resubmitting the recipe.')
                    return
                  }
                  setResubmitModalOpen(false)
                  handleSaveRecipe({ resubmit: true }).catch(() => null)
                }}
                size="sm"
              />
            </div>
          </div>
        </div>
      ) : null}
      <div className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">
              {isEditMode
                ? 'Edit Recipe'
                : isCreateFromRecipe
                  ? 'Create Recipe Version'
                  : isCreateFromTemplate
                    ? 'Create Recipe from Template'
                    : 'Create New Recipe'}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton
              action="import"
              onClick={openImportModal}
              iconClassName="bi bi-upload text-base"
              size="sm"
            />
            {embedded && onClose ? (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close create recipe"
                title="Close"
                className="dm-x-button"
              >
                <i className="bi bi-x-lg text-sm leading-none" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>

        {isRejectedRecipe ? (
          <div className="rounded-md border border-danger/30 bg-danger/5 p-4 text-sm">
            <p className="font-semibold text-danger">
              Rejected by {rejectionReviewer}
            </p>
            <p className="mt-2 text-foreground">
              {baseRecipe?.rejectionReason?.trim() ||
                'No rejection reason was provided.'}
            </p>
          </div>
        ) : null}

        {isCreateFromRecipe ? (
          <div className="rounded-md border border-primary/30 bg-primary-soft p-4 text-sm">
            <p className="font-semibold text-primary">New recipe version</p>
            <p className="mt-1 text-foreground">
              Based on {baseRecipe?.name} {formatRecipeVersion(baseRecipeVersion)}
              {baseRecipe?.recipeCode ? ` (${baseRecipe.recipeCode})` : ''}. The
              base recipe will remain unchanged, and the next version number is
              assigned when this recipe is submitted.
            </p>
          </div>
        ) : null}

        {isCreateFromTemplate ? (
          <div className="rounded-md border border-accent-blue/30 bg-accent-blue/10 p-4 text-sm">
            <p className="font-semibold text-accent-blue">Recipe template</p>
            <p className="mt-1 text-foreground">
              Ingredients were copied from {baseRecipe?.name}{' '}
              {formatRecipeVersion(baseRecipeVersion)}. Change the recipe name and
              any ingredients you need; the result will be saved as a separate V1
              recipe.
            </p>
          </div>
        ) : null}

        {importOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div
              className="w-full max-w-xl rounded-md border border-border bg-surface p-6 shadow-xl"
              role="dialog"
              aria-modal="true"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-foreground">
                    Import Recipe
                  </h3>
                  <p className="mt-1 text-xs text-muted">
                    Import recipes from Excel
                  </p>
                  <p className="mt-2 text-sm text-muted">
                    Use .xlsx or .xls to import multiple recipes at once.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeImportModal}
                  className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-primary"
                >
                  Close
                </button>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto]">
                <div>
                  <label className="text-sm font-medium text-foreground">
                    File Excel
                  </label>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleImportFileChange}
                    className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-2 text-sm shadow-sm file:mr-4 file:rounded-xl file:border-0 file:bg-primary-soft file:px-3 file:py-2 file:text-xs file:font-semibold file:text-primary"
                  />
                  {importFile ? (
                    <p className="mt-2 text-xs text-muted">
                      Selected file: {importFile.name}
                    </p>
                  ) : null}
                  {importError ? (
                    <p className="mt-2 text-xs font-medium text-red-600">
                      {importError}
                    </p>
                  ) : null}
                  {importMessage ? (
                    <p className="mt-2 text-xs font-medium text-primary">
                      {importMessage}
                    </p>
                  ) : null}
                </div>

                <ActionButton
                  action="import"
                  onClick={handleImportRecipes}
                  className="h-fit self-end"
                />
              </div>
            </div>
          </div>
        ) : null}

        <div className="rounded-md border border-border bg-surface p-6 shadow-sm">
        <h3 className="font-semibold">Recipe details</h3>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-sm font-medium text-foreground">
              Recipe name
            </label>
            <input
              type="text"
              value={recipeForm.name}
              onChange={(event) => updateRecipeForm('name', event.target.value)}
              readOnly={isCreateFromRecipe}
              aria-readonly={isCreateFromRecipe}
              placeholder="Example: Teriyaki Chicken Rice"
              className={`mt-2 w-full rounded-2xl border border-border px-4 py-3 text-sm shadow-sm outline-none ${
                isCreateFromRecipe
                  ? 'bg-slate-200 text-muted'
                  : 'bg-white focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20'
              }`}
            />
            {isCreateFromTemplate ? (
              <p className="mt-2 text-xs text-muted">
                The new recipe name must be different from the source recipe.
              </p>
            ) : null}
          </div>
          <div>
            <label className="text-sm font-medium text-foreground">Category</label>
            <select
              value={recipeForm.category}
              onChange={(event) => updateRecipeForm('category', event.target.value)}
              disabled={categoriesLoading}
              className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
            >
              <option value="">
                {categoriesLoading
                  ? 'Loading categories...'
                  : categoryOptions.length
                    ? 'Select category'
                    : 'No active categories available'}
              </option>
              {recipeForm.category &&
              !categoryOptions.includes(recipeForm.category) ? (
                <option value={recipeForm.category}>
                  {recipeForm.category}
                </option>
              ) : null}
              {categoryOptions.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
            {categoriesError ? (
              <p className="mt-2 text-xs text-red-600">{categoriesError}</p>
            ) : null}
          </div>
          <div>
            <label className="text-sm font-medium text-foreground">Base pax</label>
            <input
              type="number"
              min={1}
              step="1"
              value={recipeForm.portionSize}
              onChange={(event) =>
                updateRecipeForm('portionSize', event.target.value)
              }
              onWheel={(event) => event.currentTarget.blur()}
              placeholder="1"
              className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
            />
            <p className="mt-2 text-xs text-muted">
              Enter how many pax this recipe yields (e.g., 1 or 10).
            </p>
          </div>
          <div className="sm:col-span-2">
            <label className="text-sm font-medium text-foreground">
              Description
            </label>
            <textarea
              value={recipeForm.description}
              onChange={(event) =>
                updateRecipeForm('description', event.target.value)
              }
              placeholder="Short recipe notes..."
              rows={3}
              className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
            />
          </div>
        </div>

        <div className="mt-6">
          <h3 className="font-semibold text-foreground">
            Ingredients
          </h3>
          <p className="mt-1 text-xs text-muted">
            Add ingredients
          </p>
          <TablePagination
            page={ingredientPage}
            totalPages={ingredientTotalPages}
            onPageChange={setIngredientPage}
            summary={`Showing ${paginatedIngredientRows.length} of ${ingredientRows.length} ingredient rows`}
            className="mt-3"
          />

          <div className="mt-4 max-w-full overflow-x-auto rounded-md border border-border">
            <datalist id="raw-material-code-options">
              {rawMaterialOptions.map((item) => (
                <option
                  key={`code-${item.id}`}
                  value={item.productCode}
                  label={item.name}
                />
              ))}
            </datalist>
            <table className="dm-table min-w-full bg-white text-sm">
              <thead className="bg-background">
                <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                  <th className="w-20 px-2 py-3 font-semibold" />
                  <th className="w-14 px-2 py-3 font-semibold text-center">
                    No
                  </th>
                  <th className="px-3 py-3 font-semibold w-[120px]">
                    Type
                  </th>
                  <th className="px-4 py-3 font-semibold w-[160px]">
                    Product code
                  </th>
                  <th className="px-4 py-3 font-semibold min-w-[390px]">
                    Name
                  </th>
                  <th className="px-4 py-3 font-semibold w-[120px]">
                    {enableIngredientUomConversion ? 'Prod Qty' : 'Qty'}
                  </th>
                  {enableIngredientUomConversion ? (
                    <>
                      <th className="px-4 py-3 font-semibold w-[160px]">
                        Prod UOM
                      </th>
                      <th className="px-4 py-3 font-semibold w-[140px]">
                        SR Qty
                      </th>
                      <th className="px-4 py-3 font-semibold w-[160px]">
                        SR UOM
                      </th>
                    </>
                  ) : (
                    <th className="px-4 py-3 font-semibold w-[180px]">
                      Unit of Measures
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {paginatedIngredientRows.map((row, index) => {
                  const conversionResult = calculateSrQty(row)
                  return (
                  <tr key={row.id} className="border-t border-border">
                    <td className="px-2 py-3">
                      <div className="flex justify-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveIngredientRow(row.id)}
                          className="dm-x-button text-sm font-semibold leading-none"
                          aria-label="Remove ingredient row"
                          title="Remove ingredient row"
                        >
                          <i
                            className="bi bi-trash3 text-sm leading-none"
                            aria-hidden="true"
                          />
                        </button>
                      </div>
                    </td>
                    <td className="px-2 py-3 text-center text-sm text-muted">
                      {(ingredientPage - 1) * INGREDIENT_ROWS_PER_PAGE + index + 1}
                    </td>
                    <td className="px-3 py-3">
                      <select
                        value={row.ingredientType}
                        onChange={(event) =>
                          updateIngredientRow(
                            row.id,
                            'ingredientType',
                            event.target.value as IngredientRow['ingredientType'],
                          )
                        }
                        className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                        aria-label={`Ingredient type for row ${index + 1}`}
                      >
                        <option value="">Select</option>
                        <option value="IT">IT</option>
                        <option value="NMP">NMP</option>
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        value={row.productCode}
                        readOnly={row.ingredientType === 'NMP'}
                        aria-readonly={row.ingredientType === 'NMP'}
                        onChange={(event) =>
                          handleIngredientInputChange(
                            row.id,
                            'productCode',
                            event.target.value,
                          )
                        }
                        onFocus={
                          row.ingredientType === 'NMP'
                            ? undefined
                            : handleRawMaterialFocus
                        }
                        autoComplete="off"
                        placeholder={row.ingredientType === 'NMP' ? 'NMP' : 'PRD-001'}
                        list="raw-material-code-options"
                        className={`w-full rounded-xl border border-border px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20 ${row.ingredientType === 'NMP' ? 'bg-slate-200 text-muted' : 'bg-white'}`}
                      />
                    </td>
                    <td className="relative px-4 py-3">
                      <div className="grid">
                        <input
                          type="text"
                          value={row.name}
                          onChange={(event) =>
                            handleIngredientInputChange(
                              row.id,
                              'name',
                              event.target.value,
                            )
                          }
                          onFocus={() => {
                            setActiveIngredientDropdownId(row.id)
                            const input = document.activeElement
                            if (input instanceof HTMLElement) {
                              positionIngredientDropdown(input)
                            }
                            handleRawMaterialFocus()
                          }}
                          onBlur={() => {
                            window.setTimeout(() => {
                              setActiveIngredientDropdownId((current) =>
                                current === row.id ? null : current,
                              )
                              setIngredientDropdownPosition(null)
                            }, 150)
                          }}
                          autoComplete="off"
                          placeholder="Oat Milk"
                          className="peer col-start-1 row-start-1 w-full rounded-xl border border-border bg-white px-3 py-2 text-sm leading-5 text-transparent caret-foreground outline-none placeholder:text-gray-400 focus:border-accent-blue focus:text-foreground focus:ring-4 focus:ring-accent-blue/20"
                        />
                        <div className="col-start-1 row-start-1 pointer-events-none whitespace-pre-wrap break-words px-3 py-2 text-sm leading-5 text-foreground peer-focus:opacity-0">
                          {row.name}
                        </div>
                      </div>
                      {activeIngredientDropdownId === row.id && rawMaterialOptions.length > 0 ? (
                        <div
                          className="fixed z-[100] w-[36rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-white shadow-xl"
                          style={
                            ingredientDropdownPosition
                              ? {
                                  left: ingredientDropdownPosition.left,
                                  top: ingredientDropdownPosition.top,
                                }
                              : undefined
                          }
                        >
                          <div className="max-h-72 overflow-y-auto py-1">
                            {rawMaterialOptions.map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => selectRawMaterialForRow(row.id, item)}
                                className="block w-full border-b border-border px-4 py-3 text-left last:border-b-0 hover:bg-primary-soft"
                              >
                                <span className="block truncate text-sm font-semibold text-foreground">
                                  {item.name}
                                </span>
                                <span className="mt-1 block text-xs text-muted">
                                  {item.productCode}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={row.qty}
                        onChange={(event) =>
                          updateIngredientRow(row.id, 'qty', event.target.value)
                        }
                        onWheel={(event) => event.currentTarget.blur()}
                        placeholder={enableIngredientUomConversion ? '700' : '2'}
                        className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                      />
                    </td>
                    {enableIngredientUomConversion ? (
                      <>
                        <td className="px-4 py-3">
                          <select
                            value={row.prodUomCode}
                            onChange={(event) =>
                              updateIngredientRow(
                                row.id,
                                'prodUomCode',
                                event.target.value,
                              )
                            }
                            className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                          >
                            <option value="">Select</option>
                            {uomOptions.map((unit) => (
                              <option key={unit.id} value={unit.code}>
                                {formatUnitLabel(unit.code)}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            min={0}
                            step="any"
                            value={
                              row.srQtyManual
                                ? row.srQty
                                : conversionResult
                                ? formatQuantity(conversionResult.srQty)
                                : row.srQty
                            }
                            onChange={(event) =>
                              updateIngredientSrQty(
                                row.id,
                                event.target.value,
                              )
                            }
                            onWheel={(event) => event.currentTarget.blur()}
                            aria-label={`SR QTY for ${row.name || `ingredient ${index + 1}`}`}
                            className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                          />
                        </td>
                        <td className="px-4 py-3">
                          {lockSrUomToRawMaterial && row.ingredientType !== 'NMP' ? (
                            <input
                              type="text"
                              value={
                                row.unitOfMeasures
                                  ? formatUnitLabel(row.unitOfMeasures)
                                  : ''
                              }
                              readOnly
                              aria-readonly="true"
                              aria-label={`SR UOM for ${row.name || `ingredient ${index + 1}`}`}
                              placeholder="Auto"
                              className="w-full rounded-xl border border-border bg-slate-200 px-3 py-2 text-sm text-muted outline-none"
                            />
                          ) : (
                            <select
                              value={row.unitOfMeasures}
                              onChange={(event) =>
                                updateIngredientRow(
                                  row.id,
                                  'unitOfMeasures',
                                  event.target.value,
                                )
                              }
                              className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                            >
                              <option value="">Select</option>
                              {row.unitOfMeasures &&
                              !srUomOptions.some(
                                (code) =>
                                  normalizeUomCode(code) ===
                                  normalizeUomCode(row.unitOfMeasures),
                              ) ? (
                                <option value={row.unitOfMeasures}>
                                  {formatUnitLabel(row.unitOfMeasures)}
                                </option>
                              ) : null}
                              {srUomOptions.map((code) => (
                                <option key={code} value={code}>
                                  {formatUnitLabel(code)}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>
                      </>
                    ) : (
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={
                            row.unitOfMeasures
                              ? formatUnitLabel(row.unitOfMeasures)
                              : ''
                          }
                          readOnly
                          aria-readonly="true"
                          placeholder="Auto-filled from raw material"
                          className="w-full rounded-xl border border-border bg-slate-200 px-3 py-2 text-sm text-muted outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                        />
                      </td>
                    )}
                  </tr>
                )})}
                <tr className="border-t border-border">
                  <td
                    colSpan={enableIngredientUomConversion ? 8 : 6}
                    className="px-4 py-3"
                  >
                    <div className="flex justify-center">
                      <button
                        type="button"
                        onClick={handleAddIngredientRow}
                        className="inline-flex items-center gap-2 rounded-md border border-primary bg-primary px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-primary-hover"
                      >
                        <span>+</span>
                        <span>Add ingredient</span>
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
          <div>
            {submitError ? (
              <p className="text-xs font-medium text-red-600">{submitError}</p>
            ) : null}
            {submitMessage ? (
              <p className="text-xs font-medium text-primary">{submitMessage}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {isRejectedRecipe ? (
              <ActionButton
                action="save"
                onClick={() => handleSaveRecipe()}
              />
            ) : null}
            <ActionButton
              action={isEditMode && !isRejectedRecipe ? 'update' : 'submit'}
              onClick={() =>
                isRejectedRecipe
                  ? setResubmitModalOpen(true)
                  : handleSaveRecipe()
              }
            />
          </div>
        </div>
      </div>
    </div>
    </div>
  )
}

export default ChefCreateMenu

