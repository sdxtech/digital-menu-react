import { useCallback, useEffect, useMemo, useState } from 'react'
import TablePagination from '../components/TablePagination'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'

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
  ext?: number
  weight?: number
  isActive?: boolean
}

type UnitOfMeasure = {
  id: string
  code: string
  name: string
  isActive: boolean
}

type UnitConversion = {
  id: string
  prodUomCode: string
  srUomCode: string
  conversionId: string
  multiplier: number
  ext: number
  weight: number
  isActive: boolean
}

type Meta = {
  page: number
  limit: number
  total: number
  totalPages: number
  loading: boolean
  error: string
}

type UnitForm = {
  code: string
  name: string
}

type ConversionForm = {
  prodUomCode: string
  srUomCode: string
  multiplier: string
  ext: string
  weight: string
}

type ActiveTab = 'units' | 'conversions'
type StatusFilter = 'all' | 'active' | 'disabled'

const DEFAULT_LIMIT = 10

const emptyUnitForm: UnitForm = {
  code: '',
  name: '',
}

const emptyConversionForm: ConversionForm = {
  prodUomCode: '',
  srUomCode: '',
  multiplier: '',
  ext: '',
  weight: '',
}

const emptyMeta: Meta = {
  page: 1,
  limit: DEFAULT_LIMIT,
  total: 0,
  totalPages: 1,
  loading: false,
  error: '',
}

const mapUnit = (item: UnitOfMeasureApi): UnitOfMeasure => ({
  id: item.id ?? item._id ?? '',
  code: item.code ?? '',
  name: item.name ?? '',
  isActive: item.isActive ?? true,
})

const mapConversion = (item: UnitConversionApi): UnitConversion => ({
  id: item.id ?? item._id ?? '',
  prodUomCode: item.prodUomCode ?? '',
  srUomCode: item.srUomCode ?? '',
  conversionId: item.conversionId ?? '',
  multiplier: item.multiplier ?? 0,
  ext: item.ext ?? 0,
  weight: item.weight ?? 0,
  isActive: item.isActive ?? true,
})

const formatQuantity = (value: number) =>
  Number.isInteger(value) ? String(value) : String(value)

const roundUpNumber = (value: number, decimals: number) => {
  const factor = 10 ** decimals
  return Math.ceil(value * factor) / factor
}

const calculateMultiplier = (extRaw: string, weightRaw: string) => {
  const ext = Number(extRaw)
  const weight = Number(weightRaw)
  if (!ext || !weight || !Number.isFinite(ext) || !Number.isFinite(weight)) {
    return ''
  }
  return String(roundUpNumber((1 / ext) / weight, 6))
}

const SuperadminUnitOfMeasuresPage = () => {
  const { accessToken } = useAuth()
  const [activeTab, setActiveTab] = useState<ActiveTab>('units')
  const [units, setUnits] = useState<UnitOfMeasure[]>([])
  const [unitOptions, setUnitOptions] = useState<UnitOfMeasure[]>([])
  const [conversions, setConversions] = useState<UnitConversion[]>([])
  const [unitMeta, setUnitMeta] = useState<Meta>(emptyMeta)
  const [conversionMeta, setConversionMeta] = useState<Meta>(emptyMeta)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [unitForm, setUnitForm] = useState<UnitForm>(emptyUnitForm)
  const [conversionForm, setConversionForm] =
    useState<ConversionForm>(emptyConversionForm)
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null)
  const [editingConversionId, setEditingConversionId] = useState<string | null>(
    null,
  )
  const [message, setMessage] = useState('')
  const [formError, setFormError] = useState('')

  const activeUnitCodes = useMemo(
    () => unitOptions.filter((unit) => unit.isActive).map((unit) => unit.code),
    [unitOptions],
  )

  const buildParams = useCallback(
    (page: number, limit: number, searchValue: string) => {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('limit', String(limit))
      if (searchValue.trim()) params.set('search', searchValue.trim())
      if (statusFilter === 'active') params.set('isActive', 'true')
      if (statusFilter === 'disabled') params.set('isActive', 'false')
      return params.toString()
    },
    [statusFilter],
  )

  const fetchUnits = useCallback(
    async (page = 1, limit = DEFAULT_LIMIT, searchValue = search) => {
      if (!accessToken) {
        setUnitMeta((prev) => ({
          ...prev,
          loading: false,
          error: 'Please log in first to load units.',
        }))
        return
      }

      setUnitMeta((prev) => ({ ...prev, loading: true, error: '' }))
      try {
        const data = await apiFetch<{
          items: UnitOfMeasureApi[]
          total: number
          page: number
          limit: number
          totalPages?: number
        }>(
          `/unit-of-measures?${buildParams(page, limit, searchValue)}`,
          undefined,
          accessToken,
        )
        const mapped = (data.items ?? []).map(mapUnit).filter((item) => item.id)
        setUnits(mapped)
        setUnitMeta({
          page: data.page ?? page,
          limit: data.limit ?? limit,
          total: data.total ?? 0,
          totalPages:
            data.totalPages ??
            Math.max(1, Math.ceil((data.total ?? 0) / limit)),
          loading: false,
          error: '',
        })
      } catch (error) {
        setUnitMeta((prev) => ({
          ...prev,
          loading: false,
          error:
            error instanceof Error ? error.message : 'Failed to load units.',
        }))
      }
    },
    [accessToken, buildParams, search],
  )

  const fetchConversions = useCallback(
    async (page = 1, limit = DEFAULT_LIMIT, searchValue = search) => {
      if (!accessToken) {
        setConversionMeta((prev) => ({
          ...prev,
          loading: false,
          error: 'Please log in first to load conversions.',
        }))
        return
      }

      setConversionMeta((prev) => ({ ...prev, loading: true, error: '' }))
      try {
        const data = await apiFetch<{
          items: UnitConversionApi[]
          total: number
          page: number
          limit: number
          totalPages?: number
        }>(
          `/unit-of-measures/conversions?${buildParams(
            page,
            limit,
            searchValue,
          )}`,
          undefined,
          accessToken,
        )
        const mapped = (data.items ?? [])
          .map(mapConversion)
          .filter((item) => item.id)
        setConversions(mapped)
        setConversionMeta({
          page: data.page ?? page,
          limit: data.limit ?? limit,
          total: data.total ?? 0,
          totalPages:
            data.totalPages ??
            Math.max(1, Math.ceil((data.total ?? 0) / limit)),
          loading: false,
          error: '',
        })
      } catch (error) {
        setConversionMeta((prev) => ({
          ...prev,
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : 'Failed to load conversions.',
        }))
      }
    },
    [accessToken, buildParams, search],
  )

  const fetchUnitOptions = useCallback(async () => {
    if (!accessToken) return
    try {
      const data = await apiFetch<{
        items: UnitOfMeasureApi[]
      }>(
        '/unit-of-measures?page=1&limit=100&isActive=true',
        undefined,
        accessToken,
      )
      setUnitOptions(
        (data.items ?? []).map(mapUnit).filter((item) => item.id),
      )
    } catch {
      setUnitOptions([])
    }
  }, [accessToken])

  useEffect(() => {
    fetchUnits(1, DEFAULT_LIMIT, search).catch(() => null)
    fetchConversions(1, DEFAULT_LIMIT, search).catch(() => null)
    fetchUnitOptions().catch(() => null)
  }, [fetchConversions, fetchUnitOptions, fetchUnits, search])

  const applySearch = () => {
    setSearch(searchInput.trim())
    setUnitMeta((prev) => ({ ...prev, page: 1 }))
    setConversionMeta((prev) => ({ ...prev, page: 1 }))
  }

  const resetForms = () => {
    setUnitForm(emptyUnitForm)
    setConversionForm(emptyConversionForm)
    setEditingUnitId(null)
    setEditingConversionId(null)
    setFormError('')
  }

  const saveUnit = async () => {
    if (!accessToken) return
    const code = unitForm.code.trim()
    const name = unitForm.name.trim()
    if (!code || !name) {
      setFormError('Unit code and name are required.')
      return
    }

    try {
      await apiFetch(
        editingUnitId
          ? `/unit-of-measures/${editingUnitId}`
          : '/unit-of-measures',
        {
          method: editingUnitId ? 'PATCH' : 'POST',
          body: JSON.stringify({
            code,
            name,
          }),
        },
        accessToken,
      )
      setMessage(editingUnitId ? 'Unit updated.' : 'Unit created.')
      resetForms()
      fetchUnits(editingUnitId ? unitMeta.page : 1, unitMeta.limit, search).catch(
        () => null,
      )
      fetchUnitOptions().catch(() => null)
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'Failed to save unit.',
      )
    }
  }

  const saveConversion = async () => {
    if (!accessToken) return
    const prodUomCode = conversionForm.prodUomCode.trim()
    const srUomCode = conversionForm.srUomCode.trim()
    const ext = Number(conversionForm.ext)
    const weight = Number(conversionForm.weight)
    const multiplier = Number(calculateMultiplier(conversionForm.ext, conversionForm.weight))

    if (
      !prodUomCode ||
      !srUomCode ||
      !ext ||
      !weight ||
      !multiplier
    ) {
      setFormError(
        'Complete conversion units, EXT, and weight first.',
      )
      return
    }
    if (prodUomCode === srUomCode) {
      setFormError('Conversion units must be different.')
      return
    }

    try {
      await apiFetch(
        editingConversionId
          ? `/unit-of-measures/conversions/${editingConversionId}`
          : '/unit-of-measures/conversions',
        {
          method: editingConversionId ? 'PATCH' : 'POST',
          body: JSON.stringify({
            prodUomCode,
            srUomCode,
            multiplier,
            ext,
            weight,
          }),
        },
        accessToken,
      )
      setMessage(
        editingConversionId ? 'Conversion updated.' : 'Conversion created.',
      )
      resetForms()
      fetchConversions(
        editingConversionId ? conversionMeta.page : 1,
        conversionMeta.limit,
        search,
      ).catch(() => null)
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'Failed to save conversion.',
      )
    }
  }

  const startEditUnit = (unit: UnitOfMeasure) => {
    setActiveTab('units')
    setEditingUnitId(unit.id)
    setEditingConversionId(null)
    setUnitForm({
      code: unit.code,
      name: unit.name,
    })
    setFormError('')
    setMessage('')
  }

  const startEditConversion = (conversion: UnitConversion) => {
    setActiveTab('conversions')
    setEditingConversionId(conversion.id)
    setEditingUnitId(null)
    setConversionForm({
      prodUomCode: conversion.prodUomCode,
      srUomCode: conversion.srUomCode,
      multiplier: String(conversion.multiplier),
      ext: String(conversion.ext),
      weight: String(conversion.weight),
    })
    setFormError('')
    setMessage('')
  }

  const deleteUnit = async (unit: UnitOfMeasure) => {
    if (!accessToken) return
    if (!window.confirm(`Delete unit ${unit.code}?`)) return

    try {
      await apiFetch(`/unit-of-measures/${unit.id}`, { method: 'DELETE' }, accessToken)
      setMessage('Unit deleted.')
      fetchUnits(unitMeta.page, unitMeta.limit, search).catch(() => null)
      fetchUnitOptions().catch(() => null)
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'Failed to delete unit.',
      )
    }
  }

  const deleteConversion = async (conversion: UnitConversion) => {
    if (!accessToken) return
    if (!window.confirm(`Delete conversion ${conversion.conversionId}?`)) return

    try {
      await apiFetch(
        `/unit-of-measures/conversions/${conversion.id}`,
        { method: 'DELETE' },
        accessToken,
      )
      setMessage('Conversion deleted.')
      fetchConversions(conversionMeta.page, conversionMeta.limit, search).catch(
        () => null,
      )
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : 'Failed to delete conversion.',
      )
    }
  }

  return (
    <div className="w-full py-2">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">UOM Management</h1>
          <p className="mt-1 text-sm text-muted">
            Manage unit master data and conversion IDs for recipe and raw
            material measurements.
          </p>
        </div>

        <section className="rounded-md border border-border bg-surface shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('units')
                  resetForms()
                }}
                className={`rounded-md px-4 py-2 text-xs font-semibold ${
                  activeTab === 'units'
                    ? 'bg-primary text-white'
                    : 'border border-border bg-background text-primary'
                }`}
              >
                Units
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('conversions')
                  resetForms()
                }}
                className={`rounded-md px-4 py-2 text-xs font-semibold ${
                  activeTab === 'conversions'
                    ? 'bg-primary text-white'
                    : 'border border-border bg-background text-primary'
                }`}
              >
                Conversions
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search UOM"
                className="min-w-52 rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
              />
              <select
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value as StatusFilter)
                  setUnitMeta((prev) => ({ ...prev, page: 1 }))
                  setConversionMeta((prev) => ({ ...prev, page: 1 }))
                }}
                className="rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
              >
                <option value="all">All status</option>
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>
              <button
                type="button"
                onClick={applySearch}
                className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white"
              >
                Search
              </button>
            </div>
          </div>

          <div className="grid gap-6 p-5 xl:grid-cols-[minmax(320px,380px)_1fr]">
            <div className="rounded-md border border-border bg-background p-4">
              <h2 className="text-sm font-semibold">
                {activeTab === 'units'
                  ? editingUnitId
                    ? 'Edit unit'
                    : 'Create unit'
                  : editingConversionId
                    ? 'Edit conversion'
                    : 'Create conversion'}
              </h2>

              {activeTab === 'units' ? (
                <div className="mt-4 space-y-4">
                  <div>
                    <label className="text-xs font-semibold text-muted">
                      Code
                    </label>
                    <input
                      type="text"
                      value={unitForm.code}
                      onChange={(event) =>
                        setUnitForm((prev) => ({
                          ...prev,
                          code: event.target.value,
                        }))
                      }
                      placeholder="e.g. GR"
                      className="mt-2 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted">
                      Name
                    </label>
                    <input
                      type="text"
                      value={unitForm.name}
                      onChange={(event) =>
                        setUnitForm((prev) => ({
                          ...prev,
                          name: event.target.value,
                        }))
                      }
                      placeholder="e.g. Gram"
                      className="mt-2 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                    />
                  </div>
                </div>
              ) : (
                <div className="mt-4 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-muted">
                        Prod UOM
                      </label>
                      <select
                        value={conversionForm.prodUomCode}
                        onChange={(event) =>
                          setConversionForm((prev) => ({
                            ...prev,
                            prodUomCode: event.target.value,
                          }))
                        }
                        className="mt-2 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                      >
                        <option value="">Select</option>
                        {activeUnitCodes.map((code) => (
                          <option key={code} value={code}>
                            {code}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-muted">
                        SR UOM
                      </label>
                      <select
                        value={conversionForm.srUomCode}
                        onChange={(event) =>
                          setConversionForm((prev) => ({
                            ...prev,
                            srUomCode: event.target.value,
                          }))
                        }
                        className="mt-2 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                      >
                        <option value="">Select</option>
                        {activeUnitCodes.map((code) => (
                          <option key={code} value={code}>
                            {code}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-muted">
                        EXT
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.000001"
                        value={conversionForm.ext}
                        onChange={(event) =>
                          setConversionForm((prev) => ({
                            ...prev,
                            ext: event.target.value,
                          }))
                        }
                        placeholder="1.5"
                        className="mt-2 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-muted">
                        Weight
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.000001"
                        value={conversionForm.weight}
                        onChange={(event) =>
                          setConversionForm((prev) => ({
                            ...prev,
                            weight: event.target.value,
                          }))
                        }
                        placeholder="1"
                        className="mt-2 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-muted">
                        Multiplier
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.000001"
                        value={calculateMultiplier(
                          conversionForm.ext,
                          conversionForm.weight,
                        )}
                        readOnly
                        placeholder="Auto"
                        className="mt-2 w-full rounded-md border border-border bg-slate-50 px-3 py-2 text-sm text-muted outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              {formError ? (
                <p className="mt-4 text-xs font-medium text-red-600">
                  {formError}
                </p>
              ) : null}
              {message ? (
                <p className="mt-4 text-xs font-medium text-green-700">
                  {message}
                </p>
              ) : null}

              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={activeTab === 'units' ? saveUnit : saveConversion}
                  className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white"
                >
                  {activeTab === 'units'
                    ? editingUnitId
                      ? 'Update unit'
                      : 'Create unit'
                    : editingConversionId
                      ? 'Update conversion'
                      : 'Create conversion'}
                </button>
                <button
                  type="button"
                  onClick={resetForms}
                  className="rounded-md border border-border bg-background px-4 py-2 text-xs font-semibold text-primary"
                >
                  Reset
                </button>
              </div>
            </div>

            <div className="min-w-0">
              {activeTab === 'units' ? (
                <>
                  <TablePagination
                    page={unitMeta.page}
                    totalPages={unitMeta.totalPages}
                    loading={unitMeta.loading}
                    summary={`Showing ${units.length} of ${unitMeta.total} units`}
                    onPageChange={(page) =>
                      fetchUnits(page, unitMeta.limit, search)
                    }
                    className="mb-3"
                  />
                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="min-w-full divide-y divide-border text-left text-sm">
                      <thead className="bg-background text-xs uppercase tracking-wide text-muted">
                        <tr>
                          <th className="px-4 py-3 font-semibold">Code</th>
                          <th className="px-4 py-3 font-semibold">Name</th>
                          <th className="px-4 py-3 font-semibold">Status</th>
                          <th className="px-4 py-3 font-semibold">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border bg-surface">
                        {unitMeta.loading ? (
                          <tr>
                            <td colSpan={4} className="px-4 py-6 text-center">
                              Loading units...
                            </td>
                          </tr>
                        ) : units.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-4 py-6 text-center">
                              {unitMeta.error || 'No units found.'}
                            </td>
                          </tr>
                        ) : (
                          units.map((unit) => (
                            <tr key={unit.id}>
                              <td className="px-4 py-3 font-semibold">
                                {unit.code}
                              </td>
                              <td className="px-4 py-3">
                                {unit.name}
                              </td>
                              <td className="px-4 py-3">
                                {unit.isActive ? 'Active' : 'Disabled'}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() => startEditUnit(unit)}
                                    className="rounded-md border border-primary/40 bg-primary-soft px-3 py-2 text-xs font-semibold text-primary"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => deleteUnit(unit)}
                                    className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <>
                  <TablePagination
                    page={conversionMeta.page}
                    totalPages={conversionMeta.totalPages}
                    loading={conversionMeta.loading}
                    summary={`Showing ${conversions.length} of ${conversionMeta.total} conversions`}
                    onPageChange={(page) =>
                      fetchConversions(page, conversionMeta.limit, search)
                    }
                    className="mb-3"
                  />
                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="min-w-full divide-y divide-border text-left text-sm">
                      <thead className="bg-background text-xs uppercase tracking-wide text-muted">
                        <tr>
                          <th className="px-4 py-3 font-semibold">
                            ID Conversion
                          </th>
                          <th className="px-4 py-3 font-semibold">Rule</th>
                          <th className="px-4 py-3 font-semibold">Status</th>
                          <th className="px-4 py-3 font-semibold">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border bg-surface">
                        {conversionMeta.loading ? (
                          <tr>
                            <td colSpan={4} className="px-4 py-6 text-center">
                              Loading conversions...
                            </td>
                          </tr>
                        ) : conversions.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-4 py-6 text-center">
                              {conversionMeta.error || 'No conversions found.'}
                            </td>
                          </tr>
                        ) : (
                          conversions.map((conversion) => (
                            <tr key={conversion.id}>
                              <td className="px-4 py-3 font-semibold">
                                {conversion.conversionId}
                              </td>
                              <td className="px-4 py-3">
                                (1 / {formatQuantity(conversion.ext)}) /{' '}
                                {formatQuantity(conversion.weight)} ={' '}
                                {formatQuantity(conversion.multiplier)}
                              </td>
                              <td className="px-4 py-3">
                                {conversion.isActive ? 'Active' : 'Disabled'}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      startEditConversion(conversion)
                                    }
                                    className="rounded-md border border-primary/40 bg-primary-soft px-3 py-2 text-xs font-semibold text-primary"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      deleteConversion(conversion)
                                    }
                                    className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

export default SuperadminUnitOfMeasuresPage
