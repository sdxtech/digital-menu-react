import { useEffect, useState } from 'react'
import { apiFetch } from './api'
import { useAuth } from './auth'

type SiteOption = { code: string; name: string }

type CorporateSiteContext = {
  site?: string
  siteName?: string
  sites?: string[]
  siteOptions?: SiteOption[]
  corporateSite?: boolean
  approvalSiteOptions?: SiteOption[]
  materialReferenceSites?: SiteOption[]
}

export const useCorporateSite = (enabled: boolean) => {
  const { accessToken } = useAuth()
  const [context, setContext] = useState<CorporateSiteContext | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!enabled || !accessToken) return
    let active = true
    apiFetch<CorporateSiteContext>('/auth/me', undefined, accessToken)
      .then((data) => {
        if (active) {
          setContext(data)
          setError('')
        }
      })
      .catch((reason: unknown) => {
        if (active) setError(
          reason instanceof Error ? reason.message : 'Failed to load corporate site settings.',
        )
      })
    return () => { active = false }
  }, [accessToken, enabled])
  return { context, error, loading: enabled && !context && !error }
}
