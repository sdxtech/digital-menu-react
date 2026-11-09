import PageHeading from '../components/PageHeading'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'

const defaultDashboardUrl =
  'https://datastudio.google.com/embed/reporting/cf2f45a4-fe6b-487f-bb2e-fea018739634/page/p_o5k0hjw06d'

const dashboardUrl =
  (import.meta.env.VITE_INVENTORY_DASHBOARD_URL as string | undefined)?.trim() ||
  defaultDashboardUrl

type InventoryFeatureFlag = {
  enabled: boolean
}

const StorekeeperInventoryPage = () => {
  const { accessToken, user } = useAuth()
  const isSuperadmin = user?.role === 'superadmin'
  const [inventoryEnabled, setInventoryEnabled] = useState<boolean | null>(null)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [saving, setSaving] = useState(false)

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

  const toggleInventoryFeature = async () => {
    if (!accessToken || inventoryEnabled === null || saving) return

    const nextEnabled = !inventoryEnabled
    setSaving(true)
    setActionError('')
    setActionMessage('')
    try {
      const response = await apiFetch<InventoryFeatureFlag>(
        '/feature-flags/inventory',
        {
          method: 'PATCH',
          body: JSON.stringify({ enabled: nextEnabled }),
        },
        accessToken,
      )
      setInventoryEnabled(response.enabled)
      setActionMessage(
        response.enabled
          ? 'Inventory dashboard enabled for Storekeeper.'
          : 'Inventory dashboard disabled for Storekeeper.',
      )
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'Failed to update the Inventory feature status.',
      )
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    fetchInventoryStatus().catch(() => null)
  }, [fetchInventoryStatus])

  return (
    <div className="space-y-6">
      <PageHeading className="text-2xl font-semibold">Inventory</PageHeading>

      {isSuperadmin ? (
        <section className="!mt-2 rounded-md border border-border bg-surface p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <i className="bi bi-boxes text-lg text-primary" aria-hidden="true" />
                <h2 className="text-base font-semibold">Storekeeper Inventory</h2>
              </div>
              <p className="mt-2 text-sm text-muted">
                Show or hide the embedded Inventory dashboard in the Storekeeper workspace.
              </p>
              {loadError ? (
                <p className="mt-2 text-xs font-medium text-red-600">{loadError}</p>
              ) : null}
              {actionError ? (
                <p className="mt-2 text-xs font-medium text-red-600">{actionError}</p>
              ) : null}
              {actionMessage ? (
                <p className="mt-2 text-xs font-medium text-green-700">{actionMessage}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={toggleInventoryFeature}
              disabled={inventoryEnabled === null || saving}
              className={`rounded-md px-4 py-2 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${
                inventoryEnabled ? 'bg-primary' : 'bg-muted'
              }`}
              aria-pressed={inventoryEnabled ?? false}
            >
              {saving
                ? 'Saving...'
                : inventoryEnabled
                  ? 'Inventory enabled'
                  : inventoryEnabled === false
                    ? 'Inventory disabled'
                    : 'Loading...'}
            </button>
          </div>
        </section>
      ) : null}

      {inventoryEnabled !== true ? (
        <div className={isSuperadmin ? 'space-y-2' : '!mt-2 space-y-2'}>
          {inventoryEnabled === null ? (
            <p className="text-sm text-muted">Checking Inventory availability...</p>
          ) : null}
          {loadError ? (
            <div className="space-y-3">
              {!isSuperadmin ? (
                <p className="text-xs font-medium text-red-600">{loadError}</p>
              ) : null}
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
      ) : (
        <div className={`${isSuperadmin ? '' : '!mt-2 '}overflow-hidden rounded-md border border-border bg-surface shadow-sm`}>
          <iframe
            src={dashboardUrl}
            title="Storekeeper inventory dashboard"
            className="h-[calc(100vh-13rem)] min-h-[640px] w-full"
            allowFullScreen
            sandbox="allow-storage-access-by-user-activation allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          />
        </div>
      )}
    </div>
  )
}

export default StorekeeperInventoryPage
