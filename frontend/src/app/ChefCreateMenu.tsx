import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useLocation } from 'react-router-dom'
import TablePagination from '../components/TablePagination'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'
import {
  useChefData,
  type RawMaterial,
  type RecipeIngredient,
} from '../lib/chef-data'
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
  productCode: string
  name: string
  unitOfMeasures: string
  qty: string
}

type CategoryApi = {
  id?: string
  _id?: string
  name?: string
}

export type BaseRecipe = {
  id?: string
  name: string
  category: string
  description?: string
  portionSize?: number
  approvalStatus?: 'pending' | 'approved' | 'rejected'
  rejectionReason?: string
  reviewedBy?: string
  reviewedByName?: string
  reviewedByEmail?: string
  ingredients?: RecipeIngredient[]
}

const createIngredientRow = (
  values: Partial<IngredientRow> = {},
): IngredientRow => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  productCode: values.productCode ?? '',
  name: values.name ?? '',
  unitOfMeasures: values.unitOfMeasures ?? '',
  qty: values.qty ?? '',
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
  onClose?: () => void
  onSaved?: () => void
}

const ChefCreateMenu = ({
  embedded = false,
  baseRecipe: baseRecipeProp,
  onClose,
  onSaved,
}: ChefCreateMenuProps) => {
  const location = useLocation()
  const { accessToken } = useAuth()
  const {
    createRecipe,
    updateRecipe,
    resubmitRecipe,
    importRecipesFromExcel,
    searchRawMaterials,
  } = useChefData()

  const baseRecipe =
    baseRecipeProp ??
    (location.state as { baseRecipe?: BaseRecipe } | null)?.baseRecipe
  const editingRecipeId = baseRecipe?.id ?? ''
  const isEditMode = Boolean(editingRecipeId)
  const [currentApprovalStatus, setCurrentApprovalStatus] = useState(
    baseRecipe?.approvalStatus,
  )
  const [recipeForm, setRecipeForm] = useState<RecipeForm>(initialRecipeForm)
  const [ingredientRows, setIngredientRows] = useState<IngredientRow[]>([
    createIngredientRow(),
  ])

  const [rawMaterialOptions, setRawMaterialOptions] = useState<RawMaterial[]>([])
  const [categoryOptions, setCategoryOptions] = useState<string[]>([])
  const [categoriesLoading, setCategoriesLoading] = useState(false)
  const [categoriesError, setCategoriesError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [submitMessage, setSubmitMessage] = useState('')
  const [ingredientPage, setIngredientPage] = useState(1)
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
              productCode: ingredient.productCode ?? '',
              name: ingredient.name ?? '',
              unitOfMeasures: ingredient.unitOfMeasures ?? '',
              qty: Number.isFinite(ingredient.qty) ? String(ingredient.qty) : '',
            }),
          )
        : [createIngredientRow()],
    )
    setSubmitError('')
    setSubmitMessage('')
  }, [baseRecipe])

  useEffect(() => {
    if (!accessToken) {
      setCategoryOptions([])
      setCategoriesLoading(false)
      setCategoriesError('')
      return
    }

    let isCancelled = false

    const loadCategories = async () => {
      setCategoriesLoading(true)
      setCategoriesError('')

      try {
        const params = new URLSearchParams({
          page: '1',
          limit: '100',
          isActive: 'true',
        })
        const data = await apiFetch<{ items?: CategoryApi[] }>(
          `/categories?${params.toString()}`,
          undefined,
          accessToken,
        )
        if (isCancelled) return

        const names = (data.items ?? [])
          .map((item) => item.name?.trim() ?? '')
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b))

        setCategoryOptions(names)
      } catch (error) {
        if (isCancelled) return

        setCategoryOptions([])
        setCategoriesError(
          error instanceof Error ? error.message : 'Failed to load categories.',
        )
      } finally {
        if (!isCancelled) {
          setCategoriesLoading(false)
        }
      }
    }

    loadCategories().catch(() => null)

    return () => {
      isCancelled = true
    }
  }, [accessToken])

  useEffect(() => {
    const requestId = ++searchRequestRef.current
    searchRawMaterials('', 5)
      .then((results) => {
        if (!isMountedRef.current || searchRequestRef.current !== requestId) {
          return
        }
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
        if (field === 'productCode' && typeof value === 'string') {
          const matched = findRawMaterialByCode(value)
          if (matched) {
            next.productCode = matched.productCode
            next.name = matched.name
            next.unitOfMeasures = matched.unitOfMeasures
          }
        }

        if (field === 'name' && typeof value === 'string') {
          const matched = findRawMaterialByName(value)
          if (matched) {
            next.productCode = matched.productCode
            next.name = matched.name
            next.unitOfMeasures = matched.unitOfMeasures
          }
        }

        return next
      }),
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
    const fetchLimit = trimmed ? 40 : 5

    searchTimeoutRef.current = window.setTimeout(async () => {
      try {
        const results = await searchRawMaterials(trimmed, fetchLimit)
        if (!isMountedRef.current || searchRequestRef.current !== requestId) {
          return
        }
        const ranked = trimmed ? rankRawMaterials(trimmed, results) : results
        setRawMaterialOptions(ranked.slice(0, 5))

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
              return {
                ...row,
                productCode: matched.productCode,
                name: matched.name,
                unitOfMeasures: matched.unitOfMeasures,
              }
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
    const portionRaw = recipeForm.portionSize.trim()

    if (!nextName || !nextCategory) {
      setSubmitError('Complete the recipe name and category first.')
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
        row.qty.trim()
      )
    })

    if (usedRows.length === 0) {
      setSubmitError('Add at least 1 ingredient before submitting the recipe.')
      setSubmitMessage('')
      return
    }

    const parsedIngredients: RecipeIngredient[] = []
    for (const row of usedRows) {
      const productCode = row.productCode.trim()
      const name = row.name.trim()
      const unitOfMeasures = row.unitOfMeasures.trim()
      const qtyRaw = row.qty.trim()

      if (!productCode || !name || !unitOfMeasures || !qtyRaw) {
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

      parsedIngredients.push({
        productCode,
        name,
        unitOfMeasures,
        qty,
      })
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

      if (isEditMode && editingRecipeId) {
        await updateRecipe(editingRecipeId, basePayload)
        if (options.resubmit) {
          await resubmitRecipe(editingRecipeId)
          setCurrentApprovalStatus('pending')
        }
        onSaved?.()
      } else {
        await createRecipe({
          ...basePayload,
          status: 'draft',
        })
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
  const selectedCategory = recipeForm.category.trim()
  const selectedCategoryMissing =
    Boolean(selectedCategory) && !categoryOptions.includes(selectedCategory)
  const availableCategoryOptions = selectedCategoryMissing
    ? [selectedCategory, ...categoryOptions]
    : categoryOptions
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
      <div className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">
              {isEditMode ? 'Edit Recipe' : 'Create New Recipe'}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openImportModal}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white shadow-sm"
            >
              <i className="bi bi-upload text-base" aria-hidden="true" />
              <span>Import recipes</span>
            </button>
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

                <button
                  type="button"
                  onClick={handleImportRecipes}
                  className="h-fit self-end rounded-md border border-border bg-background px-4 py-3 text-sm font-semibold text-primary"
                >
                  Import recipes
                </button>
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
              placeholder="Example: Teriyaki Chicken Rice"
              className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground">Category</label>
            <select
              value={recipeForm.category}
              onChange={(event) => updateRecipeForm('category', event.target.value)}
              disabled={categoriesLoading || availableCategoryOptions.length === 0}
              className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
            >
              <option value="">
                {categoriesLoading
                  ? 'Loading categories...'
                  : availableCategoryOptions.length
                    ? 'Select category'
                    : 'No active categories'}
              </option>
              {availableCategoryOptions.map((category) => (
                <option key={category} value={category}>
                  {category}
                  {selectedCategoryMissing && category === selectedCategory
                    ? ' (current category)'
                    : ''}
                </option>
              ))}
            </select>
            {selectedCategoryMissing ? (
              <p className="mt-2 text-xs text-muted">
                Current recipe category is not in the active category list.
              </p>
            ) : null}
            {categoriesError ? (
              <p className="mt-2 text-xs font-medium text-red-600">
                {categoriesError}
              </p>
            ) : null}
            {!categoriesLoading &&
            !categoriesError &&
            availableCategoryOptions.length === 0 ? (
              <p className="mt-2 text-xs text-muted">
                No active category is available. Ask Superadmin to create one
                first.
              </p>
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
            <datalist id="raw-material-name-options">
              {rawMaterialOptions.map((item) => (
                <option
                  key={`name-${item.id}`}
                  value={item.name}
                  label={item.productCode}
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
                  <th className="px-4 py-3 font-semibold w-[160px]">
                    Product code
                  </th>
                  <th className="px-4 py-3 font-semibold min-w-[260px]">
                    Name
                  </th>
                  <th className="px-4 py-3 font-semibold w-[120px]">Qty</th>
                  <th className="px-4 py-3 font-semibold w-[180px]">
                    Unit of Measures
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginatedIngredientRows.map((row, index) => (
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
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        value={row.productCode}
                        onChange={(event) =>
                          handleIngredientInputChange(
                            row.id,
                            'productCode',
                            event.target.value,
                          )
                        }
                        onFocus={handleRawMaterialFocus}
                        autoComplete="off"
                        placeholder="PRD-001"
                        list="raw-material-code-options"
                        className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                      />
                    </td>
                    <td className="px-4 py-3">
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
                          onFocus={handleRawMaterialFocus}
                          autoComplete="off"
                          placeholder="Oat Milk"
                          list="raw-material-name-options"
                          className="peer col-start-1 row-start-1 w-full rounded-xl border border-border bg-white px-3 py-2 text-sm leading-5 text-transparent caret-foreground outline-none placeholder:text-gray-400 focus:border-accent-blue focus:text-foreground focus:ring-4 focus:ring-accent-blue/20"
                        />
                        <div className="col-start-1 row-start-1 pointer-events-none whitespace-pre-wrap break-words px-3 py-2 text-sm leading-5 text-foreground peer-focus:opacity-0">
                          {row.name}
                        </div>
                      </div>
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
                        placeholder="2"
                        className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                      />
                    </td>
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
                  </tr>
                ))}
                <tr className="border-t border-border">
                  <td colSpan={6} className="px-4 py-3">
                    <div className="flex justify-center">
                      <button
                        type="button"
                        onClick={handleAddIngredientRow}
                        className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-xs font-semibold text-primary"
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
              <button
                type="button"
                onClick={() => handleSaveRecipe()}
                className="rounded-md border border-border bg-background px-4 py-3 text-sm font-semibold text-primary"
              >
                Save draft
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => handleSaveRecipe({ resubmit: isRejectedRecipe })}
              className="rounded-md bg-primary px-4 py-3 text-sm font-semibold text-white shadow-[0_16px_35px_rgba(11,41,87,0.35)]"
            >
              {isRejectedRecipe
                ? 'Resubmit to Unit Manager'
                : isEditMode
                  ? 'Update recipe'
                  : 'Save & submit to Unit Manager'}
            </button>
          </div>
        </div>
      </div>
    </div>
    </div>
  )
}

export default ChefCreateMenu

