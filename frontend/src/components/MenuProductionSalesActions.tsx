import { useState } from 'react'
import { createPortal } from 'react-dom'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'
import { formatProductionDate } from '../lib/date-format'

type SalesGroup = {
  productionCode?: string
  date: string
  items: Array<{
    id: string
    clientName?: string
    approvalStatus?: string
    storeRequestStatus?: string
    sellingPricePerPax?: number
    sellingQuantity?: number
    salesRejectionReason?: string
  }>
}

const MenuProductionSalesActions = ({ group, onSaved }: {
  group: SalesGroup
  onSaved: () => void | Promise<void>
}) => {
  const { user, accessToken } = useAuth()
  const [mode, setMode] = useState<'edit' | 'reject' | null>(null)
  const [price, setPrice] = useState('')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const canEdit = user?.role === 'superadmin'
  const canReject = canEdit || user?.role === 'unit-manager'
  if (!canEdit && !canReject) return null
  const eligibleForReject = group.items.length > 0 && group.items.every((item) =>
    ['not-requested', 'requested'].includes(item.storeRequestStatus ?? '') &&
    item.approvalStatus !== 'rejected' && !item.salesRejectionReason &&
    item.sellingPricePerPax != null && item.sellingQuantity != null,
  )
  const open = (nextMode: 'edit' | 'reject') => {
    setMode(nextMode)
    setPrice(group.items[0]?.sellingPricePerPax?.toString() ?? '')
    setQuantity(group.items[0]?.sellingQuantity?.toString() ?? '')
    setReason('')
    setError('')
  }
  const save = async () => {
    if (!mode || !accessToken || saving) return
    const nextPrice = Number(price)
    const nextQuantity = Number(quantity)
    if (mode === 'edit' && (!price.trim() || !quantity.trim() || !Number.isFinite(nextPrice) || nextPrice < 0 || !Number.isFinite(nextQuantity) || nextQuantity < 0 || !Number.isFinite(nextPrice * nextQuantity))) {
      setError('Enter valid non-negative Sales/Pax and Pax Calculation values.')
      return
    }
    if (mode === 'reject' && reason.trim().length < 3) {
      setError('Explain what Admin Sales must correct (at least 3 characters).')
      return
    }
    setSaving(true)
    setError('')
    try {
      await apiFetch(`/menu-productions/batch/${mode === 'edit' ? 'edit-sales' : 'reject-sales'}`, {
        method: 'PATCH',
        body: JSON.stringify({ menuProductionIds: group.items.map((item) => item.id),
          ...(mode === 'edit' ? { sellingPricePerPax: nextPrice, sellingQuantity: nextQuantity } : { reason: reason.trim() }),
        }),
      }, accessToken)
      await onSaved()
      setMode(null)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Failed to update sales.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-wrap gap-2" onClick={(event) => event.stopPropagation()}>
      {canEdit ? <button type="button" onClick={() => open('edit')} className="whitespace-nowrap rounded-md border border-primary bg-white px-3 py-1 text-xs font-semibold text-primary">Edit Sales</button> : null}
      {canReject && eligibleForReject ? <button type="button" onClick={() => open('reject')} className="whitespace-nowrap rounded-md border border-danger bg-white px-3 py-1 text-xs font-semibold text-danger">Reject Sales</button> : null}
      {mode ? createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4">
          <form role="dialog" aria-modal="true" aria-labelledby={`sales-action-${group.items[0]?.id}`}
            onSubmit={(event) => { event.preventDefault(); void save() }}
            className="w-full max-w-lg rounded-md border border-border bg-surface p-6 shadow-xl">
            <h3 id={`sales-action-${group.items[0]?.id}`} className="text-lg font-bold text-black">{mode === 'edit' ? 'Edit Sales' : 'Reject Sales'}</h3>
            <p className="mt-2 text-sm font-bold text-black">{group.productionCode ?? 'MPR'} · {formatProductionDate(group.date)} · {group.items[0]?.clientName ?? '-'}</p>
            <p className="mt-2 text-sm text-muted">{mode === 'edit'
              ? 'Update Sales/Pax and Pax Calculation for the entire MPR. Production quantities, approvals, and actual issuance are preserved.'
              : 'Return this MPR to Admin Sales for correction. Previous sales values will be cleared and the MPR will require Unit Manager approval after resubmission.'}</p>
            {mode === 'edit' ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="text-sm font-semibold text-black">Sales/Pax (IDR)
                  <input type="number" min={0} step="any" required value={price} onChange={(event) => setPrice(event.target.value)} disabled={saving} className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2" />
                </label>
                <label className="text-sm font-semibold text-black">Pax Calculation
                  <input type="number" min={0} step="any" required value={quantity} onChange={(event) => setQuantity(event.target.value)} disabled={saving} className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2" />
                </label>
              </div>
            ) : <label className="mt-4 block text-sm font-semibold text-black">Correction instructions for Admin Sales
              <textarea required minLength={3} maxLength={1000} rows={4} value={reason} onChange={(event) => setReason(event.target.value)} disabled={saving} placeholder="Explain which pax or Sales/Pax value is incorrect and what needs to be fixed." className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2" />
            </label>}
            {error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" disabled={saving} onClick={() => setMode(null)} className="rounded-md border border-border px-4 py-2 text-sm font-semibold">Cancel</button>
              <button type="submit" disabled={saving} className={`rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${mode === 'edit' ? 'bg-primary' : 'bg-danger'}`}>{saving ? 'Saving...' : mode === 'edit' ? 'Save Sales' : 'Reject Sales'}</button>
            </div>
          </form>
        </div>, document.body,
      ) : null}
    </div>
  )
}

export default MenuProductionSalesActions
