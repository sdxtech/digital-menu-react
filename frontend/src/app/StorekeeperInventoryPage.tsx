import PageHeading from '../components/PageHeading'
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'
import InventoryWorkspace from '../components/inventory/InventoryWorkspace'

type InventoryFeatureFlag = {
  enabled: boolean
}

const StorekeeperInventoryPage = () => {
  const { accessToken, user } = useAuth()
  const [searchParams] = useSearchParams()
  const isSuperadmin = user?.role === 'superadmin'
  const isConfiguration = isSuperadmin && searchParams.get('view') === 'configuration'
  const currentView =
    isConfiguration ? 'Inventory Configuration' :
      searchParams.get('view') === 'movements' ? 'Stock Movement' : 'List of Inventory'
  const [inventoryEnabled, setInventoryEnabled] = useState<boolean | null>(null)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [selectedSite, setSelectedSite] = useState(() => searchParams.get('site') ?? '')
  const [sites, setSites] = useState<Array<{ code: string; name: string }>>([])
  const [sitesError, setSitesError] = useState('')
  const site = isSuperadmin ? selectedSite : (user?.site ?? '')

  useEffect(() => {
    if (!isSuperadmin || isConfiguration || !accessToken) return
    const controller = new AbortController()
    const load = async () => {
      try {
        const allSites: Array<{ code: string; name: string }> = []
        let totalPages = 1
        for (let page = 1; page <= totalPages; page++) {
          const result = await apiFetch<{
            items: Array<{ code: string; name: string }>
            totalPages?: number
          }>(
            `/superadmin/sites?limit=200&page=${page}`,
            { signal: controller.signal },
            accessToken,
          )
          allSites.push(...result.items)
          totalPages = result.totalPages ?? 1
        }
        if (!controller.signal.aborted)
          setSites(
            allSites.sort((a, b) =>
              a.code.localeCompare(b.code, undefined, { numeric: true }),
            ),
          )
      } catch (error) {
        if (!controller.signal.aborted)
          setSitesError(
            error instanceof Error ? error.message : 'Failed to load sites.',
          )
      }
    }
    void load()
    return () => controller.abort()
  }, [accessToken, isSuperadmin, isConfiguration])

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

  const siteSelector = isSuperadmin ? (
    <label className="block space-y-1 text-sm">
      <span className="font-medium">Site</span>
      <select
        value={selectedSite}
        onChange={(event) => setSelectedSite(event.target.value)}
        className="w-full rounded-md border border-border bg-surface px-3 py-2"
      >
        <option value="">Select a site...</option>
        {sites.map((option) => (
          <option key={option.code} value={option.code}>
            {option.code} — {option.name}
          </option>
        ))}
      </select>
    </label>
  ) : undefined

  return (
    <div className="space-y-6">
      <PageHeading className="text-2xl font-semibold">{currentView}</PageHeading>

      {isConfiguration ? (
        <section className="!mt-2 rounded-md border border-border bg-surface p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <i
                  className="bi bi-boxes text-lg text-primary"
                  aria-hidden="true"
                />
                <h2 className="text-base font-semibold">
                  Storekeeper Inventory
                </h2>
              </div>
              <p className="mt-2 text-sm text-muted">
                Show or hide Inventory in the Storekeeper workspace. Stock
                recording continues for activated sites. Superadmin access stays
                available.
              </p>
              {loadError ? (
                <div className="mt-2 space-y-2">
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
              {actionError ? (
                <p className="mt-2 text-xs font-medium text-red-600">
                  {actionError}
                </p>
              ) : null}
              {actionMessage ? (
                <p className="mt-2 text-xs font-medium text-green-700">
                  {actionMessage}
                </p>
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

      {isConfiguration ? null : !isSuperadmin && inventoryEnabled !== true ? (
        <div className={isSuperadmin ? 'space-y-2' : '!mt-2 space-y-2'}>
          {inventoryEnabled === null ? (
            <p className="text-sm text-muted">
              Checking Inventory availability...
            </p>
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
        <div className="!mt-2 space-y-4">
          {sitesError ? (
            <p role="alert" className="text-sm text-red-600">
              {sitesError}
            </p>
          ) : null}
          {accessToken ? (
            <InventoryWorkspace
              key={site}
              site={site}
              accessToken={accessToken}
              isSuperadmin={isSuperadmin}
              siteSelector={siteSelector}
            />
          ) : (
            <p className="text-sm text-muted">
              {isSuperadmin
                ? 'Select a site to manage inventory.'
                : 'A site is required to manage inventory.'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default StorekeeperInventoryPage
