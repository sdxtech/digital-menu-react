import { useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { inventoryQuantityLabel, type InventoryLine } from '../../lib/inventory'

type Props = {
  site?: string
  items: Array<{
    productCode: string
    unitOfMeasures: string
    actualQty: string
  }>
}

const InventoryStockWarning = ({ site, items }: Props) => {
  const { accessToken, user } = useAuth()
  const targetSite = site || user?.site
  const [shortages, setShortages] = useState<
    Array<InventoryLine & { available: number; remaining: number }>
  >([])
  const [error, setError] = useState('')
  const payload = JSON.stringify({
    lines: items
      .filter(
        (item) =>
          item.productCode.trim().toUpperCase() !== 'NMP' &&
          item.actualQty.trim() &&
          Number.isFinite(Number(item.actualQty)) &&
          Number(item.actualQty) > 0,
      )
      .map((item) => ({
        productCode: item.productCode,
        unitOfMeasures: item.unitOfMeasures,
        quantity: Number(item.actualQty),
      })),
  })

  useEffect(() => {
    setShortages([])
    setError('')
    if (!accessToken || !targetSite || payload === '{"lines":[]}') return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      apiFetch<{
        shortages: Array<
          InventoryLine & { available: number; remaining: number }
        >
      }>(
        `/inventory/issue-preview?site=${encodeURIComponent(targetSite)}`,
        { method: 'POST', body: payload, signal: controller.signal },
        accessToken,
      )
        .then((result) => {
          if (!controller.signal.aborted) setShortages(result.shortages)
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            setError(
              error instanceof Error
                ? error.message
                : 'Could not check inventory.',
            )
        })
    }, 500)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [accessToken, targetSite, payload])

  if (error)
    return (
      <p role="status" className="mt-3 text-xs text-amber-800">
        Inventory check: {error}
      </p>
    )
  if (!shortages.length) return null
  return (
    <div
      role="status"
      className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
    >
      <p className="font-semibold">
        This issuance can result in negative stock. You can still complete it.
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-4">
        {shortages.map((line) => (
          <li key={`${line.productCode}-${line.unitOfMeasures}`}>
            {line.productCode} — {line.name}: on hand{' '}
            {inventoryQuantityLabel(line.available)}, after issuance{' '}
            {inventoryQuantityLabel(line.remaining)} {line.unitOfMeasures}
          </li>
        ))}
      </ul>
      <p className="mt-2">
        Availability is an estimate and may change before saving.
      </p>
    </div>
  )
}

export default InventoryStockWarning
