import { useCallback, useEffect, useMemo, useState } from 'react'
import TablePagination from '../components/TablePagination'
import ActionButton from '../components/ActionButton'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'
import {
  formatRawMaterialConversion,
  formatUnitLabel,
} from '../lib/unit-of-measures'

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

type RawMaterialApi = {
  id?: string
  _id?: string
  productCode?: string
  name?: string
  unitOfMeasures?: string
  baseUnitOfMeasures?: string
  conversionFactor?: number
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

type RawMaterial = {
  id: string
  productCode: string
  name: string
  unitOfMeasures: string
  baseUnitOfMeasures?: string
  conversionFactor?: number
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

type SpecificConversionForm = {
  productCode: string
  name: string
  srUomCode: string
  baseUomCode: string
  conversionFactor: string
}

type BulkSpecificConversionForm = {
  srUomCode: string
  baseUomCode: string
  conversionFactor: string
}

type ActiveTab = 'units' | 'conversions' | 'specific-conversions'
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

const emptySpecificConversionForm: SpecificConversionForm = {
  productCode: '',
  name: '',
  srUomCode: '',
  baseUomCode: '',
  conversionFactor: '',
}

const emptyBulkSpecificConversionForm: BulkSpecificConversionForm = {
  srUomCode: '',
  baseUomCode: '',
  conversionFactor: '',
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

const mapRawMaterial = (item: RawMaterialApi): RawMaterial => ({
  id: item.id ?? item._id ?? '',
  productCode: item.productCode ?? '',
  name: item.name ?? '',
  unitOfMeasures: item.unitOfMeasures ?? '',
  baseUnitOfMeasures: item.baseUnitOfMeasures ?? undefined,
  conversionFactor: Number.isFinite(Number(item.conversionFactor))
    ? Number(item.conversionFactor)
    : undefined,
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
  const [rawMaterialUnitOptions, setRawMaterialUnitOptions] = useState<string[]>(
    [],
  )
  const [conversions, setConversions] = useState<UnitConversion[]>([])
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([])
  const [unitMeta, setUnitMeta] = useState<Meta>(emptyMeta)
  const [conversionMeta, setConversionMeta] = useState<Meta>(emptyMeta)
  const [rawMaterialMeta, setRawMaterialMeta] = useState<Meta>(emptyMeta)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [unitForm, setUnitForm] = useState<UnitForm>(emptyUnitForm)
  const [conversionForm, setConversionForm] =
    useState<ConversionForm>(emptyConversionForm)
  const [specificConversionForm, setSpecificConversionForm] =
    useState<SpecificConversionForm>(emptySpecificConversionForm)
  const [bulkSpecificConversionForm, setBulkSpecificConversionForm] =
    useState<BulkSpecificConversionForm>(emptyBulkSpecificConversionForm)
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null)
  const [editingConversionId, setEditingConversionId] = useState<string | null>(
    null,
  )
  const [editingSpecificRawMaterialId, setEditingSpecificRawMaterialId] =
    useState<string | null>(null)
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

  const fetchSpecificConversions = useCallback(
    async (page = 1, limit = DEFAULT_LIMIT, searchValue = search) => {
      if (!accessToken) {
        setRawMaterialMeta((prev) => ({
          ...prev,
          loading: false,
          error: 'Please log in first to load raw materials.',
        }))
        return
      }

      setRawMaterialMeta((prev) => ({ ...prev, loading: true, error: '' }))
      try {
        const params = new URLSearchParams()
        params.set('page', String(page))
        params.set('limit', String(limit))
        if (searchValue.trim()) params.set('search', searchValue.trim())

        const data = await apiFetch<{
          items: RawMaterialApi[]
          total: number
          page: number
          limit: number
          totalPages?: number
        }>(`/raw-materials?${params.toString()}`, undefined, accessToken)
        const mapped = (data.items ?? [])
          .map(mapRawMaterial)
          .filter((item) => item.id)
        setRawMaterials(mapped)
        setRawMaterialMeta({
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
        setRawMaterials([])
        setRawMaterialMeta((prev) => ({
          ...prev,
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : 'Failed to load raw materials.',
        }))
      }
    },
    [accessToken, search],
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

  const fetchRawMaterialUnitOptions = useCallback(async () => {
    if (!accessToken) return
    try {
      const data = await apiFetch<string[]>(
        '/raw-materials/unit-options',
        undefined,
        accessToken,
      )
      setRawMaterialUnitOptions((data ?? []).filter(Boolean))
    } catch {
      setRawMaterialUnitOptions([])
    }
  }, [accessToken])

  useEffect(() => {
    fetchUnits(1, DEFAULT_LIMIT, search).catch(() => null)
    fetchConversions(1, DEFAULT_LIMIT, search).catch(() => null)
    fetchSpecificConversions(1, DEFAULT_LIMIT, search).catch(() => null)
    fetchUnitOptions().catch(() => null)
    fetchRawMaterialUnitOptions().catch(() => null)
  }, [
    fetchConversions,
    fetchRawMaterialUnitOptions,
    fetchSpecificConversions,
    fetchUnitOptions,
    fetchUnits,
    search,
  ])

  const applySearch = () => {
    setSearch(searchInput.trim())
    setUnitMeta((prev) => ({ ...prev, page: 1 }))
    setConversionMeta((prev) => ({ ...prev, page: 1 }))
    setRawMaterialMeta((prev) => ({ ...prev, page: 1 }))
  }

  const resetForms = () => {
    setUnitForm(emptyUnitForm)
    setConversionForm(emptyConversionForm)
    setSpecificConversionForm(emptySpecificConversionForm)
    setBulkSpecificConversionForm(emptyBulkSpecificConversionForm)
    setEditingUnitId(null)
    setEditingConversionId(null)
    setEditingSpecificRawMaterialId(null)
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

  const saveSpecificConversion = async () => {
    if (!accessToken || !editingSpecificRawMaterialId) {
      setFormError('Select a raw material first.')
      return
    }

    const rawMaterial = rawMaterials.find(
      (item) => item.id === editingSpecificRawMaterialId,
    )
    if (!rawMaterial) {
      setFormError('Selected raw material was not found.')
      return
    }

    const baseUnitOfMeasures = specificConversionForm.baseUomCode.trim()
    const conversionFactor = Number(specificConversionForm.conversionFactor)
    if (
      !baseUnitOfMeasures ||
      !conversionFactor ||
      !Number.isFinite(conversionFactor) ||
      conversionFactor <= 0
    ) {
      setFormError('Complete base unit and conversion factor greater than 0.')
      return
    }
    if (baseUnitOfMeasures === rawMaterial.unitOfMeasures) {
      setFormError('Base unit must be different from SR unit.')
      return
    }

    try {
      await apiFetch(
        `/raw-materials/${editingSpecificRawMaterialId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            productCode: rawMaterial.productCode,
            name: rawMaterial.name,
            unitOfMeasures: rawMaterial.unitOfMeasures,
            baseUnitOfMeasures,
            conversionFactor,
          }),
        },
        accessToken,
      )
      setMessage('Specific conversion saved.')
      resetForms()
      fetchSpecificConversions(
        rawMaterialMeta.page,
        rawMaterialMeta.limit,
        search,
      ).catch(() => null)
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : 'Failed to save specific conversion.',
      )
    }
  }

  const saveBulkSpecificConversions = async () => {
    if (!accessToken) return

    const searchValue = search.trim()
    const srUomCode = bulkSpecificConversionForm.srUomCode.trim()
    const baseUnitOfMeasures = bulkSpecificConversionForm.baseUomCode.trim()
    const conversionFactor = Number(
      bulkSpecificConversionForm.conversionFactor,
    )

    if (!searchValue) {
      setFormError('Apply a raw material search before bulk updating.')
      return
    }
    if (!srUomCode) {
      setFormError('Select an SR unit before bulk updating.')
      return
    }
    if (
      !baseUnitOfMeasures ||
      !conversionFactor ||
      !Number.isFinite(conversionFactor) ||
      conversionFactor <= 0
    ) {
      setFormError('Complete base unit and conversion factor greater than 0.')
      return
    }
    if (srUomCode && srUomCode === baseUnitOfMeasures) {
      setFormError('Base unit must be different from SR unit.')
      return
    }

    const ok = window.confirm(
      `Apply this specific conversion to all raw materials matching "${searchValue}"${
        srUomCode ? ` with SR unit ${formatUnitLabel(srUomCode)}` : ''
      }?`,
    )
    if (!ok) return

    try {
      const result = await apiFetch<{
        matchedCount?: number
        modifiedCount?: number
      }>(
        '/raw-materials/specific-conversions/bulk',
        {
          method: 'PATCH',
          body: JSON.stringify({
            search: searchValue,
            unitOfMeasures: srUomCode,
            baseUnitOfMeasures,
            conversionFactor,
          }),
        },
        accessToken,
      )
      setMessage(
        `Bulk specific conversion updated ${result.modifiedCount ?? 0} of ${
          result.matchedCount ?? 0
        } matching raw materials.`,
      )
      setFormError('')
      setEditingSpecificRawMaterialId(null)
      setSpecificConversionForm(emptySpecificConversionForm)
      fetchSpecificConversions(
        rawMaterialMeta.page,
        rawMaterialMeta.limit,
        search,
      ).catch(() => null)
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : 'Failed to bulk update specific conversions.',
      )
    }
  }

  const startEditUnit = (unit: UnitOfMeasure) => {
    setActiveTab('units')
    setEditingUnitId(unit.id)
    setEditingConversionId(null)
    setEditingSpecificRawMaterialId(null)
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
    setEditingSpecificRawMaterialId(null)
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

  const startEditSpecificConversion = (rawMaterial: RawMaterial) => {
    setActiveTab('specific-conversions')
    setEditingSpecificRawMaterialId(rawMaterial.id)
    setEditingUnitId(null)
    setEditingConversionId(null)
    setSpecificConversionForm({
      productCode: rawMaterial.productCode,
      name: rawMaterial.name,
      srUomCode: rawMaterial.unitOfMeasures,
      baseUomCode: rawMaterial.baseUnitOfMeasures ?? '',
      conversionFactor:
        rawMaterial.conversionFactor !== undefined
          ? String(rawMaterial.conversionFactor)
          : '',
    })
    setFormError('')
    setMessage('')
  }

  const clearSpecificConversion = async (rawMaterial: RawMaterial) => {
    if (!accessToken) return
    if (!window.confirm(`Clear specific conversion for ${rawMaterial.name}?`)) {
      return
    }

    try {
      await apiFetch(
        `/raw-materials/${rawMaterial.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            productCode: rawMaterial.productCode,
            name: rawMaterial.name,
            unitOfMeasures: rawMaterial.unitOfMeasures,
            baseUnitOfMeasures: '',
            conversionFactor: 0,
          }),
        },
        accessToken,
      )
      setMessage('Specific conversion cleared.')
      resetForms()
      fetchSpecificConversions(
        rawMaterialMeta.page,
        rawMaterialMeta.limit,
        search,
      ).catch(() => null)
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : 'Failed to clear specific conversion.',
      )
    }
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
                Global Conversions
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('specific-conversions')
                  resetForms()
                }}
                className={`rounded-md px-4 py-2 text-xs font-semibold ${
                  activeTab === 'specific-conversions'
                    ? 'bg-primary text-white'
                    : 'border border-border bg-background text-primary'
                }`}
              >
                Specific Conversions
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder={
                  activeTab === 'specific-conversions'
                    ? 'Search raw material'
                    : 'Search UOM'
                }
                className="min-w-52 rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
              />
              {activeTab === 'specific-conversions' ? null : (
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
              )}
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
                  : activeTab === 'conversions'
                    ? editingConversionId
                      ? 'Edit global conversion'
                      : 'Create global conversion'
                    : editingSpecificRawMaterialId
                      ? 'Edit specific conversion'
                      : 'Select raw material'}
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
              ) : activeTab === 'conversions' ? (
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
                        {conversionForm.srUomCode &&
                        !rawMaterialUnitOptions.includes(
                          conversionForm.srUomCode,
                        ) ? (
                          <option value={conversionForm.srUomCode}>
                            {formatUnitLabel(conversionForm.srUomCode)}
                          </option>
                        ) : null}
                        {rawMaterialUnitOptions.map((code) => (
                          <option key={code} value={code}>
                            {formatUnitLabel(code)}
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
              ) : (
                <div className="mt-4 space-y-4">
                  {editingSpecificRawMaterialId ? (
                    <>
                      <div>
                        <label className="text-xs font-semibold text-muted">
                          Raw material
                        </label>
                        <input
                          type="text"
                          value={`${specificConversionForm.productCode} - ${specificConversionForm.name}`}
                          readOnly
                          className="mt-2 w-full rounded-md border border-border bg-slate-50 px-3 py-2 text-sm text-muted outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-muted">
                          SR / Purchase Unit
                        </label>
                        <input
                          type="text"
                          value={
                            specificConversionForm.srUomCode
                              ? formatUnitLabel(
                                  specificConversionForm.srUomCode,
                                )
                              : ''
                          }
                          readOnly
                          className="mt-2 w-full rounded-md border border-border bg-slate-50 px-3 py-2 text-sm text-muted outline-none"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-semibold text-muted">
                            Equals quantity
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.000001"
                            value={specificConversionForm.conversionFactor}
                            onChange={(event) =>
                              setSpecificConversionForm((prev) => ({
                                ...prev,
                                conversionFactor: event.target.value,
                              }))
                            }
                            placeholder="200"
                            className="mt-2 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-muted">
                            Base / Recipe Unit
                          </label>
                          <select
                            value={specificConversionForm.baseUomCode}
                            onChange={(event) =>
                              setSpecificConversionForm((prev) => ({
                                ...prev,
                                baseUomCode: event.target.value,
                              }))
                            }
                            className="mt-2 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                          >
                            <option value="">Select</option>
                            {specificConversionForm.baseUomCode &&
                            !activeUnitCodes.includes(
                              specificConversionForm.baseUomCode,
                            ) ? (
                              <option
                                value={specificConversionForm.baseUomCode}
                              >
                                {formatUnitLabel(
                                  specificConversionForm.baseUomCode,
                                )}
                              </option>
                            ) : null}
                            {activeUnitCodes.map((code) => (
                              <option key={code} value={code}>
                                {formatUnitLabel(code)}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <p className="text-xs font-medium text-muted">
                        Preview:{' '}
                        {formatRawMaterialConversion(
                          specificConversionForm.srUomCode,
                          specificConversionForm.baseUomCode,
                          specificConversionForm.conversionFactor.trim()
                            ? Number(
                                specificConversionForm.conversionFactor,
                              )
                            : undefined,
                        )}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-muted">
                      Select a raw material from the table to set its specific
                      conversion.
                    </p>
                  )}

                  <div className="border-t border-border pt-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                      Bulk set matching search
                    </h3>
                    <p className="mt-2 text-xs text-muted">
                      Current search:{' '}
                      <span className="font-semibold text-foreground">
                        {search || 'None'}
                      </span>
                    </p>
                    <div className="mt-3 space-y-3">
                      <div>
                        <label className="text-xs font-semibold text-muted">
                          SR / Purchase Unit
                        </label>
                        <select
                          value={bulkSpecificConversionForm.srUomCode}
                          onChange={(event) =>
                            setBulkSpecificConversionForm((prev) => ({
                              ...prev,
                              srUomCode: event.target.value,
                            }))
                          }
                          className="mt-2 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                        >
                          <option value="">Select SR unit</option>
                          {rawMaterialUnitOptions.map((code) => (
                            <option key={code} value={code}>
                              {formatUnitLabel(code)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-semibold text-muted">
                            Equals quantity
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.000001"
                            value={bulkSpecificConversionForm.conversionFactor}
                            onChange={(event) =>
                              setBulkSpecificConversionForm((prev) => ({
                                ...prev,
                                conversionFactor: event.target.value,
                              }))
                            }
                            placeholder="200"
                            className="mt-2 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-muted">
                            Base / Recipe Unit
                          </label>
                          <select
                            value={bulkSpecificConversionForm.baseUomCode}
                            onChange={(event) =>
                              setBulkSpecificConversionForm((prev) => ({
                                ...prev,
                                baseUomCode: event.target.value,
                              }))
                            }
                            className="mt-2 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                          >
                            <option value="">Select</option>
                            {activeUnitCodes.map((code) => (
                              <option key={code} value={code}>
                                {formatUnitLabel(code)}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <p className="text-xs font-medium text-muted">
                        Preview:{' '}
                        {formatRawMaterialConversion(
                          bulkSpecificConversionForm.srUomCode || 'SR UOM',
                          bulkSpecificConversionForm.baseUomCode,
                          bulkSpecificConversionForm.conversionFactor.trim()
                            ? Number(
                                bulkSpecificConversionForm.conversionFactor,
                              )
                            : undefined,
                        )}
                      </p>
                      <button
                        type="button"
                        onClick={saveBulkSpecificConversions}
                        className="w-full rounded-md border border-primary bg-primary-soft px-4 py-2 text-xs font-semibold text-primary"
                      >
                        Apply to matching raw materials
                      </button>
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
                {activeTab === 'units' ? (
                  editingUnitId ? (
                    <ActionButton action="update" onClick={saveUnit} size="sm" />
                  ) : (
                    <button
                      type="button"
                      onClick={saveUnit}
                      className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white"
                    >
                      Create unit
                    </button>
                  )
                ) : activeTab === 'conversions' ? (
                  editingConversionId ? (
                    <ActionButton
                      action="update"
                      onClick={saveConversion}
                      size="sm"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={saveConversion}
                      className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white"
                    >
                      Create conversion
                    </button>
                  )
                ) : (
                  <ActionButton
                    action="save"
                    onClick={saveSpecificConversion}
                    size="sm"
                  />
                )}
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
              ) : activeTab === 'conversions' ? (
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
              ) : (
                <>
                  <TablePagination
                    page={rawMaterialMeta.page}
                    totalPages={rawMaterialMeta.totalPages}
                    loading={rawMaterialMeta.loading}
                    summary={`Showing ${rawMaterials.length} of ${rawMaterialMeta.total} raw materials`}
                    onPageChange={(page) =>
                      fetchSpecificConversions(
                        page,
                        rawMaterialMeta.limit,
                        search,
                      )
                    }
                    className="mb-3"
                  />
                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="min-w-full divide-y divide-border text-left text-sm">
                      <thead className="bg-background text-xs uppercase tracking-wide text-muted">
                        <tr>
                          <th className="px-4 py-3 font-semibold">
                            Product Code
                          </th>
                          <th className="px-4 py-3 font-semibold">Name</th>
                          <th className="px-4 py-3 font-semibold">SR Unit</th>
                          <th className="px-4 py-3 font-semibold">
                            Specific Conversion
                          </th>
                          <th className="px-4 py-3 font-semibold">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border bg-surface">
                        {rawMaterialMeta.loading ? (
                          <tr>
                            <td colSpan={5} className="px-4 py-6 text-center">
                              Loading raw materials...
                            </td>
                          </tr>
                        ) : rawMaterials.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-4 py-6 text-center">
                              {rawMaterialMeta.error ||
                                'No raw materials found.'}
                            </td>
                          </tr>
                        ) : (
                          rawMaterials.map((rawMaterial) => {
                            const hasSpecificConversion = Boolean(
                              rawMaterial.baseUnitOfMeasures &&
                                rawMaterial.conversionFactor,
                            )

                            return (
                              <tr key={rawMaterial.id}>
                                <td className="px-4 py-3 font-semibold">
                                  {rawMaterial.productCode}
                                </td>
                                <td className="px-4 py-3">
                                  {rawMaterial.name}
                                </td>
                                <td className="px-4 py-3">
                                  {formatUnitLabel(
                                    rawMaterial.unitOfMeasures,
                                  )}
                                </td>
                                <td className="px-4 py-3">
                                  {formatRawMaterialConversion(
                                    rawMaterial.unitOfMeasures,
                                    rawMaterial.baseUnitOfMeasures,
                                    rawMaterial.conversionFactor,
                                  )}
                                </td>
                                <td className="px-4 py-3">
                                  <div className="flex flex-wrap gap-2">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        startEditSpecificConversion(
                                          rawMaterial,
                                        )
                                      }
                                      className="rounded-md border border-primary/40 bg-primary-soft px-3 py-2 text-xs font-semibold text-primary"
                                    >
                                      Edit
                                    </button>
                                    {hasSpecificConversion ? (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          clearSpecificConversion(rawMaterial)
                                        }
                                        className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700"
                                      >
                                        Clear
                                      </button>
                                    ) : null}
                                  </div>
                                </td>
                              </tr>
                            )
                          })
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
