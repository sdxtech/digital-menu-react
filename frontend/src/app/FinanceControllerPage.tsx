import LoadingTableBody from '../components/LoadingTableBody'
import { Fragment, useCallback, useEffect, useState } from 'react'
import PageHeading from '../components/PageHeading'
import ProductionInformation from '../components/ProductionInformation'
import TablePagination from '../components/TablePagination'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'
import { formatCreatedDate, formatProductionDate } from '../lib/date-format'
import { formatFoodCostPercentage } from '../lib/food-cost'
import { sortMenuItemsByGroup, summarizePortionsByGroup } from '../lib/menu-production-quantity'
import { formatQuantity } from '../lib/quantity'
import { downloadMenuProductionApproval } from '../lib/menu-production-approval-export'
import { aggregateStoreRequestSummaryByVendor } from '../lib/store-request-summary'
import { getApprovalStatusLabel, getStoreRequestStatusLabel } from '../lib/status-labels'
import { formatUnitLabel } from '../lib/unit-of-measures'

type Ingredient = {
  ingredientType?: 'IT' | 'NMP'
  name: string
  productCode: string
  qty: number
  unitOfMeasures: string
  vendor?: string
  vendorSite?: string
  price?: number
  ingredientCost?: number
}

type Menu = {
  id: string
  productionCode?: string
  menuName: string
  recipeVersion?: number
  recipeCode?: string
  category: string
  group?: string
  clientName?: string
  submittedAt?: string
  submittedByName?: string
  salesInputBy?: string
  reviewedBy?: string
  approvalStatus: 'pending' | 'approved' | 'rejected'
  storeRequestStatus: 'not-requested' | 'requested' | 'fulfilled' | 'cancelled'
  productionDate: string
  portion: number
  estimatedCostPerPax?: number
  estimatedCost?: number
  cost?: number
  ingredients: Ingredient[]
  sellingPricePerPax?: number
  sellingQuantity?: number
  estimatedRevenue?: number
  groupSales?: Array<{ name: string; quantity: number; sellingPricePerPax: number; estimatedRevenue: number }>
  salesRejectionReason?: string
  financeCostStatus?: 'pending' | 'approved' | 'rejected'
  financeSalesStatus?: 'pending' | 'approved' | 'rejected'
}

type Group = {
  site?: string
  date: string
  productionCode?: string
  items: Menu[]
  summary: Ingredient[]
  missingRecipes: string[]
}

type Site = { code: string; name: string }
type Rejection = { group: Group }

const formatMoney = (value?: number) =>
  value === undefined ? '-' : new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
  }).format(value)

export default function FinanceControllerPage() {
  const { accessToken } = useAuth()
  const [sites, setSites] = useState<Site[]>([])
  const [site, setSite] = useState('')
  const [groups, setGroups] = useState<Group[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [rejection, setRejection] = useState<Rejection | null>(null)
  const [reason, setReason] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<string[]>([])

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!accessToken) return
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ view: 'finance-approval', page: String(page), limit: '10' })
      if (site) params.set('site', site)
      const data = await apiFetch<{ items: Group[]; total: number }>(`/menu-productions/store-requests?${params}`, { signal }, accessToken)
      if (signal?.aborted) return
      setGroups(data.items ?? [])
      setTotal(data.total ?? 0)
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : 'Failed to load approvals.')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [accessToken, page, site])

  useEffect(() => {
    if (!accessToken) return
    apiFetch<Site[]>('/menu-productions/finance-sites', undefined, accessToken)
      .then(setSites)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Failed to load sites.'))
  }, [accessToken])

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal).catch(() => null)
    return () => controller.abort()
  }, [load])

  const act = async (status: 'approved' | 'rejected', group: Group, rejectionReason?: string) => {
    if (!accessToken || saving) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const path = `/menu-productions/batch/finance-${status === 'approved' ? 'approve' : 'reject'}`
      await apiFetch(path, {
        method: 'PATCH',
        body: JSON.stringify({
          menuProductionIds: group.items.map((item) => item.id),
          ...(status === 'rejected' ? { reason: rejectionReason } : {}),
        }),
      }, accessToken)
      setMessage(status === 'approved' ? 'Batch approved and forwarded to Storekeeper.' : 'Batch returned to Unit Manager for review.')
      setRejection(null)
      setReason('')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to save approval.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="w-full space-y-6 pb-2">
      <div>
        <PageHeading className="text-2xl font-semibold">Approval Center</PageHeading>
      </div>

      <div className="!mt-2 rounded-md border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-5 py-4">
          <label className="block max-w-sm text-sm font-medium">Site
            <select value={site} onChange={(event) => { setSite(event.target.value); setPage(1) }}
              className="mt-2 w-full rounded-md border border-border bg-white px-3 py-2">
              <option value="">All assigned sites</option>
              {sites.map((option) => <option key={option.code} value={option.code}>{option.name} ({option.code})</option>)}
            </select>
          </label>
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
          {message ? <p role="status" className="text-sm text-primary">{message}</p> : null}
        </div>
        <TablePagination
          page={page}
          totalPages={Math.ceil(total / 10)}
          onPageChange={setPage}
          loading={loading}
          summary={`Showing ${groups.length} of ${total} production batches`}
          className="border-b border-border bg-white px-5 py-4"
        />
        <div className="max-w-full overflow-x-auto">
          <table className="dm-table !w-full !table-fixed bg-white text-sm [&_td]:!whitespace-normal [&_th]:!whitespace-normal">
            <colgroup>
              <col className="w-[5%]" />
              <col className="w-[15%]" />
              <col className="w-[14%]" />
              <col className="w-[16%]" />
              <col className="w-[15%]" />
              <col className="w-[17%]" />
              <col className="w-[18%]" />
            </colgroup>
            <thead className="bg-background">
              <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                <th className="px-4 py-3 font-semibold">No</th>
                <th className="px-4 py-3 font-semibold">Created date</th>
                <th className="px-4 py-3 font-semibold">Production date</th>
                <th className="px-4 py-3 font-semibold">Production code</th>
                <th className="px-4 py-3 font-semibold">Client name</th>
                <th className="px-4 py-3 font-semibold">Batch status</th>
                <th className="px-4 py-3 font-semibold">Action</th>
              </tr>
            </thead>
            <LoadingTableBody
              key={JSON.stringify([page, site])}
              loading={loading}
              columns={7}
              rowCount={groups.length}
              label="Loading approvals..."
              error={error}
              onRetry={() => { void load() }}
            >
              {groups.length === 0 ? <tr className="border-t border-border">
                <td colSpan={7} className="px-4 py-8 text-center text-muted">
                  No menu productions waiting for finance approval.
                </td>
              </tr> : groups.map((group, index) => {
                const salesReady = group.items.every((item) =>
                  typeof item.sellingPricePerPax === 'number' &&
                  typeof item.sellingQuantity === 'number' &&
                  !item.salesRejectionReason,
                )
                const first = group.items[0]
                const groupKey = `${group.site}-${group.date}-${group.productionCode}`
                const expanded = expandedGroups.includes(groupKey)
                const totalCost = group.items.reduce((sum, item) => sum + (item.estimatedCost ?? item.cost ?? 0), 0)
                const revenue = first?.groupSales?.length ? first.estimatedRevenue : typeof first?.sellingPricePerPax === 'number' && typeof first.sellingQuantity === 'number'
                  ? first.sellingPricePerPax * first.sellingQuantity : undefined
                const totalCostPerPax = group.items.reduce((sum, item) =>
                  sum + (item.estimatedCostPerPax ?? (item.portion > 0 ? (item.estimatedCost ?? item.cost ?? 0) / item.portion : 0)), 0)
                const portionSummary = summarizePortionsByGroup(group.items)
                const summaryItems = aggregateStoreRequestSummaryByVendor(group)
                const submittedAt = group.items.find((item) => item.submittedAt)?.submittedAt
                const submittedBy = Array.from(new Set(group.items.map((item) => item.submittedByName?.trim()).filter(Boolean))).join(', ')
                const reviewedBy = Array.from(new Set(group.items.map((item) => item.reviewedBy?.trim()).filter(Boolean))).join(', ')
                const approvalStatus = Array.from(new Set(group.items.map((item) => getApprovalStatusLabel(item.approvalStatus)))).join(', ')
                const batchStatus = 'Waiting for Finance Controller approval'

                return <Fragment key={groupKey}>
                  <tr className="border-t border-border">
                    <td className="px-4 py-3 text-sm font-bold text-black">{(page - 1) * 10 + index + 1}</td>
                    <td className="px-4 py-3 text-sm font-bold text-black">{formatCreatedDate(submittedAt)}</td>
                    <td className="px-4 py-3 font-bold text-black">{formatProductionDate(group.date)}</td>
                    <td className="px-4 py-3 text-xs font-bold text-black">{group.productionCode ?? '-'}</td>
                    <td className="px-4 py-3 font-bold text-black">{first?.clientName ?? '-'}</td>
                    <td className="px-4 py-3">
                      <span className="inline-block rounded-md bg-primary-soft px-2 py-1 text-xs font-semibold text-primary">{batchStatus}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button type="button" onClick={() => setExpandedGroups((current) => expanded ? current.filter((key) => key !== groupKey) : [...current, groupKey])}
                          className="whitespace-nowrap rounded-md border border-primary bg-primary-soft px-2.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary-soft/80">
                          {expanded ? 'Hide details' : 'View details'}
                        </button>
                        <button type="button" onClick={() => downloadMenuProductionApproval(group)}
                          className="whitespace-nowrap rounded-md border border-success bg-white px-2.5 py-1.5 text-xs font-semibold text-success shadow-sm hover:bg-success/10">
                          <span className="flex items-center gap-1.5"><i className="bi bi-download text-sm" aria-hidden="true" /><span>Export</span></span>
                        </button>

                      </div>
                    </td>
                  </tr>
                  {expanded ? <tr className="border-t border-border bg-background">
                    <td colSpan={7} className="px-4 py-4">
                      <div className="space-y-4">
                        <ProductionInformation
                          productionCode={group.productionCode}
                          createdAt={submittedAt}
                          submittedBy={submittedBy}
                          admin={first?.salesInputBy}
                          reviewedBy={reviewedBy}
                          batchStatus={batchStatus}
                          productionDate={group.date}
                          client={first?.clientName}
                          totalMenu={group.items.length}
                          approvalStatus={approvalStatus}
                          storeRequestStatus={Array.from(new Set(group.items.map((item) => getStoreRequestStatusLabel(item.storeRequestStatus)))).join(', ')}
                        />
                        <section>
                          <h3 className="text-sm font-semibold text-foreground">Menu list</h3>
                          <div className="mt-3 overflow-hidden rounded-md border border-black bg-white">
                            <table className="dm-table !w-full !table-fixed text-sm [&_td]:!whitespace-normal [&_th]:!whitespace-normal">
                              <colgroup>
                                <col className="w-[5%]" /><col className="w-[10%]" /><col className="w-[25%]" />
                                <col className="w-[8%]" /><col className="w-[15%]" /><col className="w-[12%]" />
                                <col className="w-[10%]" /><col className="w-[15%]" />
                              </colgroup>
                              <thead className="bg-background">
                                <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                                  <th className="px-3 py-3 font-semibold">No</th>
                                  <th className="px-3 py-3 font-semibold">Group By</th>
                                  <th className="px-3 py-3 font-semibold">Menu</th>
                                  <th className="px-3 py-3 font-semibold">Portion</th>
                                  <th className="px-3 py-3 font-semibold">Estimated Cost</th>
                                  <th className="px-3 py-3 font-semibold">Cost Contribution (%)</th>
                                  <th className="px-3 py-3 font-semibold">Cost/Pax</th>
                                  <th className="px-3 py-3 font-semibold">Unit Manager Approval</th>
                                </tr>
                              </thead>
                              <tbody>{sortMenuItemsByGroup(group.items).map((item, itemIndex) => {
                                const estimatedCost = item.estimatedCost ?? item.cost
                                const costPerPax = item.estimatedCostPerPax ?? (estimatedCost !== undefined && item.portion > 0 ? estimatedCost / item.portion : undefined)
                                return <tr key={item.id} className="border-t border-border">
                                  <td className="px-3 py-3 text-sm text-muted">{itemIndex + 1}</td>
                                  <td className="px-3 py-3">{item.group ?? '-'}</td>
                                  <td className="px-3 py-3">
                                    <p className="truncate !whitespace-nowrap font-semibold text-foreground" title={item.menuName}>{item.menuName}</p>
                                    <p className="mt-1 truncate !whitespace-nowrap text-xs text-muted">{item.recipeCode ?? '-'} · {item.category ?? '-'}</p>
                                  </td>
                                  <td className="px-3 py-3">{item.portion}</td>
                                  <td className="px-3 py-3 font-medium">{formatMoney(estimatedCost)}</td>
                                  <td className="px-3 py-3 font-medium">{formatFoodCostPercentage(estimatedCost, revenue)}</td>
                                  <td className="px-3 py-3 font-medium">{formatMoney(costPerPax)}</td>
                                  <td className="px-3 py-3">
                                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${item.approvalStatus === 'approved' ? 'bg-primary-soft text-primary' : item.approvalStatus === 'rejected' ? 'bg-danger/10 text-danger' : 'bg-background text-muted'}`}>
                                      {getApprovalStatusLabel(item.approvalStatus)}
                                    </span>
                                  </td>
                                </tr>
                              })}</tbody>
                      <tfoot className="bg-[#ccd9ec]">
                        <tr className="border-t-2 border-primary">
                          <td colSpan={4} className="px-3 py-3 text-center text-xs font-bold uppercase tracking-[0.12em]">Total</td>
                          <td className="px-3 py-3 font-bold">{formatMoney(totalCost)}</td>
                          <td className="px-3 py-3 font-bold">{formatFoodCostPercentage(totalCost, revenue)}</td>
                          <td className="px-3 py-3 font-bold">{formatMoney(totalCostPerPax)}</td>
                          <td />
                        </tr>
                        {portionSummary.groups.length > 0 ? <>
                          <tr aria-hidden="true"><td colSpan={8} className="border-y border-primary bg-white">&nbsp;</td></tr>
                          <tr className="border-y border-primary bg-primary text-xs font-bold uppercase tracking-[0.12em] text-white">
                            <td colSpan={2} aria-hidden="true" className="!bg-primary" />
                            <td className="!bg-primary px-3 py-3 text-right">Menu Group Summary</td>
                            <td className="px-3 py-3">Qty</td>
                            <td className="px-3 py-3">Selling Price/Pax</td>
                            <td colSpan={2} className="px-3 py-3">Estimated Revenue</td>
                            <td className="px-3 py-3">Cost Contribution (%)</td>
                          </tr>
                        </> : null}
                        {portionSummary.groups.map((item) => {
                          const groupCost = group.items.reduce((sum, menu) =>
                            (menu.group?.trim() || '-') === item.name
                              ? sum + (menu.estimatedCost ?? menu.cost ?? 0)
                              : sum, 0)
                          const groupSale = first?.groupSales?.find((sale) => sale.name === item.name)
                          return <tr key={item.name} className="border-t border-border">
                            <td colSpan={2} aria-hidden="true" className="bg-white" />
                            <td className="bg-white px-3 py-3 text-right text-xs font-semibold uppercase tracking-[0.12em]">{item.name}</td>
                            <td className="px-3 py-3 font-semibold">{formatQuantity(item.portion)}</td>
                            <td className="px-3 py-3">{formatMoney(groupSale?.sellingPricePerPax)}</td>
                            <td colSpan={2} className="px-3 py-3 font-semibold">{formatMoney(groupSale?.estimatedRevenue)}</td>
                            <td className="px-3 py-3 font-semibold">{formatFoodCostPercentage(groupCost, revenue)}</td>
                          </tr>
                        })}
                        <tr className="border-t border-border">
                          <td colSpan={2} aria-hidden="true" className="bg-white" />
                          <td className="bg-white px-3 py-3 text-right text-xs font-bold uppercase tracking-[0.12em]">Total</td>
                          <td className="px-3 py-3 font-bold">{formatQuantity(portionSummary.total)}</td>
                          <td />
                          <td colSpan={2} className="px-3 py-3 font-bold">{formatMoney(first?.groupSales?.length ? first.groupSales.reduce((sum, sale) => sum + sale.estimatedRevenue, 0) : undefined)}</td>
                          <td className="px-3 py-3 font-bold">{formatFoodCostPercentage(totalCost, revenue)}</td>
                        </tr>
                        <tr aria-hidden="true" className="border-y border-black">
                          <td colSpan={8} className="h-2 p-0" style={{ backgroundColor: 'var(--dm-primary)' }} />
                        </tr>
                        {!first?.groupSales?.length ? <><tr className="border-t border-border">
                          <td colSpan={4} className="px-3 py-3 text-center text-xs font-bold uppercase tracking-[0.12em]">Selling Price/Pax</td>
                          <td colSpan={4} className="px-3 py-3 font-bold">{formatMoney(first?.sellingPricePerPax)}</td>
                        </tr>
                        <tr className="border-t border-border">
                          <td colSpan={4} className="px-3 py-3 text-center text-xs font-bold uppercase tracking-[0.12em]">Pax Calculation</td>
                          <td colSpan={4} className="px-3 py-3 font-bold">{first?.sellingQuantity ?? '-'}</td>
                        </tr></> : null}
                        <tr className="border-t border-border">
                          <td colSpan={4} className="px-3 py-3 text-center text-xs font-bold uppercase tracking-[0.12em]">Estimated Revenue</td>
                          <td colSpan={4} className="px-3 py-3 font-bold">{formatMoney(revenue)}</td>
                        </tr>
                        <tr className="border-t border-border">
                          <td colSpan={4} className="px-3 py-3 text-center text-xs font-bold uppercase tracking-[0.12em]">Food Cost Percentage</td>
                          <td colSpan={4} className="px-3 py-3 font-bold">{formatFoodCostPercentage(totalCost, revenue)}</td>
                        </tr>
                        <tr className="border-t border-border">
                          <td colSpan={4} />
                          <td colSpan={4} className="px-3 py-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <button type="button" disabled={saving || !salesReady} onClick={() => act('approved', group)} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Approve</button>
                              <button type="button" disabled={saving || !salesReady} onClick={() => { setRejection({ group }); setReason('') }} className="rounded-md border border-danger bg-white px-4 py-2 text-sm font-semibold text-danger disabled:opacity-50">Reject</button>
                            </div>
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  {group.missingRecipes.length > 0 ? <p className="mt-3 text-xs text-danger">
                    Recipe not found for: {group.missingRecipes.join(', ')}
                  </p> : null}
                </section>

                <section>
                  <h3 className="text-sm font-semibold text-foreground">Ingredient requirements per menu</h3>
                  <div className="mt-3 space-y-3">
                    {group.items.map((item) => <article key={`ingredients-${item.id}`}>
                      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-foreground">{item.menuName}</p>
                          <p className="mt-1 text-xs text-muted">{item.recipeCode ?? '-'} · {item.category} · {item.portion} pax</p>
                        </div>
                        <span className="rounded-full bg-primary-soft px-2 py-1 text-xs font-semibold text-primary">{item.ingredients.length} ingredients</span>
                      </div>
                      <div className="overflow-hidden rounded-md border border-border bg-white">
                        <table className="dm-table !w-full !table-fixed text-sm [&_td]:!whitespace-normal [&_th]:!whitespace-normal">
                          <colgroup>
                            <col className="w-[5%]" /><col className="w-[12%]" /><col className="w-[30%]" /><col className="w-[7%]" />
                            <col className="w-[7%]" /><col className="w-[18%]" /><col className="w-[10%]" /><col className="w-[11%]" />
                          </colgroup>
                          <thead className="bg-background">
                            <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                              <th className="px-3 py-3 font-semibold">No</th><th className="px-3 py-3 font-semibold">Product code</th>
                              <th className="px-3 py-3 font-semibold">Ingredient name</th><th className="px-3 py-3 font-semibold">Qty</th>
                              <th className="px-3 py-3 font-semibold">Unit</th><th className="px-3 py-3 font-semibold">Vendor</th>
                              <th className="px-3 py-3 font-semibold">Price</th><th className="px-3 py-3 font-semibold">Ingredient Cost</th>
                            </tr>
                          </thead>
                          <tbody>{item.ingredients.length === 0 ? <tr className="border-t border-border">
                            <td colSpan={8} className="px-4 py-5 text-center text-muted">No ingredients available.</td>
                          </tr> : item.ingredients.map((ingredient, ingredientIndex) => <tr key={`${item.id}-${ingredient.productCode}-${ingredientIndex}`} className="border-t border-border">
                            <td className="px-3 py-3 text-muted">{ingredientIndex + 1}</td>
                            <td className="break-all px-3 py-3">{ingredient.productCode || '-'}</td>
                            <td className="break-words px-3 py-3 font-medium">{ingredient.name || '-'}</td>
                            <td className="px-3 py-3">{formatQuantity(ingredient.qty)}</td>
                            <td className="break-words px-3 py-3">{formatUnitLabel(ingredient.unitOfMeasures)}</td>
                            <td className="break-words px-3 py-3">{ingredient.vendor ?? '-'}</td>
                            <td className="break-words px-3 py-3 font-medium">{formatMoney(ingredient.price)}</td>
                            <td className="break-words px-3 py-3 font-medium">{formatMoney(ingredient.ingredientCost)}</td>
                          </tr>)}</tbody>
                        </table>
                      </div>
                    </article>)}
                  </div>
                </section>

                <section>
                  <h3 className="text-sm font-semibold text-foreground">Ingredient summary</h3>
                  <div className="mt-3 overflow-hidden rounded-md border border-border bg-white">
                    <table className="dm-table !w-full !table-fixed text-sm [&_td]:!whitespace-normal [&_th]:!whitespace-normal">
                      <colgroup>
                        <col className="w-[5%]" /><col className="w-[12%]" /><col className="w-[30%]" /><col className="w-[7%]" />
                        <col className="w-[7%]" /><col className="w-[18%]" /><col className="w-[10%]" /><col className="w-[11%]" />
                      </colgroup>
                      <thead className="bg-background">
                        <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                          <th className="px-3 py-3 font-semibold">No</th><th className="px-3 py-3 font-semibold">Product code</th>
                          <th className="px-3 py-3 font-semibold">Ingredient name</th><th className="px-3 py-3 font-semibold">Qty</th>
                          <th className="px-3 py-3 font-semibold">Unit</th><th className="px-3 py-3 font-semibold">Vendor</th>
                          <th className="px-3 py-3 font-semibold">Price</th><th className="px-3 py-3 font-semibold">Ingredient Cost</th>
                        </tr>
                      </thead>
                      <tbody>{summaryItems.length === 0 ? <tr className="border-t border-border">
                        <td colSpan={8} className="px-4 py-6 text-center text-muted">No ingredients available to calculate.</td>
                      </tr> : summaryItems.map((item, itemIndex) => <tr key={`${item.productCode}-${item.unitOfMeasures}-${itemIndex}`} className="border-t border-border">
                        <td className="px-3 py-3 text-muted">{itemIndex + 1}</td>
                        <td className="break-all px-3 py-3">{item.productCode}</td>
                        <td className="break-words px-3 py-3 font-medium">{item.name}</td>
                        <td className="px-3 py-3">{formatQuantity(item.qty)}</td>
                        <td className="break-words px-3 py-3">{formatUnitLabel(item.unitOfMeasures)}</td>
                        <td className="break-words px-3 py-3">{item.vendor ?? '-'}</td>
                        <td className="break-words px-3 py-3 font-medium">{formatMoney(item.price)}</td>
                        <td className="break-words px-3 py-3 font-medium">{formatMoney(item.ingredientCost)}</td>
                      </tr>)}</tbody>
                    </table>
                  </div>
                </section>
              </div>
            </td>
          </tr> : null}
        </Fragment>
      })}
            </LoadingTableBody>
          </table>
        </div>
      </div>
      {rejection ? <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="w-full max-w-md space-y-4 rounded-md bg-surface p-6 shadow-xl">
          <h2 className="font-semibold">Return batch to Unit Manager</h2>
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={4} maxLength={1000} placeholder="Explain which recipes or sales values need Unit Manager review" className="w-full rounded-md border border-border p-3 text-sm" />
          <div className="flex gap-2">
            <button type="button" disabled={saving || reason.trim().length < 3} onClick={() => act('rejected', rejection.group, reason.trim())} className="rounded-md bg-danger px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Reject</button>
            <button type="button" disabled={saving} onClick={() => setRejection(null)} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
          </div>
        </div>
      </div> : null}
    </div>
  )
}
