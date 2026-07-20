import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'
import { formatQuantity as formatRawQuantity } from '../lib/quantity'
import { formatRecipeVersion } from '../lib/recipe-version'
import {
  getApprovalStatusLabel,
  getStoreRequestStatusLabel,
} from '../lib/status-labels'
import { formatUnitLabel } from '../lib/unit-of-measures'
import {
  downloadSpreadsheet,
  toSpreadsheetDate,
  toSpreadsheetNumber,
  type SpreadsheetCell,
} from '../lib/spreadsheet-export'

type StoreRequestIngredient = {
  productCode: string
  name: string
  unitOfMeasures: string
  qty: number
  vendor?: string
  vendorSite?: string
  price?: number
  ingredientCost?: number
}

type StoreFulfillmentIngredient = {
  productCode: string
  name: string
  unitOfMeasures: string
  plannedQty: number
  actualQty: number
  varianceQty: number
  vendor?: string
  vendorSite?: string
  price?: number
  ingredientCost?: number
  plannedIngredientCost?: number
  actualIngredientCost?: number
  plannedPrice?: number
  actualPrice?: number
  variancePrice?: number
  reason?: string
}

type StoreRequestFulfillment = {
  status?: 'fulfilled' | 'cancelled'
  completedBy?: string
  completedAt?: string
  note?: string
  items: StoreFulfillmentIngredient[]
}

type StoreRequestMenu = {
  id: string
  submittedByName?: string
  reviewedBy?: string
  recipeCode?: string
  recipeVersion?: number
  menuName: string
  category: string
  portion: number
  estimatedCost?: number
  estimatedCostPerPax?: number
  approvalStatus: 'pending' | 'approved' | 'rejected'
  storeRequestStatus: 'not-requested' | 'requested' | 'fulfilled' | 'cancelled'
  missingRecipe: boolean
  ingredients: StoreRequestIngredient[]
}

type StoreRequestGroup = {
  site: string
  date: string
  productionCode?: string
  items: StoreRequestMenu[]
  summary: StoreRequestIngredient[]
  fulfillment?: StoreRequestFulfillment
}

type ExportMode = 'all' | 'range'

type SiteApi = {
  id?: string
  _id?: string
  name?: string
  code?: string
}

const toInputDate = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const sanitizeFilenameSegment = (value: string) =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()

const formatSelectedSitesLabel = (sites: string[]) => {
  if (sites.length === 0) return 'all sites'
  if (sites.length === 1) return sites[0]
  if (sites.length <= 3) return sites.join(', ')
  return `${sites.length} selected sites`
}

const buildSiteFilenameSegment = (sites: string[]) => {
  if (sites.length === 0) return 'all-sites'
  if (sites.length === 1) {
    return sanitizeFilenameSegment(sites[0]) || 'selected-site'
  }
  return `${sites.length}-sites`
}

const getSequentialSiteCodeNumber = (code: string) => {
  const match = /^S(\d+)$/i.exec(code.trim())
  return match ? Number(match[1]) : undefined
}

const compareSiteCodes = (a: string, b: string) => {
  const aNumber = getSequentialSiteCodeNumber(a)
  const bNumber = getSequentialSiteCodeNumber(b)

  if (aNumber !== undefined && bNumber !== undefined) {
    return aNumber - bNumber
  }

  return a.localeCompare(b, undefined, {
    numeric: true,
    sensitivity: 'base',
  })
}

const buildIngredientKey = (
  productCode: string,
  name: string,
  unitOfMeasures: string,
) =>
  `${(productCode || name).trim().toLowerCase()}__${unitOfMeasures.trim().toLowerCase()}`

const formatQuantity = (value: number) => {
  return formatRawQuantity(value, '')
}

const formatPrice = (value?: number) => {
  return value === undefined || value === null || !Number.isFinite(value)
    ? ''
    : formatRawQuantity(value, '')
}

const getActualIngredientCost = (item?: StoreFulfillmentIngredient) => {
  if (Number.isFinite(Number(item?.actualIngredientCost))) {
    return Number(item?.actualIngredientCost)
  }
  const actualPrice = item?.actualPrice
  const actualQty = item?.actualQty
  if (
    actualPrice === undefined ||
    actualQty === undefined ||
    !Number.isFinite(actualPrice) ||
    !Number.isFinite(actualQty)
  ) {
    return undefined
  }
  return actualPrice * actualQty
}

const SuperadminStoreRequestExportPage = () => {
  const { accessToken } = useAuth()
  const [exportMode, setExportMode] = useState<ExportMode>('all')
  const [exporting, setExporting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [infoMessage, setInfoMessage] = useState('')
  const [startDate, setStartDate] = useState(() => {
    const today = new Date()
    return toInputDate(new Date(today.getFullYear(), today.getMonth(), 1))
  })
  const [endDate, setEndDate] = useState(() => toInputDate(new Date()))
  const [siteOptions, setSiteOptions] = useState<string[]>([])
  const [siteNameByCode, setSiteNameByCode] = useState<Record<string, string>>({})
  const [selectedSites, setSelectedSites] = useState<string[]>([])
  const [siteError, setSiteError] = useState('')
  const [sitesLoading, setSitesLoading] = useState(false)
  const [siteFilterOpen, setSiteFilterOpen] = useState(false)
  const siteFilterRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false

    const loadSiteOptions = async () => {
      if (!accessToken) {
        setSiteOptions([])
        setSiteNameByCode({})
        setSelectedSites([])
        setSiteError('')
        setSitesLoading(false)
        return
      }

      setSitesLoading(true)
      setSiteError('')
      try {
        const [storeRequestSitesData, sitesData] = await Promise.all([
          apiFetch<{ items?: string[] }>(
            '/superadmin/store-requests/sites',
            undefined,
            accessToken,
          ),
          apiFetch<{ items?: SiteApi[] }>(
            '/superadmin/sites?limit=200',
            undefined,
            accessToken,
          ),
        ])
        if (cancelled) return

        const normalized = (storeRequestSitesData.items ?? [])
          .map((site) => site.trim())
          .filter(Boolean)
          .sort(compareSiteCodes)
        const nameByCode = (sitesData.items ?? []).reduce<Record<string, string>>(
          (acc, site) => {
            const code = site.code?.trim()
            const name = site.name?.trim()
            if (code && name) acc[code] = name
            return acc
          },
          {},
        )

        setSiteOptions(normalized)
        setSiteNameByCode(nameByCode)
        setSelectedSites((current) =>
          current.filter((site) => normalized.includes(site)),
        )
      } catch (error) {
        if (cancelled) return
        setSiteOptions([])
        setSiteNameByCode({})
        setSelectedSites([])
        setSiteError(
          error instanceof Error ? error.message : 'Failed to load sites.',
        )
      } finally {
        if (!cancelled) {
          setSitesLoading(false)
        }
      }
    }

    loadSiteOptions().catch(() => null)

    return () => {
      cancelled = true
    }
  }, [accessToken])

  useEffect(() => {
    if (!siteFilterOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (siteFilterRef.current && !siteFilterRef.current.contains(target)) {
        setSiteFilterOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [siteFilterOpen])

  const toggleSiteSelection = (site: string) => {
    setSelectedSites((current) =>
      current.includes(site)
        ? current.filter((item) => item !== site)
        : [...current, site],
    )
  }

  const clearSiteSelection = () => {
    setSelectedSites([])
  }

  const allSitesSelected = selectedSites.length === 0

  const getSiteDisplayName = (siteCode: string) =>
    siteNameByCode[siteCode] ?? siteCode

  const handleExport = async () => {
    if (!accessToken) {
      setErrorMessage('Please log in first to export data.')
      return
    }
    if (exportMode === 'range') {
      if (!startDate || !endDate) {
        setErrorMessage('Please complete start and end date.')
        return
      }
      if (startDate > endDate) {
        setErrorMessage('Start date cannot be later than end date.')
        return
      }
    }

    setExporting(true)
    setErrorMessage('')
    setInfoMessage('')
    try {
      const params = new URLSearchParams()
      if (selectedSites.length) {
        params.set('sites', selectedSites.join(','))
      }
      if (exportMode === 'range') {
        params.set('startDate', startDate)
        params.set('endDate', endDate)
      }

      const data = await apiFetch<{ items: StoreRequestGroup[] }>(
        `/superadmin/store-requests/export${
          params.toString() ? `?${params.toString()}` : ''
        }`,
        undefined,
        accessToken,
      )

      const groups = data.items ?? []
      if (groups.length === 0) {
        setInfoMessage('No store request data found for selected filters.')
        return
      }

      const rows: SpreadsheetCell[][] = [
        [
          'No',
          'Production Date',
          'Site',
          'Production Code',
          'Menu Name',
          'Version',
          'Category',
          'Recipe Code',
          'Portion',
          'IT Code',
          'Ingredient Name',
          'Vendor',
          'QTY Planned',
          'QTY Actual',
          'Variance',
          'Planned Price/Unit',
          'Actual Price/Unit',
          'Price Variance',
          'Ingredient Cost',
          'Unit Of Measures',
          'Approved By',
          'Approval Status',
          'Completed By',
          'Store Request Status',
          'Completed At',
        ],
      ]
      const estimatedCostRows: SpreadsheetCell[][] = [
        [
          'Production Date',
          'Site',
          'Menu Name',
          'Version',
          'Portion',
          'Estimated Total Cost',
          'Cost Per Pax',
        ],
      ]

      let rowNumber = 1
      groups.forEach((group) => {
        const siteName = getSiteDisplayName(group.site)
        const fulfillmentByKey = new Map(
          (group.fulfillment?.items ?? []).map((item) => [
            buildIngredientKey(
              item.productCode,
              item.name,
              item.unitOfMeasures,
            ),
            item,
          ]),
        )

        const completedAt = toSpreadsheetDate(group.fulfillment?.completedAt)
        const completedBy = group.fulfillment?.completedBy ?? ''
        const consumedFulfillmentKeys = new Set<string>()

        group.items.forEach((menu) => {
          const estimatedTotalCost = Number.isFinite(menu.estimatedCost)
            ? menu.estimatedCost
            : undefined
          const estimatedCostPerPax = Number.isFinite(
            menu.estimatedCostPerPax,
          )
            ? menu.estimatedCostPerPax
            : estimatedTotalCost !== undefined && menu.portion > 0
              ? estimatedTotalCost / menu.portion
              : undefined

          estimatedCostRows.push([
            toSpreadsheetDate(group.date),
            siteName,
            menu.menuName,
            formatRecipeVersion(menu.recipeVersion),
            menu.portion,
            toSpreadsheetNumber(estimatedTotalCost),
            toSpreadsheetNumber(estimatedCostPerPax),
          ])

          const ingredients = menu.ingredients ?? []
          const approvedBy = menu.reviewedBy ?? ''
          const approvalStatus = getApprovalStatusLabel(menu.approvalStatus)
          const storeRequestStatus = getStoreRequestStatusLabel(
            menu.storeRequestStatus,
          )

          if (ingredients.length === 0) {
            rows.push([
              rowNumber,
              toSpreadsheetDate(group.date),
              siteName,
              group.productionCode ?? '',
              menu.menuName,
              formatRecipeVersion(menu.recipeVersion),
              menu.category,
              menu.recipeCode ?? '',
              menu.portion,
              '',
              '',
              '',
              '',
              '',
              '',
              '',
              '',
              '',
              '',
              '',
              approvedBy,
              approvalStatus,
              completedBy,
              storeRequestStatus,
              completedAt,
            ])
            rowNumber += 1
            return
          }

          ingredients.forEach((ingredient) => {
            const ingredientKey = buildIngredientKey(
              ingredient.productCode,
              ingredient.name,
              ingredient.unitOfMeasures,
            )
            consumedFulfillmentKeys.add(ingredientKey)
            const fulfillmentItem = fulfillmentByKey.get(ingredientKey)
            const plannedQty = fulfillmentItem?.plannedQty ?? ingredient.qty

            rows.push([
              rowNumber,
              toSpreadsheetDate(group.date),
              siteName,
              group.productionCode ?? '',
              menu.menuName,
              formatRecipeVersion(menu.recipeVersion),
              menu.category,
              menu.recipeCode ?? '',
              menu.portion,
              ingredient.productCode,
              ingredient.name,
              ingredient.vendor ?? fulfillmentItem?.vendor ?? '',
              toSpreadsheetNumber(formatQuantity(plannedQty)),
              fulfillmentItem
                ? toSpreadsheetNumber(formatQuantity(fulfillmentItem.actualQty))
                : '',
              fulfillmentItem
                ? toSpreadsheetNumber(
                    formatQuantity(fulfillmentItem.varianceQty),
                  )
                : '',
              toSpreadsheetNumber(
                formatPrice(fulfillmentItem?.plannedPrice ?? ingredient.price),
              ),
              toSpreadsheetNumber(formatPrice(fulfillmentItem?.actualPrice)),
              toSpreadsheetNumber(formatPrice(fulfillmentItem?.variancePrice)),
              toSpreadsheetNumber(
                formatPrice(getActualIngredientCost(fulfillmentItem)),
              ),
              formatUnitLabel(ingredient.unitOfMeasures),
              approvedBy,
              approvalStatus,
              completedBy,
              storeRequestStatus,
              completedAt,
            ])
            rowNumber += 1
          })
        })

        fulfillmentByKey.forEach((item, key) => {
          if (consumedFulfillmentKeys.has(key)) return

          rows.push([
            rowNumber,
            toSpreadsheetDate(group.date),
            siteName,
            group.productionCode ?? '',
            '',
            '',
            '',
            '',
            '',
            item.productCode,
            item.name,
            item.vendor ?? '',
            toSpreadsheetNumber(formatQuantity(item.plannedQty)),
            toSpreadsheetNumber(formatQuantity(item.actualQty)),
            toSpreadsheetNumber(formatQuantity(item.varianceQty)),
            toSpreadsheetNumber(formatPrice(item.plannedPrice)),
            toSpreadsheetNumber(formatPrice(item.actualPrice)),
            toSpreadsheetNumber(formatPrice(item.variancePrice)),
            toSpreadsheetNumber(formatPrice(getActualIngredientCost(item))),
            formatUnitLabel(item.unitOfMeasures),
            '',
            '',
            completedBy,
            getStoreRequestStatusLabel(
              group.fulfillment?.status ?? 'fulfilled',
            ),
            completedAt,
          ])
          rowNumber += 1
        })
      })

      const selectedSitesLabel = formatSelectedSitesLabel(selectedSites)
      const siteFilenameSegment = buildSiteFilenameSegment(selectedSites)
      const filename =
        exportMode === 'range'
          ? `store-request-${siteFilenameSegment}-${startDate}_to_${endDate}.xlsx`
          : `store-request-${siteFilenameSegment}-all-dates.xlsx`

      await downloadSpreadsheet(filename, [
        { name: 'Store Requests', rows },
        { name: 'Estimated Costs', rows: estimatedCostRows },
      ])

      setInfoMessage(
        `Export complete for ${selectedSitesLabel}. ${groups.length} production batches exported.`,
      )
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to export data.'
      setErrorMessage(message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="w-full py-2">
      <div className="space-y-6">
        <div className="space-y-2">
          <div>
            <h1 className="text-2xl font-semibold">Store Request Export</h1>
          </div>
        </div>

        <div className="rounded-md border border-border bg-surface p-6 shadow-sm">
          <div className="mt-5">
            <p className="text-sm font-medium text-foreground">Sites</p>
            <div className="mt-2 relative" ref={siteFilterRef}>
            <button
              type="button"
              onClick={() => setSiteFilterOpen((current) => !current)}
              disabled={sitesLoading}
              className="flex w-full items-center justify-between rounded-md border border-border bg-white px-4 py-2 text-sm text-foreground shadow-sm outline-none transition hover:border-accent-blue disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span>
                {selectedSites.length
                  ? `Sites (${selectedSites.length})`
                  : 'Select sites'}
              </span>
              <i
                className={`bi bi-chevron-down text-[10px] transition-transform ${siteFilterOpen ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>
              {siteFilterOpen ? (
                <>
                  <button
                    type="button"
                    aria-label="Close site selector"
                    className="fixed inset-0 z-30 cursor-default bg-transparent md:hidden"
                    onClick={() => setSiteFilterOpen(false)}
                  />
                  <div className="fixed left-3 right-3 top-56 z-40 mt-0 max-h-[calc(100vh-15rem)] overflow-y-auto rounded-md border border-border bg-white p-3 shadow-lg md:absolute md:left-0 md:right-auto md:top-full md:mt-2 md:w-full md:max-h-none md:overflow-visible">
                    <div className="mb-3 flex items-center justify-between border-b border-border pb-2 md:hidden">
                      <p className="text-xs font-semibold text-primary">Sites</p>
                      <button
                        type="button"
                        onClick={() => setSiteFilterOpen(false)}
                        className="flex h-7 w-7 items-center justify-center rounded-md bg-primary-soft text-primary transition hover:bg-primary hover:text-white"
                        aria-label="Close site selector"
                      >
                        <i className="bi bi-x-lg text-[10px]" aria-hidden="true" />
                      </button>
                    </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-muted">Sites</p>
                    <button
                      type="button"
                      onClick={clearSiteSelection}
                      disabled={selectedSites.length === 0}
                      className="text-[11px] font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Clear
                    </button>
                  </div>
                  {sitesLoading ? (
                    <p className="mt-2 text-xs text-muted">Loading site options...</p>
                  ) : (
                    <div className="mt-2 max-h-56 space-y-1 overflow-y-auto pr-1">
                      <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-background">
                        <input
                          type="checkbox"
                          checked={allSitesSelected}
                          onChange={clearSiteSelection}
                          className="h-4 w-4 rounded border-border text-primary focus:ring-accent-blue"
                        />
                        <span>All sites</span>
                      </label>
                      {siteOptions.length === 0 ? (
                        <p className="px-2 py-1 text-xs text-muted">No site data yet.</p>
                      ) : (
                        siteOptions.map((site) => (
                          <label
                            key={site}
                            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-background"
                          >
                            <input
                              type="checkbox"
                              checked={selectedSites.includes(site)}
                              onChange={() => toggleSiteSelection(site)}
                              className="h-4 w-4 rounded border-border text-primary focus:ring-accent-blue"
                            />
                            <span>{site}</span>
                          </label>
                        ))
                      )}
                    </div>
                  )}
                </div>
                </>
              ) : null}
            </div>
            <p className="mt-2 text-xs text-muted">
              {sitesLoading
                ? 'Loading site options...'
                : selectedSites.length
                  ? `Export will include ${formatSelectedSitesLabel(selectedSites)}.`
                  : 'All sites will be included in the export.'}
            </p>
            {siteError ? (
              <p className="mt-2 text-xs font-medium text-red-600">{siteError}</p>
            ) : null}
          </div>

        <div className="mt-5">
          <p className="text-sm font-medium text-foreground">Export mode</p>
          <div className="mt-2 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-white p-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
              <input
                type="radio"
                name="export-mode"
                value="all"
                checked={exportMode === 'all'}
                onChange={() => setExportMode('all')}
                className="h-4 w-4 border-border text-primary focus:ring-accent-blue"
              />
              <span>All dates</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
              <input
                type="radio"
                name="export-mode"
                value="range"
                checked={exportMode === 'range'}
                onChange={() => setExportMode('range')}
                className="h-4 w-4 border-border text-primary focus:ring-accent-blue"
              />
              <span>Custom date</span>
            </label>
          </div>
        </div>

        {exportMode === 'range' ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="export-start-date" className="text-sm font-medium text-foreground">
                Start date
              </label>
              <input
                id="export-start-date"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
              />
            </div>
            <div>
              <label htmlFor="export-end-date" className="text-sm font-medium text-foreground">
                End date
              </label>
              <input
                id="export-end-date"
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
              />
            </div>
          </div>
        ) : (
          <p className="mt-4 text-xs text-muted">
            Custom date is ignored in all-dates mode.
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className="rounded-md border border-success bg-white px-4 py-2 text-xs font-semibold text-success shadow-sm hover:bg-success/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="flex items-center gap-2">
              <i className="bi bi-download text-sm" aria-hidden="true" />
              <span>{exporting ? 'Exporting...' : 'Export'}</span>
            </span>
          </button>
          <span className="text-xs text-muted">
            Output format: `.xlsx` workbook with Store Requests and Estimated
            Costs sheets.
          </span>
        </div>

        {errorMessage ? (
          <p className="mt-3 text-xs font-medium text-red-600">{errorMessage}</p>
        ) : null}
        {infoMessage ? (
          <p className="mt-3 text-xs font-medium text-primary">{infoMessage}</p>
        ) : null}
        </div>
      </div>
    </div>
  )
}

export default SuperadminStoreRequestExportPage
