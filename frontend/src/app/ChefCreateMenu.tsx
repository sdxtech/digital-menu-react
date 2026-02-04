import { useEffect, useState, type ChangeEvent } from 'react'
import {
  useChefData,
  type RecipeIngredient,
} from '../lib/chef-data'
import { unitOfMeasuresOptions } from '../lib/unit-of-measures'

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

const createIngredientRow = (): IngredientRow => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  productCode: '',
  name: '',
  unitOfMeasures: '',
  qty: '',
})

const initialRecipeForm: RecipeForm = {
  name: '',
  category: '',
  description: '',
  portionSize: '1',
}

const ChefCreateMenu = () => {
  const {
    createRecipe,
    importRecipesFromExcel,
    rawMaterials,
    fetchRawMaterials,
  } = useChefData()

  const [recipeForm, setRecipeForm] = useState<RecipeForm>(initialRecipeForm)
  const [ingredientRows, setIngredientRows] = useState<IngredientRow[]>([
    createIngredientRow(),
  ])

  const [submitError, setSubmitError] = useState('')
  const [submitMessage, setSubmitMessage] = useState('')
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importError, setImportError] = useState('')
  const [importMessage, setImportMessage] = useState('')

  useEffect(() => {
    fetchRawMaterials(1, 500).catch(() => null)
  }, [fetchRawMaterials])

  const normalizeValue = (value: string) => value.trim().toLowerCase()
  const findRawMaterialByCode = (value: string) => {
    const normalized = normalizeValue(value)
    return rawMaterials.find(
      (item) => normalizeValue(item.productCode) === normalized,
    )
  }
  const findRawMaterialByName = (value: string) => {
    const normalized = normalizeValue(value)
    return rawMaterials.find(
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

  const handleCreateRecipe = async () => {
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
      setSubmitError('Base servings must be a number greater than 0.')
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
      await createRecipe({
        name: nextName,
        category: nextCategory,
        description: nextDescription,
        price: 0,
        portionSize,
        status: 'draft',
        ingredients: parsedIngredients,
      })

      setRecipeForm(initialRecipeForm)
      setIngredientRows([createIngredientRow()])
      setSubmitError('')
      setSubmitMessage('Recipe saved and submitted to the Unit Manager.')
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
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-muted">
          Create New Recipe
        </p>
        <h2 className="mt-2 text-2xl font-semibold">Create a new recipe</h2>
      </div>

      <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
        <p className="text-xs uppercase tracking-[0.2em] text-muted">
          Import Recipe
        </p>
        <h3 className="mt-2 text-lg font-semibold">Import recipes from Excel</h3>
        <p className="mt-2 text-sm text-muted">
          Use .xlsx or .xls to import multiple recipes at once.
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto]">
          <div>
            <label className="text-sm font-medium text-foreground">File Excel</label>
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
              <p className="mt-2 text-xs font-medium text-red-600">{importError}</p>
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
            className="h-fit self-end rounded-2xl border border-border bg-background px-4 py-3 text-sm font-semibold text-primary"
          >
            Import recipes
          </button>
        </div>
      </div>

      <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
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
            <label className="text-sm font-medium text-foreground">
              Base servings
            </label>
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
              Enter how many servings this recipe yields (e.g., 1 or 10).
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
          <p className="text-xs uppercase tracking-[0.2em] text-muted">
            Ingredients
          </p>
          <h4 className="mt-2 text-lg font-semibold">Add ingredients</h4>

          <div className="mt-4 overflow-x-auto rounded-2xl border border-border">
            <datalist id="raw-material-code-options">
              {rawMaterials.map((item) => (
                <option
                  key={`code-${item.id}`}
                  value={item.productCode}
                  label={item.name}
                />
              ))}
            </datalist>
            <datalist id="raw-material-name-options">
              {rawMaterials.map((item) => (
                <option
                  key={`name-${item.id}`}
                  value={item.name}
                  label={item.productCode}
                />
              ))}
            </datalist>
            <table className="min-w-full bg-white text-sm">
              <thead className="bg-background">
                <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                  <th className="w-20 px-2 py-3 font-semibold" />
                  <th className="px-4 py-3 font-semibold">Product code</th>
                  <th className="px-4 py-3 font-semibold">Name</th>
                  <th className="px-4 py-3 font-semibold">Qty</th>
                  <th className="px-4 py-3 font-semibold">Unit of Measures</th>
                </tr>
              </thead>
              <tbody>
                {ingredientRows.map((row) => (
                  <tr key={row.id} className="border-t border-border">
                    <td className="px-2 py-3">
                      <div className="flex justify-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveIngredientRow(row.id)}
                          className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-danger/40 bg-surface text-base font-bold text-danger shadow-sm transition hover:bg-danger hover:text-white hover:shadow-md"
                          aria-label="Remove ingredient row"
                          title="Remove ingredient row"
                        >
                          X
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        value={row.productCode}
                        onChange={(event) =>
                          updateIngredientRow(
                            row.id,
                            'productCode',
                            event.target.value,
                          )
                        }
                        placeholder="PRD-001"
                        list="raw-material-code-options"
                        className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        value={row.name}
                        onChange={(event) =>
                          updateIngredientRow(row.id, 'name', event.target.value)
                        }
                        placeholder="Oat Milk"
                        list="raw-material-name-options"
                        className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                      />
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
                        <option value="">Select a unit</option>
                        {unitOfMeasuresOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-border">
                  <td colSpan={5} className="px-4 py-3">
                    <div className="flex justify-center">
                      <button
                        type="button"
                        onClick={handleAddIngredientRow}
                        className="inline-flex items-center gap-2 rounded-2xl border border-border bg-background px-4 py-2 text-xs font-semibold text-primary"
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
            onClick={handleCreateRecipe}
            className="rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-white shadow-[0_16px_35px_rgba(11,41,87,0.35)]"
          >
            Save & submit to Unit Manager
          </button>
        </div>
      </div>
    </div>
  )
}

export default ChefCreateMenu
