import { useState, type ChangeEvent } from 'react'
import {
  useChefData,
  type RecipeIngredient,
} from '../lib/chef-data'
import { unitOfMeasuresOptions } from '../lib/unit-of-measures'

type RecipeForm = {
  name: string
  category: string
  description: string
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
}

const ChefCreateMenu = () => {
  const { createRecipe, importRecipesFromExcel } = useChefData()

  const [recipeForm, setRecipeForm] = useState<RecipeForm>(initialRecipeForm)
  const [ingredientRows, setIngredientRows] = useState<IngredientRow[]>([
    createIngredientRow(),
  ])

  const [submitError, setSubmitError] = useState('')
  const [submitMessage, setSubmitMessage] = useState('')
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importError, setImportError] = useState('')
  const [importMessage, setImportMessage] = useState('')

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
      prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
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
      setImportError('File harus format .xlsx atau .xls')
      return
    }

    setImportFile(nextFile)
    setImportError('')
  }

  const handleImportRecipes = () => {
    if (!importFile) {
      setImportError('Pilih file excel terlebih dahulu')
      setImportMessage('')
      return
    }

    const importedCount = importRecipesFromExcel(importFile.name)
    setImportError('')
    setImportMessage(
      `${importedCount} recipe berhasil diimport dari ${importFile.name}`,
    )
  }

  const handleCreateRecipe = () => {
    const nextName = recipeForm.name.trim()
    const nextCategory = recipeForm.category.trim()
    const nextDescription = recipeForm.description.trim()

    if (!nextName || !nextCategory) {
      setSubmitError('Lengkapi nama recipe dan kategori terlebih dahulu.')
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
      setSubmitError('Tambah minimal 1 ingredient sebelum submit recipe.')
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
        setSubmitError('Pastikan setiap row ingredient terisi lengkap.')
        setSubmitMessage('')
        return
      }

      const qty = Number(qtyRaw)
      if (!Number.isFinite(qty) || qty <= 0) {
        setSubmitError('Qty ingredient harus angka lebih dari 0.')
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

    createRecipe({
      name: nextName,
      category: nextCategory,
      description: nextDescription,
      price: 0,
      status: 'draft',
      ingredients: parsedIngredients,
    })

    setRecipeForm(initialRecipeForm)
    setIngredientRows([createIngredientRow()])
    setSubmitError('')
    setSubmitMessage('Recipe berhasil disimpan dan diajukan ke Unit Manager.')
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-muted">
          Create New Recipe
        </p>
        <h2 className="mt-2 text-2xl font-semibold">Susun recipe baru</h2>
      </div>

      <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
        <p className="text-xs uppercase tracking-[0.2em] text-muted">
          Import Recipe
        </p>
        <h3 className="mt-2 text-lg font-semibold">Import recipe dari excel</h3>
        <p className="mt-2 text-sm text-muted">
          Gunakan file .xlsx atau .xls untuk import banyak recipe sekaligus.
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
                File terpilih: {importFile.name}
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
            Import recipe
          </button>
        </div>
      </div>

      <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
        <h3 className="text-lg font-semibold">Detail recipe</h3>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-sm font-medium text-foreground">
              Nama recipe
            </label>
            <input
              type="text"
              value={recipeForm.name}
              onChange={(event) => updateRecipeForm('name', event.target.value)}
              placeholder="Contoh: Nasi Ayam Teriyaki"
              className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground">Kategori</label>
            <input
              type="text"
              value={recipeForm.category}
              onChange={(event) => updateRecipeForm('category', event.target.value)}
              placeholder="Main Course / Minuman"
              className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-sm font-medium text-foreground">Deskripsi</label>
            <textarea
              value={recipeForm.description}
              onChange={(event) =>
                updateRecipeForm('description', event.target.value)
              }
              placeholder="Catatan singkat recipe..."
              rows={3}
              className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
            />
          </div>
        </div>

        <div className="mt-6">
          <p className="text-xs uppercase tracking-[0.2em] text-muted">
            Ingredients
          </p>
          <h4 className="mt-2 text-lg font-semibold">Tambah ingredient</h4>

          <div className="mt-4 overflow-x-auto rounded-2xl border border-border">
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
                          aria-label="Hapus baris ingredient"
                          title="Hapus baris ingredient"
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
                        <option value="">Pilih unit</option>
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
            Simpan & Ajukan ke Unit Manager
          </button>
        </div>
      </div>
    </div>
  )
}

export default ChefCreateMenu
