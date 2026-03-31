import { useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'
import {
  getApprovalStatusLabel,
  getStoreRequestStatusLabel,
} from '../lib/status-labels'
import { formatUnitLabel } from '../lib/unit-of-measures'

type StoreRequestIngredient = {
  productCode: string
  name: string
  unitOfMeasures: string
  qty: number
}

type StoreFulfillmentIngredient = {
  productCode: string
  name: string
  unitOfMeasures: string
  plannedQty: number
  actualQty: number
  varianceQty: number
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
  menuName: string
  category: string
  portion: number
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

const toInputDate = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const xmlEscape = (value: unknown) => {
  const text = value === null || value === undefined ? '' : String(value)
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

const sanitizeWorksheetName = (value: string) => {
  const cleaned = value.replace(/[\\/:*?[\]]/g, '-')
  return cleaned.length > 31 ? cleaned.slice(0, 31) : cleaned
}

const buildWorksheetXml = (sheetName: string, rows: Array<Array<unknown>>) => {
  const safeName = sanitizeWorksheetName(sheetName)
  const rowXml = rows
    .map((row, index) => {
      const rowStyle = index === 0 ? ' ss:StyleID="Header"' : ''
      const cells = row
        .map((cell) => {
          const isNumber = typeof cell === 'number' && Number.isFinite(cell)
          const type = isNumber ? 'Number' : 'String'
          const value = isNumber ? String(cell) : xmlEscape(cell)
          return `<Cell><Data ss:Type="${type}">${value}</Data></Cell>`
        })
        .join('')
      return `<Row${rowStyle}>${cells}</Row>`
    })
    .join('')

  return `<Worksheet ss:Name="${xmlEscape(safeName)}">
  <Table>${rowXml}</Table>
 </Worksheet>`
}

const buildWorkbookXml = (
  sheets: Array<{ name: string; rows: Array<Array<unknown>> }>,
) => {
  const worksheetsXml = sheets
    .map((sheet) => buildWorksheetXml(sheet.name, sheet.rows))
    .join('')

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Header">
   <Font ss:Bold="1"/>
   <Interior ss:Color="#D9E1F2" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
  </Style>
 </Styles>
 ${worksheetsXml}
</Workbook>`
}

const downloadExcel = (
  filename: string,
  sheets: Array<{ name: string; rows: Array<Array<unknown>> }>,
) => {
  const xml = buildWorkbookXml(sheets)
  const blob = new Blob([xml], {
    type: 'application/vnd.ms-excel;charset=utf-8;',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

const buildIngredientKey = (
  productCode: string,
  name: string,
  unitOfMeasures: string,
) =>
  `${(productCode || name).trim().toLowerCase()}__${unitOfMeasures.trim().toLowerCase()}`

const formatQuantity = (value: number) => {
  if (!Number.isFinite(value)) return ''
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(3).replace(/\.?0+$/, '')
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

      const rows: Array<Array<unknown>> = [
        [
          'No',
          'Production Date',
          'Production Code',
          'Menu Name',
          'Category',
          'Recipe Code',
          'Portion',
          'IT Code',
          'Ingredient Name',
          'QTY Planned',
          'QTY Actual',
          'Unit Of Measures',
          'Approved By',
          'Approval Status',
          'Completed By',
          'Store Request Status',
          'Completed At',
        ],
      ]

      let rowNumber = 1
      groups.forEach((group) => {
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

        const completedAt = group.fulfillment?.completedAt
          ? new Date(group.fulfillment.completedAt).toLocaleString()
          : ''
        const completedBy = group.fulfillment?.completedBy ?? ''

        group.items.forEach((menu) => {
          const ingredients = menu.ingredients ?? []
          const approvedBy = menu.reviewedBy ?? ''
          const approvalStatus = getApprovalStatusLabel(menu.approvalStatus)
          const storeRequestStatus = getStoreRequestStatusLabel(
            menu.storeRequestStatus,
          )

          if (ingredients.length === 0) {
            rows.push([
              rowNumber,
              group.date,
              group.productionCode ?? '',
              menu.menuName,
              menu.category,
              menu.recipeCode ?? '',
              menu.portion,
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
            const fulfillmentItem = fulfillmentByKey.get(
              buildIngredientKey(
                ingredient.productCode,
                ingredient.name,
                ingredient.unitOfMeasures,
              ),
            )

            rows.push([
              rowNumber,
              group.date,
              group.productionCode ?? '',
              menu.menuName,
              menu.category,
              menu.recipeCode ?? '',
              menu.portion,
              ingredient.productCode,
              ingredient.name,
              formatQuantity(ingredient.qty),
              fulfillmentItem ? formatQuantity(fulfillmentItem.actualQty) : '',
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
      })

      const filename =
        exportMode === 'range'
          ? `store-request-all-sites-${startDate}_to_${endDate}.xls`
          : 'store-request-all-sites-all-dates.xls'

      downloadExcel(filename, [{ name: 'Store Requests', rows }])

      setInfoMessage(
        `Export complete for all sites. ${groups.length} production batches exported.`,
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
    <div className="space-y-6">
      <div className="rounded-md border border-border bg-surface p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-muted">
              Superadmin export
            </h3>
            <p className="mt-2 text-2xl font-semibold">
              Store Request Export
            </p>
            <p className="mt-2 text-sm text-muted">
              Export store request data for all sites for all dates or by date
              range.
            </p>
            <p className="mt-2 text-xs text-muted">
              Site selection is hidden for now. Export will include all sites
              automatically.
            </p>
          </div>
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
              <span>Date range</span>
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
            Date range is ignored in all-dates mode.
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
            Output format: `.xls` with a single sheet matching the requested
            export layout.
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
  )
}

export default SuperadminStoreRequestExportPage
