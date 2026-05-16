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
  const [siteOptions, setSiteOptions] = useState<SiteOption[]>([])

  const fetchSites = useCallback(async () => {
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
      actionMode="select"
    />
  )
}

export default SuperadminStoreRequestPage
