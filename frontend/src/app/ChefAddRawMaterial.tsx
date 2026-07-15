import { useEffect, useState, type ChangeEvent } from 'react'
import { apiFetch } from '../lib/api'
import { readStoredToken } from '../lib/auth'
import { useChefData } from '../lib/chef-data'
import { unitOfMeasuresOptions } from '../lib/unit-of-measures'
import ActionButton from '../components/ActionButton'

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
  status: 'success' | 'error' | 'cancelled'
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
  const [importJobId, setImportJobId] = useState<string | null>(null)
  const [importCancelling, setImportCancelling] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)

  // Custom Dropdown Open State Toggle
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)

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
    setImportJobId(null)
    setImportCancelling(false)
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
    setImportJobId(null)
    setImportCancelling(false)
    try {
      const jobId = await importRawMaterialsFromExcel(importFile)
      setImportJobId(jobId)
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
      setImportJobId(null)
      setImportCancelling(false)
    }
  }

  const handleCancelImport = async () => {
    if (!importJobId || importCancelling) return

    const token = readStoredToken()
    if (!token) {
      setImportError('Please log in first to cancel import.')
      setImportMessage('')
      return
    }

    setImportCancelling(true)
    setImportError('')
    setImportMessage('Cancelling import...')

    try {
      const result = await apiFetch<{ status: string }>(
        `/imports/jobs/${encodeURIComponent(importJobId)}/cancel`,
        { method: 'POST' },
        token,
      )
      if (result.status === 'completed' || result.status === 'failed') {
        setImportResult({
          status: result.status === 'completed' ? 'success' : 'error',
          title:
            result.status === 'completed'
              ? 'Import already completed'
              : 'Import already failed',
          message:
            result.status === 'completed'
              ? 'The import finished before the cancellation request was applied.'
              : 'The import failed before the cancellation request was applied.',
        })
        setImporting(false)
        setImportOpen(false)
        setImportMessage('')
        setImportFile(null)
        setImportStartedAt(null)
        setImportJobId(null)
        return
      }

      const isRequested = result.status === 'cancel_requested'
      setImportResult({
        status: 'cancelled',
        title: isRequested ? 'Import cancellation requested' : 'Import cancelled',
        message: isRequested
          ? 'The import is active and will stop at the next safe checkpoint.'
          : 'The import job was cancelled before it completed.',
      })
      setImporting(false)
      setImportOpen(false)
      setImportMessage('')
      setImportFile(null)
      setImportStartedAt(null)
      setImportJobId(null)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to cancel import.'
      setImportError(message)
      setImportMessage('')
    } finally {
      setImportCancelling(false)
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
            item.title !== 'Raw material import failed' &&
            item.title !== 'Raw material import cancelled'
          ) {
            return false
          }
          const createdAt = new Date(item.createdAt).getTime()
          return Number.isFinite(createdAt) && createdAt >= importStartedAt
        })

        if (match) {
          const isSuccess = match.title === 'Raw material import completed'
          const isCancelled = match.title === 'Raw material import cancelled'
          let message = match.message ?? ''
          if (!isSuccess && !isCancelled) {
            const reason =
              match.meta && typeof match.meta.reason === 'string'
                ? match.meta.reason
                : ''
            if (reason) {
              message = `${message} (${reason})`
            }
          }

          setImportResult({
            status: isSuccess ? 'success' : isCancelled ? 'cancelled' : 'error',
            title: match.title ?? 'Import finished',
            message: message || 'Import finished.',
          })
          setImporting(false)
          setImportOpen(false)
          setImportError('')
          setImportMessage('')
          setImportFile(null)
          setImportStartedAt(null)
          setImportJobId(null)
          setImportCancelling(false)
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
        setImportJobId(null)
        setImportCancelling(false)
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

  // Locate current label from array map values
  const currentUnitLabel = unitOfMeasuresOptions.find(
    (o) => o.value === rawMaterialForm.unitOfMeasures
  )?.label || 'Select a unit'

  return (
    <div className="w-full py-2">
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold">Add Raw Material</h1>
            </div>
            <ActionButton
              action="import"
              onClick={openImportModal}
              iconClassName="bi bi-upload text-base"
              size="sm"
            />
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
                    disabled={importing || importCancelling}
                    className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
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
                      disabled={importing || importCancelling}
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
                  {importing ? (
                    <ActionButton
                      action="cancel"
                      onClick={handleCancelImport}
                      disabled={!importJobId || importCancelling}
                      fullWidth
                    />
                  ) : (
                    <ActionButton
                      action="import"
                      onClick={handleImportRawMaterials}
                      disabled={importing}
                      fullWidth
                    />
                  )}
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
                          : importResult.status === 'cancelled'
                            ? 'text-amber-700'
                          : 'text-red-600'
                      }`}
                    >
                      {importResult.title}
                    </h3>
                    <p className="mt-2 text-sm text-muted">
                      {importResult.message}
                    </p>
                  </div>
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
                
                {/* Clean Theme-Aligned Dropdown Implementation Container */}
                <div className="relative">
                  <label className="text-sm font-medium text-foreground">
                    Unit of Measures
                  </label>
                  
                  {/* Dropdown Menu Trigger Button Wrapper */}
                  <button
                    type="button"
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    className="mt-2 flex w-full items-center justify-between rounded-2xl border border-border bg-white px-4 py-3 text-sm text-foreground outline-none shadow-sm transition-all focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                  >
                    <span>{currentUnitLabel}</span>
                    <i className={`bi bi-chevron-down text-xs text-muted transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {/* Backdrop click closer overlay handler logic */}
                  {isDropdownOpen && (
                    <>
                      <div 
                        className="fixed inset-0 z-30 cursor-default" 
                        onClick={() => setIsDropdownOpen(false)} 
                      />
                      
                      {/* Floating custom list elements rendered above button viewport */}
                      <ul className="absolute left-0 right-0 z-40 mt-1 max-h-60 overflow-y-auto rounded-xl border border-border bg-white py-1.5 shadow-xl text-sm">
                        {unitOfMeasuresOptions.map((option) => (
                          <li
                            key={option.value}
                            onClick={() => {
                              updateRawMaterialForm('unitOfMeasures', option.value)
                              setIsDropdownOpen(false)
                            }}
                            className={`cursor-pointer px-4 py-2 transition-colors duration-150 ${
                              rawMaterialForm.unitOfMeasures === option.value
                                ? 'bg-primary-soft text-primary font-medium'
                                : 'text-foreground hover:bg-muted/60'
                            }`}
                          >
                            {option.label}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>

              </div>
              <div className="mt-6 border-t border-border pt-5">
                <ActionButton
                  action="save"
                  onClick={handleSaveRawMaterial}
                  className="sm:w-auto"
                  fullWidth
                />
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
    </div>
  )
}

export default ChefAddRawMaterial