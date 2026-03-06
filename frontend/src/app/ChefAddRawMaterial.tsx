import { useEffect, useState, type ChangeEvent } from 'react'
import { apiFetch } from '../lib/api'
import { readStoredToken } from '../lib/auth'
import { useChefData } from '../lib/chef-data'
import { unitOfMeasuresOptions } from '../lib/unit-of-measures'

type RawMaterialForm = {
  productCode: string
  name: string
  unitOfMeasures: string
}

type NotificationItem = {
  id?: string
  _id?: string
  title?: string
  message?: string
  meta?: Record<string, unknown>
  createdAt?: string
}

type ImportResult = {
  status: 'success' | 'error'
  title: string
  message: string
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
  const [importOpen, setImportOpen] = useState(false)
  const [importStartedAt, setImportStartedAt] = useState<number | null>(null)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)

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
    setImportError('')
    setImportMessage('')
    setImportResult(null)
    setImportOpen(true)
  }

  const closeImportModal = () => {
    setImportOpen(false)
  }

  const closeImportResult = () => {
    setImportResult(null)
  }

  const handleImportRawMaterials = async () => {
    if (!importFile) {
      setImportError('Select an Excel file first')
      setImportMessage('')
      return
    }

    if (importing) return

    setImporting(true)
    setImportError('')
    setImportMessage('Starting import...')
    setImportResult(null)
    try {
      await importRawMaterialsFromExcel(importFile)
      setImportStartedAt(Date.now())
      setImportMessage('Import started. Waiting for completion...')
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to start raw material import.'
      setImportError(message)
      setImportMessage('')
      setImporting(false)
      setImportStartedAt(null)
    }
  }

  useEffect(() => {
    if (!importing || !importStartedAt) return

    let cancelled = false
    let timeoutId: number | undefined

    const pollStatus = async () => {
      const token = readStoredToken()
      if (!token) {
        setImportError('Please log in first to check import status.')
        setImportMessage('')
        setImporting(false)
        setImportStartedAt(null)
        return
      }

      try {
        const notifications = await apiFetch<NotificationItem[]>(
          '/notifications?page=1&limit=25',
          undefined,
          token,
        )
        if (cancelled) return
        const match = notifications.find((item) => {
          if (!item?.title || !item.createdAt) return false
          if (
            item.title !== 'Raw material import completed' &&
            item.title !== 'Raw material import failed'
          ) {
            return false
          }
          const createdAt = new Date(item.createdAt).getTime()
          return Number.isFinite(createdAt) && createdAt >= importStartedAt
        })

        if (match) {
          const isSuccess = match.title === 'Raw material import completed'
          let message = match.message ?? ''
          if (!isSuccess) {
            const reason =
              match.meta && typeof match.meta.reason === 'string'
                ? match.meta.reason
                : ''
            if (reason) {
              message = `${message} (${reason})`
            }
          }

          setImportResult({
            status: isSuccess ? 'success' : 'error',
            title: match.title ?? 'Import finished',
            message: message || 'Import finished.',
          })
          setImporting(false)
          setImportOpen(false)
          setImportError('')
          setImportMessage('')
          setImportFile(null)
          setImportStartedAt(null)
          if (isSuccess) {
            fetchRawMaterials(1, rawMaterialsMeta.limit).catch(() => null)
          }
          return
        }
      } catch (error) {
        if (cancelled) return
        const message =
          error instanceof Error ? error.message : 'Failed to check import status.'
        setImportResult({
          status: 'error',
          title: 'Import failed',
          message,
        })
        setImporting(false)
        setImportOpen(false)
        setImportMessage('')
        setImportStartedAt(null)
        return
      }

      if (!cancelled) {
        timeoutId = window.setTimeout(pollStatus, 2000)
      }
    }

    timeoutId = window.setTimeout(pollStatus, 2000)

    return () => {
      cancelled = true
      if (timeoutId) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [fetchRawMaterials, importing, importStartedAt, rawMaterialsMeta.limit])

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Add Raw Material</h1>
          </div>
          <button
            type="button"
            onClick={openImportModal}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white shadow-sm"
          >
            <i className="bi bi-upload text-base" aria-hidden="true" />
            <span>Import raw materials</span>
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
                  <h3 className="font-semibold text-foreground">
                    Import Raw Material
                  </h3>
                  <p className="mt-1 text-xs text-muted">
                    Upload Excel file
                  </p>
                  <p className="mt-2 text-sm text-muted">
                    Upload an Excel file to add multiple raw materials at once.
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

              <div className="mt-5 space-y-4">
                <div>
                  <label className="text-sm font-medium text-foreground">
                    File Excel
                  </label>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleImportFileChange}
                    disabled={importing}
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
                  className="w-full rounded-md border border-border bg-background px-4 py-3 text-sm font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Import raw materials
                </button>
                {importMessage ? (
                  <p className="text-xs font-medium text-primary">
                    {importMessage}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {importResult ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div
              className="w-full max-w-md rounded-md border border-border bg-surface p-6 shadow-xl"
              role="dialog"
              aria-modal="true"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-muted">
                    Import Raw Material
                  </p>
                  <h3
                    className={`mt-2 text-lg font-semibold ${
                      importResult.status === 'success'
                        ? 'text-primary'
                        : 'text-red-600'
                    }`}
                  >
                    {importResult.title}
                  </h3>
                  <p className="mt-2 text-sm text-muted">
                    {importResult.message}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeImportResult}
                  className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-primary"
                >
                  Close
                </button>
              </div>
              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  onClick={closeImportResult}
                  className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white"
                >
                  Ok
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-12">
          <div className="rounded-md border border-border bg-surface p-6 shadow-sm lg:col-span-12">
            <h3 className="font-semibold">Material details</h3>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="text-sm font-medium text-foreground">
                  Product name
                </label>
                <input
                  type="text"
                  value={rawMaterialForm.name}
                  onChange={(event) =>
                    updateRawMaterialForm('name', event.target.value)
                  }
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
                className="w-full rounded-md bg-primary px-4 py-3 text-sm font-semibold text-white shadow-[0_16px_35px_rgba(11,41,87,0.35)] sm:w-auto"
              >
                Save material
              </button>
              <p className="mt-3 text-xs text-muted">
                After saving, the material will appear in Raw Material Data.
              </p>
              {saveError ? (
                <p className="mt-2 text-xs font-medium text-red-600">
                  {saveError}
                </p>
              ) : null}
              {saveMessage ? (
                <p className="mt-2 text-xs font-medium text-primary">
                  {saveMessage}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ChefAddRawMaterial
