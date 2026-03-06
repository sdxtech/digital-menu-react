import { Fragment, useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'
import { formatUnitLabel } from '../lib/unit-of-measures'

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
  storeRequestStatus: 'not-requested' | 'requested' | 'fulfilled'
  portionSize: number
  ingredients: StoreRequestIngredient[]
  missingRecipe: boolean
}

type StoreRequestGroup = {
  date: string
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

const buildSpreadsheetXml = (
  sheetName: string,
  rows: Array<Array<unknown>>,
) => {
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
 <Worksheet ss:Name="${xmlEscape(safeName)}">
  <Table>${rowXml}</Table>
 </Worksheet>
</Workbook>`
}

const downloadExcel = (
  filename: string,
  sheetName: string,
  rows: Array<Array<unknown>>,
) => {
  const xml = buildSpreadsheetXml(sheetName, rows)
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

const ChefStoreRequest = () => {
  const { accessToken } = useAuth()
  const [errorMessage, setErrorMessage] = useState('')
  const [expandedDates, setExpandedDates] = useState<string[]>([])
  const [groups, setGroups] = useState<StoreRequestGroup[]>([])
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)

  const formatQuantity = (value: number) => {
    if (!Number.isFinite(value)) return '0'
    if (Number.isInteger(value)) return String(value)
    return value.toFixed(3).replace(/\.?0+$/, '')
  }

  const storeRequestStatusLabel = (
    status: StoreRequestMenu['storeRequestStatus'],
  ) => {
    if (status === 'fulfilled') return 'Delivered to kitchen'
    if (status === 'requested') return 'Auto-requested'
    return 'Waiting for auto request'
  }

  const handleExportMenusByDate = (group: StoreRequestGroup) => {
    const header = [
      'Production Date',
      'Menu Name',
      'Category',
      'Portions',
      'Base Pax',
      'Store Request Status',
      'Notes',
      'Product Code',
      'Ingredient Name',
      'Qty',
      'Unit',
    ]

    const rows: Array<Array<string>> = []
    group.items.forEach((menu) => {
      const ingredients = menu.ingredients ?? []
      const note = menu.missingRecipe
        ? 'Missing recipe'
        : ingredients.length === 0
          ? 'No ingredients'
          : ''
      const baseRow = [
        group.date,
        menu.menuName,
        menu.category,
        String(menu.portion),
        String(menu.portionSize ?? 1),
        storeRequestStatusLabel(menu.storeRequestStatus),
        note,
      ]

      if (ingredients.length === 0) {
        rows.push([...baseRow, '', '', '', ''])
        return
      }

      ingredients.forEach((ingredient) => {
        rows.push([
          ...baseRow,
          ingredient.productCode,
          ingredient.name,
          formatQuantity(ingredient.qty),
          formatUnitLabel(ingredient.unitOfMeasures),
        ])
      })
    })

    const safeDate = group.date.replace(/[\\/:*?"<>|]/g, '-')
    downloadExcel(
      `store-request-menu-${safeDate}.xls`,
      `Menus ${group.date}`,
      [header, ...rows],
    )
  }

  // FRONTEND VIEW: backend returns grouped store requests with multiplied ingredients.
  const fetchStoreRequests = useCallback(async () => {
    if (!accessToken) {
      setErrorMessage('Please log in first to load store requests.')
      return
    }

    setLoading(true)
    setErrorMessage('')
    try {
      const data = await apiFetch<{ items: StoreRequestGroup[] }>(
        '/menu-productions/store-requests?approvalStatus=approved',
        undefined,
        accessToken,
      )
      setGroups(data.items ?? [])
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to refresh data.'
      setErrorMessage(message)
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  const toggleExpanded = (date: string) => {
    setExpandedDates((prev) =>
      prev.includes(date) ? prev.filter((item) => item !== date) : [...prev, date],
    )
  }

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

  const totalPages = Math.max(1, Math.ceil(groups.length / ITEMS_PER_PAGE))
  const paginatedGroups = groups.slice(
    (page - 1) * ITEMS_PER_PAGE,
    page * ITEMS_PER_PAGE,
  )

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Store Request</h1>
        {errorMessage ? (
          <p className="text-xs font-medium text-red-600">{errorMessage}</p>
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
                <th className="w-16 px-5 py-4 font-semibold">No</th>
                <th className="px-5 py-4 font-semibold">Production date</th>
                <th className="px-5 py-4 font-semibold">Approval status</th>
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
                    No production menus approved by the Unit Manager yet.
                  </td>
                </tr>
              ) : (
                paginatedGroups.map((group, index) => {
                const date = group.date
                const items = group.items
                const summaryItems = group.summary ?? []
                const isExpanded = expandedDates.includes(date)

                return (
                  <Fragment key={date}>
                    <tr
                      className="border-t border-border cursor-pointer"
                      onClick={() => toggleExpanded(date)}
                    >
                      <td className="px-5 py-4 text-sm text-muted">
                        {(page - 1) * ITEMS_PER_PAGE + index + 1}
                      </td>
                      <td className="px-5 py-4">{date}</td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-2 text-sm">
                            <span>Approved</span>
                            <span className="rounded-full bg-primary-soft px-2 py-1 text-xs font-semibold text-primary">
                              {items.length} menus
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              toggleExpanded(date)
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
                        <td colSpan={3} className="px-5 py-5">
                          <div className="space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-xs font-bold text-muted">
                                  Menu details
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
                              </div>
                            </div>

                            {items.map((menu) => {
                              const ingredients = menu.ingredients ?? []

                              return (
                                <div
                                  key={menu.id}
                                  className="grid gap-3 lg:grid-cols-12"
                                >
                                  <div className="rounded-md border border-border bg-surface p-4 lg:col-span-3">
                                    <div className="flex items-center justify-between gap-3">
                                      <div>
                                        <h3 className="font-semibold text-foreground">
                                          Menu
                                        </h3>
                                        <p className="mt-1 text-xs text-muted">
                                          {menu.menuName}
                                        </p>
                                        <p className="mt-1 text-xs text-muted">
                                          {menu.category}
                                        </p>
                                      </div>
                                      <span className="rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold text-primary">
                                        {menu.portion} portions
                                      </span>
                                    </div>

                                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                                      <div>
                                        <p className="text-xs text-muted">
                                          Store request
                                        </p>
                                        <p className="mt-1 text-sm font-medium">
                                          {menu.storeRequestStatus === 'fulfilled'
                                            ? 'Delivered to kitchen'
                                            : menu.storeRequestStatus ===
                                                'requested'
                                              ? 'Auto-requested'
                                              : 'Waiting for auto request'}
                                        </p>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="rounded-md border border-border bg-surface p-4 lg:col-span-9">
                                    <h3 className="font-semibold text-foreground">
                                      Ingredients
                                    </h3>
                                    <p className="mt-1 text-xs text-muted">
                                      Ingredient requirements
                                    </p>
                                    <p className="mt-1 text-xs text-muted">
                                      Qty calculated from base pax (
                                      {menu.portionSize ?? 1}) for {menu.portion}{' '}
                                      portions
                                    </p>

                                    {menu.missingRecipe ? (
                                      <div className="mt-3 rounded-md border border-border bg-background p-4 text-sm text-muted">
                                        Recipe not found in the recipe list. Make
                                        sure the menu name matches the created
                                        recipe.
                                      </div>
                                    ) : ingredients.length === 0 ? (
                                      <div className="mt-3 rounded-md border border-border bg-background p-4 text-sm text-muted">
                                        No ingredients for this recipe yet.
                                      </div>
                                    ) : (
                                      <div className="mt-3 overflow-x-auto rounded-md border border-border bg-white">
                                        <table className="dm-table min-w-full text-sm">
                                          <thead className="bg-background">
                                            <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                                              <th className="w-12 px-4 py-3 font-semibold">
                                                No
                                              </th>
                                              <th className="px-4 py-3 font-semibold">
                                                Product code
                                              </th>
                                              <th className="px-4 py-3 font-semibold">
                                                Ingredient name
                                              </th>
                                              <th className="px-4 py-3 font-semibold">
                                                Qty
                                              </th>
                                              <th className="px-4 py-3 font-semibold">
                                                Unit
                                              </th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {ingredients.map((ingredient, idx) => (
                                              <tr
                                                key={`${ingredient.productCode}-${idx}`}
                                                className="border-t border-border"
                                              >
                                                <td className="px-4 py-3 text-sm text-muted">
                                                  {idx + 1}
                                                </td>
                                                <td className="px-4 py-3">
                                                  {ingredient.productCode}
                                                </td>
                                                <td className="px-4 py-3">
                                                  {ingredient.name}
                                                </td>
                                                <td className="px-4 py-3">
                                                  {formatQuantity(ingredient.qty)}
                                                </td>
                                                <td className="px-4 py-3">
                                                  {formatUnitLabel(
                                                    ingredient.unitOfMeasures,
                                                  )}
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )
                            })}

                            <div className="rounded-md border border-border bg-surface p-4">
                              <h3 className="font-semibold text-foreground">
                                Summary
                              </h3>
                              <p className="mt-1 text-xs text-muted">
                                Ingredient summary
                              </p>
                              <p className="mt-1 text-xs text-muted">
                                Combined ingredients for all menus on {date}.
                              </p>

                              {summaryItems.length === 0 ? (
                                <div className="mt-3 rounded-md border border-border bg-background p-4 text-sm text-muted">
                                  No ingredient summary available yet.
                                </div>
                              ) : (
                                <div className="mt-3 overflow-x-auto rounded-md border border-border bg-white">
                                  <table className="dm-table min-w-full text-sm">
                                    <thead className="bg-background">
                                      <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                                        <th className="w-12 px-4 py-3 font-semibold">
                                          No
                                        </th>
                                        <th className="px-4 py-3 font-semibold">
                                          Product code
                                        </th>
                                        <th className="px-4 py-3 font-semibold">
                                          Ingredient name
                                        </th>
                                        <th className="px-4 py-3 font-semibold">
                                          Qty
                                        </th>
                                        <th className="px-4 py-3 font-semibold">
                                          Unit
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {summaryItems.map((ingredient, idx) => (
                                        <tr
                                          key={`${ingredient.productCode}-${idx}`}
                                          className="border-t border-border"
                                        >
                                          <td className="px-4 py-3 text-sm text-muted">
                                            {idx + 1}
                                          </td>
                                          <td className="px-4 py-3">
                                            {ingredient.productCode}
                                          </td>
                                          <td className="px-4 py-3">
                                            {ingredient.name}
                                          </td>
                                          <td className="px-4 py-3">
                                            {formatQuantity(ingredient.qty)}
                                          </td>
                                          <td className="px-4 py-3">
                                            {formatUnitLabel(
                                              ingredient.unitOfMeasures,
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
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

export default ChefStoreRequest

