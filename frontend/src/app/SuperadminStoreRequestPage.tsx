import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ChefStoreRequest from './ChefStoreRequest'
import StorekeeperHistoryPage from './StorekeeperHistoryPage'
import UnitManagerMenuProductionRecordsPage from './UnitManagerMenuProductionRecordsPage'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'

type StoreRequestView = 'requests' | 'progress' | 'history'

const views: Array<{
  id: StoreRequestView
  label: string
  description: string
  icon: string
}> = [
  {
    id: 'requests',
    label: 'Store Request',
    description: 'Process, complete, or cancel store requests by site.',
    icon: 'bi-clipboard-check',
  },
  {
    id: 'progress',
    label: 'Production Progress',
    description: 'Monitor every production and store request status.',
    icon: 'bi-graph-up-arrow',
  },
  {
    id: 'history',
    label: 'Issuance History',
    description: 'Review completed and cancelled issuance records.',
    icon: 'bi-clock-history',
  },
]

const isStoreRequestView = (value: string | null): value is StoreRequestView =>
  views.some((view) => view.id === value)

type SiteApi = {
  id?: string
  _id?: string
  name?: string
  code?: string
}

type SiteOption = {
  code: string
  name: string
}

const mapSite = (item: SiteApi): SiteOption => ({
  code: item.code ?? '',
  name: item.name ?? '',
})

const getSequentialSiteCodeNumber = (code: string) => {
  const match = /^S(\d+)$/i.exec(code.trim())
  return match ? Number(match[1]) : undefined
}

const compareSiteOptionsByCode = (a: SiteOption, b: SiteOption) => {
  const aNumber = getSequentialSiteCodeNumber(a.code)
  const bNumber = getSequentialSiteCodeNumber(b.code)

  if (aNumber !== undefined && bNumber !== undefined) {
    return aNumber - bNumber
  }

  return a.code.localeCompare(b.code, undefined, {
    numeric: true,
    sensitivity: 'base',
  })
}

const SuperadminStoreRequestPage = () => {
  const { accessToken } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const viewParam = searchParams.get('view')
  const activeView: StoreRequestView = isStoreRequestView(viewParam)
    ? viewParam
    : 'requests'
  const [siteOptions, setSiteOptions] = useState<SiteOption[]>([])

  const fetchSites = useCallback(async () => {
    if (activeView !== 'requests') return
    if (!accessToken) {
      setSiteOptions([])
      return
    }

    try {
      const data = await apiFetch<{ items?: SiteApi[] }>(
        '/superadmin/sites?limit=200',
        undefined,
        accessToken,
      )
      setSiteOptions(
        (data.items ?? [])
          .map(mapSite)
          .filter((site) => site.code)
          .sort(compareSiteOptionsByCode),
      )
    } catch {
      setSiteOptions([])
    }
  }, [accessToken, activeView])

  useEffect(() => {
    fetchSites().catch(() => null)
  }, [fetchSites])

  const selectView = (view: StoreRequestView) => {
    const next = new URLSearchParams(searchParams)
    if (view === 'requests') next.delete('view')
    else next.set('view', view)
    setSearchParams(next)
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Store Request Operations</h1>
        <p className="mt-1 text-sm text-muted">
          Process store requests and monitor their progress and issuance history
          from one workspace.
        </p>
      </div>

      <div
        className="grid gap-3 rounded-md border border-border bg-surface p-3 shadow-sm md:grid-cols-3"
        role="tablist"
        aria-label="Store request views"
      >
        {views.map((view) => {
          const active = activeView === view.id
          return (
            <button
              key={view.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => selectView(view.id)}
              className={`rounded-md border px-4 py-3 text-left transition ${
                active
                  ? 'border-primary bg-primary text-white shadow-sm'
                  : 'border-border bg-background text-foreground hover:border-primary/40 hover:bg-primary-soft'
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <i className={`bi ${view.icon}`} aria-hidden="true" />
                {view.label}
              </span>
              <span
                className={`mt-1 block text-xs ${active ? 'text-white/80' : 'text-muted'}`}
              >
                {view.description}
              </span>
            </button>
          )
        })}
      </div>

      <div role="tabpanel">
        {activeView === 'requests' ? (
          <ChefStoreRequest
            requireSiteSelection
            siteOptions={siteOptions}
            enableStoreRequestCancellation
            enableStoreRequestCompletion
            enableBulkExport={false}
            actionMode="select"
          />
        ) : null}
        {activeView === 'progress' ? (
          <UnitManagerMenuProductionRecordsPage
            includePending
            title="Menu Production Progress"
            description="Monitor production batches across all sites from submission through approval, store request, completion, rejection, or cancellation."
          />
        ) : null}
        {activeView === 'history' ? <StorekeeperHistoryPage /> : null}
      </div>
    </div>
  )
}

export default SuperadminStoreRequestPage
