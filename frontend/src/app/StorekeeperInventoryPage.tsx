import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'

const defaultDashboardUrl =
  'https://datastudio.google.com/embed/reporting/cf2f45a4-fe6b-487f-bb2e-fea018739634/page/p_o5k0hjw06d'

const dashboardUrl =
  (import.meta.env.VITE_INVENTORY_DASHBOARD_URL as string | undefined)?.trim() ||
  defaultDashboardUrl

const StorekeeperInventoryPage = () => {
  const { accessToken } = useAuth()
  const [inventoryEnabled, setInventoryEnabled] = useState<boolean | null>(null)
  const [loadError, setLoadError] = useState('')

  const fetchInventoryStatus = useCallback(async () => {
    if (!accessToken) return

    setLoadError('')
    try {
      const result = await apiFetch<{ enabled: boolean }>(
        '/feature-flags/inventory',
        undefined,
        accessToken,
      )
      setInventoryEnabled(result.enabled)
    } catch (error) {
      setInventoryEnabled(null)
      setLoadError(
        error instanceof Error
          ? error.message
          : 'Failed to check Inventory availability.',
      )
    }
  }, [accessToken])

  useEffect(() => {
    fetchInventoryStatus().catch(() => null)
  }, [fetchInventoryStatus])

  if (inventoryEnabled !== true) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Inventory</h1>
          <p className="text-sm text-muted">
            {inventoryEnabled === false
              ? 'The Inventory dashboard is currently disabled by Superadmin.'
              : 'Checking Inventory availability...'}
          </p>
          {loadError ? (
            <div className="space-y-3">
              <p className="text-xs font-medium text-red-600">{loadError}</p>
              <button
                type="button"
                onClick={() => fetchInventoryStatus()}
                className="rounded-md border border-border bg-background px-4 py-2 text-xs font-semibold text-primary"
              >
                Try again
              </button>
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Inventory</h1>
        <p className="text-sm text-muted">
          Inventory data is displayed according to the Google account currently
          signed in on this browser.
        </p>
      </div>

      <div className="overflow-hidden rounded-md border border-border bg-surface shadow-sm">
        <iframe
          src={dashboardUrl}
          title="Storekeeper inventory dashboard"
          className="h-[calc(100vh-13rem)] min-h-[640px] w-full"
          allowFullScreen
          sandbox="allow-storage-access-by-user-activation allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        />
      </div>
    </div>
  )
}

export default StorekeeperInventoryPage
