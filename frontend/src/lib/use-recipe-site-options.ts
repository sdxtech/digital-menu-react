import { useEffect, useState } from 'react'
import { apiFetch } from './api'

export const useRecipeSiteOptions = (accessToken: string | null) => {
  const [sites, setSites] = useState<Array<{ code: string; name: string }>>([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (!accessToken) return
    let active = true
    apiFetch<Array<{ code: string; name: string }>>('/recipes/sites', undefined, accessToken)
      .then((data) => {
        if (active) {
          setSites(data)
          setError('')
        }
      })
      .catch((fetchError: unknown) => {
        if (active) {
          setSites([])
          setError(fetchError instanceof Error ? fetchError.message : 'Failed to load recipe sites.')
        }
      })
    return () => { active = false }
  }, [accessToken])

  return { sites, error }
}
