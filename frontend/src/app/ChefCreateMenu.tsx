import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useLocation } from 'react-router-dom'
import {
  useChefData,
  type RawMaterial,
  type RecipeIngredient,
} from '../lib/chef-data'
import { formatUnitLabel } from '../lib/unit-of-measures'

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

type BaseRecipe = {
  id?: string
  name: string
  category: string
  description?: string
  portionSize?: number
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

const ChefCreateMenu = () => {
  const location = useLocation()
  const {
    createRecipe,
    updateRecipe,
    importRecipesFromExcel,
    searchRawMaterials,
  } = useChefData()

  const baseRecipe = (location.state as { baseRecipe?: BaseRecipe } | null)
    ?.baseRecipe
  const editingRecipeId = baseRecipe?.id ?? ''
  const isEditMode = Boolean(editingRecipeId)
  const [recipeForm, setRecipeForm] = useState<RecipeForm>(initialRecipeForm)
  const [ingredientRows, setIngredientRows] = useState<IngredientRow[]>([
    createIngredientRow(),
  ])

  const [rawMaterialOptions, setRawMaterialOptions] = useState<RawMaterial[]>([])
  const [submitError, setSubmitError] = useState('')
  const [submitMessage, setSubmitMessage] = useState('')
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
    setIngredientRows((prev) => [...prev, createIngredientRow()])
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

  const handleSaveRecipe = async () => {
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
      } else {
        await createRecipe({
          ...basePayload,
          status: 'draft',
        })
        setRecipeForm(initialRecipeForm)
        setIngredientRows([createIngredientRow()])
      }

      setSubmitError('')
      setSubmitMessage(
        isEditMode
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

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">
              {isEditMode ? 'Edit Recipe' : 'Create New Recipe'}
            </h1>
          </div>
          <button
            type="button"
            onClick={openImportModal}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white shadow-sm"
          >
            <i className="bi bi-upload text-base" aria-hidden="true" />
            <span>Import recipes</span>
          </button>
        </div>

        {importOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div
              className="w-full max-w-xl rounded-md border border-border bg-surface p-6 shadow-xl"
              role="dialog"
              aria-modal="true"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-foreground">
                    Import Recipe
                  </h3>
                  <p className="mt-1 text-xs uppercase tracking-[0.2em] text-muted">
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
        <h3 className="text-lg font-semibold">Recipe details</h3>
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
            <input
              type="text"
              value={recipeForm.category}
              onChange={(event) => updateRecipeForm('category', event.target.value)}
              placeholder="Main Course / Beverage"
              className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
            />
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
          <h3 className="text-lg font-semibold text-foreground">
            Ingredients
          </h3>
          <p className="mt-1 text-xs uppercase tracking-[0.2em] text-muted">
            Add ingredients
          </p>

          <div className="mt-4 overflow-x-auto rounded-md border border-border">
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
                {ingredientRows.map((row, index) => (
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
                          X
                        </button>
                      </div>
                    </td>
                    <td className="px-2 py-3 text-center text-sm text-muted">
                      {index + 1}
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
                          className="peer col-start-1 row-start-1 h-full w-full rounded-xl border border-border bg-white px-3 py-2 text-sm leading-5 text-transparent caret-foreground outline-none placeholder:text-muted focus:border-accent-blue focus:text-foreground focus:ring-4 focus:ring-accent-blue/20"
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
          <button
            type="button"
            onClick={handleSaveRecipe}
            className="rounded-md bg-primary px-4 py-3 text-sm font-semibold text-white shadow-[0_16px_35px_rgba(11,41,87,0.35)]"
          >
            {isEditMode ? 'Update recipe' : 'Save & submit to Unit Manager'}
          </button>
        </div>
      </div>
    </div>
    </div>
  )
}

export default ChefCreateMenu

