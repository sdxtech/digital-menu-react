import { useCallback, useEffect, useState } from 'react'
import ChefStoreRequest from './ChefStoreRequest'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'

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

const SuperadminStoreRequestPage = () => {
  const { accessToken } = useAuth()
  const [siteOptions, setSiteOptions] = useState<SiteOption[]>([])

  const fetchSites = useCallback(async () => {
    if (!accessToken) {
      setSiteOptions([])
      return
    }

    try {
      const data = await apiFetch<{ items?: SiteApi[] }>(
        '/superadmin/sites?limit=100',
        undefined,
        accessToken,
      )
      setSiteOptions(
        (data.items ?? [])
          .map(mapSite)
          .filter((site) => site.code)
          .sort((a, b) =>
            (a.name || a.code).localeCompare(b.name || b.code, undefined, {
              sensitivity: 'base',
            }),
          ),
      )
    } catch {
      setSiteOptions([])
    }
  }, [accessToken])

  useEffect(() => {
    fetchSites().catch(() => null)
  }, [fetchSites])

  return (
    <ChefStoreRequest
      requireSiteSelection
      siteOptions={siteOptions}
      enableStoreRequestCancellation
      enableStoreRequestCompletion
    />
  )
}

export default SuperadminStoreRequestPage
