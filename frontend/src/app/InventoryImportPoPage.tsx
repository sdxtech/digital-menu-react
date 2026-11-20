import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import PageHeading from '../components/PageHeading'
import PurchaseOrderImport from '../components/inventory/PurchaseOrderImport'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { InventoryStatus } from '../lib/inventory'

const InventoryImportPoPage = () => {
  const { accessToken, user } = useAuth()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const isSuperadmin = user?.role === 'superadmin'
  const site = isSuperadmin ? searchParams.get('site') ?? '' : user?.site ?? ''
  const inventoryPath = `/${isSuperadmin ? 'superadmin' : 'storekeeper'}/inventory`
  const stockParams = new URLSearchParams({ view: 'stock' })
  if (isSuperadmin && site) stockParams.set('site', site)
  const stockUrl = `${inventoryPath}?${stockParams}`
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    setReady(false)
    setError('')
    if (!site || !accessToken) return () => controller.abort()
    const load = async () => {
      try {
        if (!isSuperadmin) {
          const flag = await apiFetch<{ enabled: boolean }>(
            '/feature-flags/inventory', { signal: controller.signal }, accessToken,
          )
          if (!flag.enabled) throw new Error('Inventory is disabled for Storekeeper.')
        }
        const status = await apiFetch<InventoryStatus>(
          `/inventory/status?site=${encodeURIComponent(site)}`,
          { signal: controller.signal }, accessToken,
        )
        if (!status.active) throw new Error('Record the opening balance in List of Inventory before importing PO.')
        if (!controller.signal.aborted) setReady(true)
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Failed to load inventory.')
      }
    }
    void load()
    return () => controller.abort()
  }, [accessToken, site, isSuperadmin])

  return (
    <div className="space-y-2">
      <PageHeading breadcrumbParents={[
        { label: 'Inventory Management', to: `${inventoryPath}?site=${encodeURIComponent(site)}` },
        { label: 'List of Inventory', to: stockUrl },
      ]}>Import PO</PageHeading>
      {!site || error ? (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-red-600">{error || 'Select a site in List of Inventory before importing PO.'}</p>
          <Link to={stockUrl} className="text-sm font-semibold text-primary underline">Back to List of Inventory</Link>
        </div>
      ) : ready && accessToken ? (
        <PurchaseOrderImport key={site} site={site} accessToken={accessToken}
          onCancel={() => navigate(stockUrl)}
          onSaved={(count) => navigate(stockUrl, {
            state: { inventoryMessage: `${count} PO receipt(s) saved. Stock has increased.` },
          })} />
      ) : <p role="status" className="text-sm text-muted">Checking inventory...</p>}
    </div>
  )
}

export default InventoryImportPoPage
