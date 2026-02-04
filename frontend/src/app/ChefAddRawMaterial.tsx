import { useState, type ChangeEvent } from 'react'
import { useChefData } from '../lib/chef-data'
import { unitOfMeasuresOptions } from '../lib/unit-of-measures'

type RawMaterialForm = {
  productCode: string
  name: string
  unitOfMeasures: string
}

const emptyRawMaterialForm: RawMaterialForm = {
  productCode: '',
  name: '',
  unitOfMeasures: '',
}

const ChefAddRawMaterial = () => {
  const { addRawMaterial, importRawMaterialsFromExcel, fetchRawMaterials, rawMaterialsMeta } =
    useChefData()
  const [rawMaterialForm, setRawMaterialForm] =
    useState<RawMaterialForm>(emptyRawMaterialForm)
  const [saveError, setSaveError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importError, setImportError] = useState('')
  const [importMessage, setImportMessage] = useState('')
  const [importing, setImporting] = useState(false)

  const updateRawMaterialForm = <K extends keyof RawMaterialForm>(
    field: K,
    value: RawMaterialForm[K],
  ) => {
    setRawMaterialForm((prev) => ({
      ...prev,
      [field]: value,
    }))
  }

  const handleSaveRawMaterial = async () => {
    const next = {
      productCode: rawMaterialForm.productCode.trim(),
      name: rawMaterialForm.name.trim(),
      unitOfMeasures: rawMaterialForm.unitOfMeasures.trim(),
    }

    if (!next.productCode || !next.name || !next.unitOfMeasures) {
      setSaveError('Please complete all raw material fields first.')
      setSaveMessage('')
      return
    }

    try {
      await addRawMaterial(next)
      setSaveError('')
      setSaveMessage('Raw material saved to the database.')
      setRawMaterialForm(emptyRawMaterialForm)
      fetchRawMaterials(1, rawMaterialsMeta.limit).catch(() => null)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to save raw material.'
      setSaveError(message)
      setSaveMessage('')
    }
  }

  const handleImportFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] ?? null
    setImportMessage('')
    setImporting(false)

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

  const handleImportRawMaterials = async () => {
    if (!importFile) {
      setImportError('Select an Excel file first')
      setImportMessage('')
      return
    }

    setImporting(true)
    try {
      await importRawMaterialsFromExcel(importFile)
      setImportError('')
      setImportMessage('')
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to start raw material import.'
      setImportError(message)
      setImportMessage('')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-muted">
          Add Raw Material
        </p>
        <h2 className="mt-2 text-2xl font-semibold">Add a new raw material</h2>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm lg:col-span-8">
          <h3 className="text-lg font-semibold">Material details</h3>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="text-sm font-medium text-foreground">
                Product name
              </label>
              <input
                type="text"
                value={rawMaterialForm.name}
                onChange={(event) => updateRawMaterialForm('name', event.target.value)}
                placeholder="Example: Oat Milk"
                className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">
                Product code
              </label>
              <input
                type="text"
                value={rawMaterialForm.productCode}
                onChange={(event) =>
                  updateRawMaterialForm('productCode', event.target.value)
                }
                placeholder="Example: RM-001"
                className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">
                Unit of Measures
              </label>
              <select
                value={rawMaterialForm.unitOfMeasures}
                onChange={(event) =>
                  updateRawMaterialForm('unitOfMeasures', event.target.value)
                }
                className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
              >
                <option value="">Select a unit</option>
                {unitOfMeasuresOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-6 border-t border-border pt-5">
            <button
              type="button"
              onClick={handleSaveRawMaterial}
              className="w-full rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-white shadow-[0_16px_35px_rgba(11,41,87,0.35)] sm:w-auto"
            >
              Save material
            </button>
            <p className="mt-3 text-xs text-muted">
              After saving, the material will appear in Raw Material Data.
            </p>
            {saveError ? (
              <p className="mt-2 text-xs font-medium text-red-600">{saveError}</p>
            ) : null}
            {saveMessage ? (
              <p className="mt-2 text-xs font-medium text-primary">{saveMessage}</p>
            ) : null}
          </div>
        </div>

        <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm lg:col-span-4">
          <h3 className="text-lg font-semibold">Import Raw Material</h3>
          <p className="mt-2 text-sm text-muted">
            Upload an Excel file to add multiple raw materials at once.
          </p>

          <div className="mt-5 space-y-4">
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
              {importing ? (
                <div className="mt-3" aria-label="Import in progress">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-primary-soft">
                    <div className="h-full w-2/3 animate-pulse rounded-full bg-primary" />
                  </div>
                  <span className="sr-only">Import in progress</span>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={handleImportRawMaterials}
              disabled={importing}
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              Import raw materials
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ChefAddRawMaterial
