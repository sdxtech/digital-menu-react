import { Fragment, useCallback, useEffect, useState } from 'react'
import TablePagination from '../components/TablePagination'
import { apiFetch } from '../lib/api'
import { useChefData } from '../lib/chef-data'
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
  menuName: string
  category: string
  portion: number
}

type StoreRequestGroup = {
  date: string
  items: StoreRequestMenu[]
  summary: StoreRequestIngredient[]
  missingRecipes: string[]
}

const ITEMS_PER_PAGE = 10
const GROUP_MENU_ITEMS_PER_PAGE = 8
const GROUP_SUMMARY_ITEMS_PER_PAGE = 8

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
  const [expandedDates, setExpandedDates] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [processingDate, setProcessingDate] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [groupMenuPages, setGroupMenuPages] = useState<Record<string, number>>({})
  const [groupSummaryPages, setGroupSummaryPages] = useState<
    Record<string, number>
  >({})

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

  useEffect(() => {
    const activeDates = new Set(groups.map((group) => group.date))
    setGroupMenuPages((prev) =>
      Object.fromEntries(
        Object.entries(prev).filter(([date]) => activeDates.has(date)),
      ),
    )
    setGroupSummaryPages((prev) =>
      Object.fromEntries(
        Object.entries(prev).filter(([date]) => activeDates.has(date)),
      ),
    )
  }, [groups])

  const formatQuantity = (value: number) => {
    if (!Number.isFinite(value)) return '0'
    if (Number.isInteger(value)) return String(value)
    return value.toFixed(3).replace(/\.?0+$/, '')
  }

  const handleExportMenusByDate = (group: StoreRequestGroup) => {
    const menuRows = [
      ['No', 'Menu', 'Category', 'Portion'],
      ...group.items.map((menu, index) => [
        index + 1,
        menu.menuName,
        menu.category,
        menu.portion,
      ]),
    ]
    const summaryRows = [
      ['No', 'Product code', 'Ingredient name', 'Qty', 'Unit'],
      ...group.summary.map((item, index) => [
        index + 1,
        item.productCode,
        item.name,
        formatQuantity(item.qty),
        formatUnitLabel(item.unitOfMeasures),
      ]),
    ]
    const safeDate = group.date.replace(/[\\/:*?"<>|]/g, '-')
    downloadExcel(`store-request-${safeDate}.xls`, [
      { name: `Menus ${group.date}`, rows: menuRows },
      { name: `Ingredients ${group.date}`, rows: summaryRows },
    ])
  }

  const toggleExpanded = (date: string) => {
    setExpandedDates((prev) =>
      prev.includes(date) ? prev.filter((item) => item !== date) : [...prev, date],
    )
  }

  const handleCompleteByDate = async (group: StoreRequestGroup) => {
    setActionMessage('')
    setLoadError('')
    setProcessingDate(group.date)
    try {
      await Promise.all(group.items.map((menu) => markStoreFulfilled(menu.id)))
      setActionMessage(`Ingredient issuance for ${group.date} completed.`)
      await fetchStoreRequests()
      setExpandedDates((prev) => prev.filter((item) => item !== group.date))
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to complete ingredient issuance.'
      setLoadError(message)
    } finally {
      setProcessingDate(null)
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
            Showing {paginatedGroups.length} of {groups.length} production dates
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

        <div className="overflow-x-auto">
          <table className="dm-table min-w-full text-sm">
            <thead className="bg-background">
              <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                <th className="w-16 px-3 py-1.5 font-semibold">No</th>
                <th className="px-3 py-1.5 font-semibold">Production date</th>
                <th className="px-3 py-1.5 font-semibold">Store request status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr className="border-t border-border">
                  <td colSpan={3} className="px-5 py-10 text-center text-muted">
                    Loading store requests...
                  </td>
                </tr>
              ) : groups.length === 0 ? (
                <tr className="border-t border-border">
                  <td colSpan={3} className="px-5 py-10 text-center text-muted">
                    No production menus in store request yet.
                  </td>
                </tr>
              ) : (
                paginatedGroups.map((group, index) => {
                  const isExpanded = expandedDates.includes(group.date)
                  const summaryItems = group.summary ?? []
                  const groupMenuTotalPages = Math.max(
                    1,
                    Math.ceil(group.items.length / GROUP_MENU_ITEMS_PER_PAGE),
                  )
                  const groupMenuPage = Math.min(
                    groupMenuPages[group.date] ?? 1,
                    groupMenuTotalPages,
                  )
                  const paginatedGroupItems = group.items.slice(
                    (groupMenuPage - 1) * GROUP_MENU_ITEMS_PER_PAGE,
                    groupMenuPage * GROUP_MENU_ITEMS_PER_PAGE,
                  )
                  const groupSummaryTotalPages = Math.max(
                    1,
                    Math.ceil(summaryItems.length / GROUP_SUMMARY_ITEMS_PER_PAGE),
                  )
                  const groupSummaryPage = Math.min(
                    groupSummaryPages[group.date] ?? 1,
                    groupSummaryTotalPages,
                  )
                  const paginatedSummaryItems = summaryItems.slice(
                    (groupSummaryPage - 1) * GROUP_SUMMARY_ITEMS_PER_PAGE,
                    groupSummaryPage * GROUP_SUMMARY_ITEMS_PER_PAGE,
                  )

                  return (
                    <Fragment key={group.date}>
                      <tr
                        className="cursor-pointer border-t border-border"
                        onClick={() => toggleExpanded(group.date)}
                      >
                        <td className="px-3 py-1.5 text-sm text-muted">
                          {(page - 1) * ITEMS_PER_PAGE + index + 1}
                        </td>
                        <td className="px-3 py-1.5">{group.date}</td>
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
                                toggleExpanded(group.date)
                              }}
                              className="rounded-md border border-border bg-white px-3 py-1 text-xs font-semibold text-primary"
                            >
                              {isExpanded ? 'Hide details' : 'View details'}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded ? (
                        <tr className="border-t border-border bg-background">
                          <td colSpan={3} className="px-4 py-4">
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
                                    className="rounded-md border border-border bg-white px-4 py-2 text-xs font-semibold text-primary"
                                  >
                                    Export (Excel)
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleCompleteByDate(group)}
                                    disabled={
                                      processingDate === group.date ||
                                      group.items.length === 0
                                    }
                                    className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    {processingDate === group.date
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
                                  <div className="mt-3 overflow-x-auto rounded-md border border-border bg-white">
                                    <table className="dm-table min-w-full text-sm">
                                      <thead className="bg-background">
                                        <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                                          <th className="w-12 px-3 py-1.5 font-semibold">
                                            No
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
                                        {paginatedGroupItems.map((menu, idx) => (
                                          <tr
                                            key={menu.id}
                                            className="border-t border-border"
                                          >
                                            <td className="px-3 py-1.5 text-sm text-muted">
                                              {(groupMenuPage - 1) *
                                                GROUP_MENU_ITEMS_PER_PAGE +
                                                idx +
                                                1}
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
                                    <TablePagination
                                      page={groupMenuPage}
                                      totalPages={groupMenuTotalPages}
                                      onPageChange={(nextPage) =>
                                        setGroupMenuPages((prev) => ({
                                          ...prev,
                                          [group.date]: nextPage,
                                        }))
                                      }
                                      summary={`Showing ${paginatedGroupItems.length} of ${group.items.length} menus`}
                                      className="px-4 py-3"
                                    />
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
                                  <div className="mt-3 overflow-x-auto rounded-md border border-border bg-white">
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
                                          paginatedSummaryItems.map((item, idx) => (
                                            <tr
                                              key={`${item.productCode}-${item.unitOfMeasures}-${idx}`}
                                              className="border-t border-border"
                                            >
                                              <td className="px-3 py-1.5 text-sm text-muted">
                                                {(groupSummaryPage - 1) *
                                                  GROUP_SUMMARY_ITEMS_PER_PAGE +
                                                  idx +
                                                  1}
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
                                    <TablePagination
                                      page={groupSummaryPage}
                                      totalPages={groupSummaryTotalPages}
                                      onPageChange={(nextPage) =>
                                        setGroupSummaryPages((prev) => ({
                                          ...prev,
                                          [group.date]: nextPage,
                                        }))
                                      }
                                      summary={`Showing ${paginatedSummaryItems.length} of ${summaryItems.length} ingredients`}
                                      className="px-4 py-3"
                                    />
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

