import { useEffect, useState } from 'react'
import { ApiError, apiFetch } from './api'

type RecipeExportStatus = {
  jobId: string
  status: 'waiting' | 'processing' | 'completed' | 'failed'
  total: number
  completed: number
  count?: number
  filename?: string
  error?: string
}

export const useRecipeExport = (accessToken: string | null, userKey: string | undefined, site?: string) => {
  const storageKey = userKey ? `dm-recipe-export:${userKey}${site ? `:${site}` : ''}` : undefined
  const [jobId, setJobId] = useState<string | null>(null)
  const [job, setJob] = useState<RecipeExportStatus | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setJob(null)
    setError('')
    try {
      setJobId(storageKey ? localStorage.getItem(storageKey) : null)
    } catch {
      setJobId(null)
      setError('Export history could not be restored from this browser.')
    }
  }, [storageKey])

  useEffect(() => {
    if (!jobId || !accessToken) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      let keepPolling = true
      try {
        const next = await apiFetch<RecipeExportStatus>(
          `/exports/recipes/${encodeURIComponent(jobId)}`, undefined, accessToken,
        )
        if (cancelled) return
        setJob(next)
        setError(next.error ?? '')
        keepPolling = next.status === 'waiting' || next.status === 'processing'
      } catch (cause) {
        if (cancelled) return
        const message = cause instanceof Error ? cause.message : 'Failed to check recipe export status.'
        setError(message)
        if (cause instanceof ApiError && [401, 403, 404].includes(cause.status)) {
          setJob({ jobId, status: 'failed', total: 0, completed: 0, error: message })
          keepPolling = false
        }
      }
      if (!cancelled && keepPolling) timer = setTimeout(() => { void poll() }, 2500)
    }
    void poll()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [accessToken, jobId])

  const busy = submitting || Boolean(jobId && (!job || job.status === 'waiting' || job.status === 'processing'))

  const start = async (ids?: string[], excludedIds?: string[]) => {
    if (!accessToken || busy) return
    setSubmitting(true)
    setError('')
    try {
      const result = await apiFetch<{ jobId: string; total: number }>(
        '/exports/recipes',
        {
          method: 'POST',
          body: JSON.stringify(ids
            ? { mode: 'selected', ids, ...(site ? { site } : {}) }
            : { mode: 'all', ...(excludedIds?.length ? { excludedIds } : {}), ...(site ? { site } : {}) }),
        },
        accessToken,
      )
      setJobId(result.jobId)
      setJob({ ...result, status: 'waiting', completed: 0 })
      try {
        if (storageKey) localStorage.setItem(storageKey, result.jobId)
      } catch {
        setError('The export is running, but its status cannot be restored after leaving this page.')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to start recipe export.')
    } finally {
      setSubmitting(false)
    }
  }

  const download = async () => {
    if (!accessToken || !jobId || downloading || job?.status !== 'completed') return
    setDownloading(true)
    setError('')
    try {
      const result = await apiFetch<{ url: string }>(
        `/exports/recipes/${encodeURIComponent(jobId)}/download`, undefined, accessToken,
      )
      window.location.assign(result.url)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to download recipe export.')
    } finally {
      setDownloading(false)
    }
  }

  return { job, busy, submitting, downloading, error, start, download }
}
