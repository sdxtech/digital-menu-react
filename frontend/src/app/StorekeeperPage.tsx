import { Fragment, useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useChefData } from '../lib/chef-data'
import { getStoreRequestStatusLabel } from '../lib/status-labels'
import { formatUnitLabel } from '../lib/unit-of-measures'
import { useAuth } from '../lib/auth'

type StoreRequestIngredient = {
  productCode: string
  name: string
  unitOfMeasures: string
  qty: number
}

type StoreRequestMenu = {
  id: string
  productionCode?: string
  recipeId?: string
  recipeCode?: string
  menuName: string
  category: string
  portion: number
  productionDate?: string
  storeRequestStatus?: 'not-requested' | 'requested' | 'fulfilled'
  portionSize?: number
  ingredients?: StoreRequestIngredient[]
  site?: string
}

type StoreRequestGroup = {
  site?: string
  date: string
  productionCode?: string
  items: StoreRequestMenu[]
  summary: StoreRequestIngredient[]
  missingRecipes: string[]
}

const ITEMS_PER_PAGE = 10

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

const StorekeeperPage = () => {
  const { accessToken } = useAuth()
  const { markStoreFulfilled } = useChefData()
  const [loadError, setLoadError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [groups, setGroups] = useState<StoreRequestGroup[]>([])
  const [expandedGroups, setExpandedGroups] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [processingGroupKey, setProcessingGroupKey] = useState<string | null>(
    null,
  )
  const [loading, setLoading] = useState(false)

  // FRONTEND VIEW: backend returns grouped requests with ingredient summary.
  const fetchStoreRequests = useCallback(async () => {
    if (!accessToken) {
      setLoadError('Please log in first to load data.')
      return
    }

    setLoading(true)
    setLoadError('')
    try {
      const data = await apiFetch<{ items: StoreRequestGroup[] }>(
        '/menu-productions/store-requests?storeRequestStatus=requested&approvalStatus=approved',
        undefined,
        accessToken,
      )
      setGroups(data.items ?? [])
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to load data.'
      setLoadError(message)
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  useEffect(() => {
    fetchStoreRequests().catch(() => null)
  }, [fetchStoreRequests])

  useEffect(() => {
    const nextTotalPages = Math.max(
      1,
      Math.ceil(groups.length / ITEMS_PER_PAGE),
    )
    setPage((prev) => Math.min(prev, nextTotalPages))
  }, [groups.length])

  const formatQuantity = (value: number) => {
    if (!Number.isFinite(value)) return '0'
    if (Number.isInteger(value)) return String(value)
    return value.toFixed(3).replace(/\.?0+$/, '')
  }

  const getGroupKey = (group: StoreRequestGroup) =>
    `${group.date}__${group.productionCode ?? 'no-code'}`

  const handleExportMenusByDate = (group: StoreRequestGroup) => {
    const rows: Array<Array<unknown>> = [
      [
        'No',
        'Production Date',
        'Site',
        'Menu Name',
        'Category',
        'Portions',
        'Base Pax',
        'Store Request Status',
        'Product Code',
        'Ingredient Name',
        'Qty',
        'Unit',
      ],
    ]

    const fallbackSite =
      group.site?.trim() ??
      group.items.find((item) => item.site?.trim())?.site?.trim() ??
      '-'

    const toBaseRecipeQty = (
      scaledQty: number,
      portion: number,
      portionSize: number,
    ) => {
      const safePortion = Number(portion)
      const safePortionSize =
        Number.isFinite(portionSize) && portionSize > 0 ? portionSize : 1
      const multiplier = safePortion / safePortionSize
      if (!Number.isFinite(multiplier) || multiplier <= 0) return scaledQty
      return scaledQty / multiplier
    }

    let rowNumber = 1
    group.items.forEach((menu) => {
      const ingredients = menu.ingredients ?? []
      const basePax =
        Number.isFinite(menu.portionSize ?? Number.NaN) &&
        (menu.portionSize ?? 0) > 0
          ? (menu.portionSize as number)
          : 1
      const siteLabel = menu.site?.trim() || fallbackSite
      if (ingredients.length === 0) {
        rows.push([
          rowNumber,
          menu.productionDate ?? group.date,
          siteLabel,
          menu.menuName,
          menu.category,
          menu.portion,
          basePax,
          getStoreRequestStatusLabel(menu.storeRequestStatus ?? 'requested'),
          '',
          '',
          '',
          '',
        ])
        rowNumber += 1
        return
      }

      ingredients.forEach((ingredient) => {
        rows.push([
          rowNumber,
          menu.productionDate ?? group.date,
          siteLabel,
          menu.menuName,
          menu.category,
          menu.portion,
          basePax,
          getStoreRequestStatusLabel(menu.storeRequestStatus ?? 'requested'),
          ingredient.productCode,
          ingredient.name,
          formatQuantity(toBaseRecipeQty(ingredient.qty, menu.portion, basePax)),
          formatUnitLabel(ingredient.unitOfMeasures),
        ])
        rowNumber += 1
      })
    })

    const summaryRows: Array<Array<unknown>> = [
      ['No', 'Product Code', 'Ingredient Name', 'Qty', 'Unit'],
      ...group.summary.map((item, index) => [
        index + 1,
        item.productCode,
        item.name,
        formatQuantity(item.qty),
        formatUnitLabel(item.unitOfMeasures),
      ]),
    ]

    const safeDate = group.date.replace(/[\\/:*?"<>|]/g, '-')
    const safeProductionCode = (group.productionCode ?? 'no-code').replace(
      /[\\/:*?"<>|]/g,
      '-',
    )
    downloadExcel(`store-request-${safeDate}-${safeProductionCode}.xls`, [
      { name: 'Store Requests', rows },
      { name: 'Ingredient Summary', rows: summaryRows },
    ])
  }

  const toggleExpanded = (groupKey: string) => {
    setExpandedGroups((prev) =>
      prev.includes(groupKey)
        ? prev.filter((item) => item !== groupKey)
        : [...prev, groupKey],
    )
  }

  const handleCompleteByDate = async (group: StoreRequestGroup) => {
    const groupKey = getGroupKey(group)
    setActionMessage('')
    setLoadError('')
    setProcessingGroupKey(groupKey)
    try {
      await Promise.all(group.items.map((menu) => markStoreFulfilled(menu.id)))
      const label = group.productionCode
        ? `${group.date} (${group.productionCode})`
        : group.date
      setActionMessage(`Ingredient issuance for ${label} completed.`)
      await fetchStoreRequests()
      setExpandedGroups((prev) => prev.filter((item) => item !== groupKey))
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to complete ingredient issuance.'
      setLoadError(message)
    } finally {
      setProcessingGroupKey(null)
    }
  }

  const totalPages = Math.max(1, Math.ceil(groups.length / ITEMS_PER_PAGE))
  const paginatedGroups = groups.slice(
    (page - 1) * ITEMS_PER_PAGE,
    page * ITEMS_PER_PAGE,
  )

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Store Request</h1>
        <p className="text-sm text-muted">
          This data is auto-added after Unit Manager approval.
        </p>
        {loadError ? (
          <p className="text-xs font-medium text-red-600">{loadError}</p>
        ) : null}
        {actionMessage ? (
          <p className="text-xs font-medium text-primary">{actionMessage}</p>
        ) : null}
      </div>

      <div className="rounded-md border border-border bg-surface shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-t-md border-b border-border bg-white px-5 py-4 text-xs">
          <span className="text-muted">
            Showing {paginatedGroups.length} of {groups.length} production batches
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={page === 1 || loading}
              className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              Prev
            </button>
            <span className="text-xs font-semibold text-foreground">
              Page {page} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={page === totalPages || loading}
              className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              Next
            </button>
          </div>
        </div>

        <div className="max-w-full overflow-x-auto">
          <table className="dm-table min-w-full text-sm">
            <thead className="bg-background">
              <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                <th className="w-16 px-3 py-1.5 font-semibold">No</th>
                <th className="px-3 py-1.5 font-semibold">Production date</th>
                <th className="px-3 py-1.5 font-semibold">Production code</th>
                <th className="px-3 py-1.5 font-semibold">Store request status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr className="border-t border-border">
                  <td colSpan={4} className="px-5 py-10 text-center text-muted">
                    Loading store requests...
                  </td>
                </tr>
              ) : groups.length === 0 ? (
                <tr className="border-t border-border">
                  <td colSpan={4} className="px-5 py-10 text-center text-muted">
                    No production menus in store request yet.
                  </td>
                </tr>
              ) : (
                paginatedGroups.map((group, index) => {
                  const groupKey = getGroupKey(group)
                  const isExpanded = expandedGroups.includes(groupKey)
                  const summaryItems = group.summary ?? []

                  return (
                    <Fragment key={groupKey}>
                      <tr
                        className="cursor-pointer border-t border-border"
                        onClick={() => toggleExpanded(groupKey)}
                      >
                        <td className="px-3 py-1.5 text-sm text-muted">
                          {(page - 1) * ITEMS_PER_PAGE + index + 1}
                        </td>
                        <td className="px-3 py-1.5">{group.date}</td>
                        <td className="px-3 py-1.5 text-xs text-muted">
                          {group.productionCode ?? '-'}
                        </td>
                        <td className="px-3 py-1.5">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-2 text-sm">
                              <span>Requested</span>
                              <span className="rounded-full bg-primary-soft px-2 py-1 text-xs font-semibold text-primary">
                                {group.items.length} menus
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                toggleExpanded(groupKey)
                              }}
                              className="rounded-md border border-primary bg-primary-soft px-3 py-1 text-xs font-semibold text-primary hover:bg-primary-soft/80"
                            >
                              {isExpanded ? 'Hide details' : 'View details'}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded ? (
                        <tr className="border-t border-border bg-background">
                          <td colSpan={4} className="px-4 py-4">
                            <div className="space-y-6">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                  <p className="text-xs text-muted">
                                    Request details
                                  </p>
                                  <p className="mt-2 text-sm text-muted">
                                    Production date: {group.date}
                                  </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleExportMenusByDate(group)}
                                    className="rounded-md border border-success bg-white px-4 py-2 text-xs font-semibold text-success shadow-sm hover:bg-success/10"
                                  >
                                    <span className="flex items-center gap-2">
                                      <i className="bi bi-download text-sm" aria-hidden="true" />
                                      <span>Export</span>
                                    </span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleCompleteByDate(group)}
                                    disabled={
                                      processingGroupKey === groupKey ||
                                      group.items.length === 0
                                    }
                                    className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    {processingGroupKey === groupKey
                                      ? 'Completing...'
                                      : 'Complete & send to kitchen'}
                                  </button>
                                </div>
                              </div>

                              <div className="space-y-4">
                                <div className="rounded-md border border-border bg-surface p-4">
                                  <p className="text-xs text-muted">
                                    Menu list
                                  </p>
                                  <div className="mt-3 max-w-full overflow-x-auto rounded-md border border-border bg-white">
                                    <table className="dm-table min-w-full text-sm">
                                      <thead className="bg-background">
                                        <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                                          <th className="w-12 px-3 py-1.5 font-semibold">
                                            No
                                          </th>
                                          <th className="px-3 py-1.5 font-semibold">
                                            Menu ID
                                          </th>
                                          <th className="px-3 py-1.5 font-semibold">
                                            Menu
                                          </th>
                                          <th className="px-3 py-1.5 font-semibold">
                                            Category
                                          </th>
                                          <th className="px-3 py-1.5 font-semibold">
                                            Portion
                                          </th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {group.items.map((menu, idx) => (
                                          <tr
                                            key={menu.id}
                                            className="border-t border-border"
                                          >
                                            <td className="px-3 py-1.5 text-sm text-muted">
                                              {idx + 1}
                                            </td>
                                            <td className="px-3 py-1.5 font-medium">
                                              {menu.recipeCode ?? '-'}
                                            </td>
                                            <td className="px-3 py-1.5">
                                              {menu.menuName}
                                            </td>
                                            <td className="px-3 py-1.5">
                                              {menu.category}
                                            </td>
                                            <td className="px-3 py-1.5">
                                              {menu.portion}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                  {group.missingRecipes.length > 0 ? (
                                    <p className="mt-3 text-xs text-danger">
                                      Recipe not found for:{' '}
                                      {group.missingRecipes.join(', ')}
                                    </p>
                                  ) : null}
                                </div>

                                <div className="rounded-md border border-border bg-surface p-4">
                                  <p className="text-xs text-muted">
                                    Ingredient summary
                                  </p>
                                  <div className="mt-3 max-w-full overflow-x-auto rounded-md border border-border bg-white">
                                    <table className="dm-table min-w-full text-sm">
                                      <thead className="bg-background">
                                        <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                                          <th className="w-12 px-3 py-1.5 font-semibold">
                                            No
                                          </th>
                                          <th className="px-3 py-1.5 font-semibold">
                                            Product code
                                          </th>
                                          <th className="px-3 py-1.5 font-semibold">
                                            Ingredient name
                                          </th>
                                          <th className="px-3 py-1.5 font-semibold">
                                            Qty
                                          </th>
                                          <th className="px-3 py-1.5 font-semibold">
                                            Unit
                                          </th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {summaryItems.length === 0 ? (
                                          <tr className="border-t border-border">
                                            <td
                                              colSpan={5}
                                              className="px-4 py-6 text-center text-muted"
                                            >
                                              No ingredients available to
                                              calculate.
                                            </td>
                                          </tr>
                                        ) : (
                                          summaryItems.map((item, idx) => (
                                            <tr
                                              key={`${item.productCode}-${item.unitOfMeasures}-${idx}`}
                                              className="border-t border-border"
                                            >
                                              <td className="px-3 py-1.5 text-sm text-muted">
                                                {idx + 1}
                                              </td>
                                              <td className="px-3 py-1.5">
                                                {item.productCode}
                                              </td>
                                              <td className="px-3 py-1.5">
                                                {item.name}
                                              </td>
                                              <td className="px-3 py-1.5">
                                                {formatQuantity(item.qty)}
                                              </td>
                                              <td className="px-3 py-1.5">
                                                {formatUnitLabel(
                                                  item.unitOfMeasures,
                                                )}
                                              </td>
                                            </tr>
                                          ))
                                        )}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default StorekeeperPage

