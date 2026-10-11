import { useEffect, useRef, useState } from 'react'
import { apiFetch } from './api'
import { useRecipeExport } from './use-recipe-export'

export const useRecipeExportSelection = (
  accessToken: string | null,
  userKey: string | undefined,
  {
    loading = false,
    site,
    enabled = true,
  }: { loading?: boolean; site?: string; enabled?: boolean } = {},
) => {
  const recipeExport = useRecipeExport(accessToken, userKey, site)
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLElement | null>(null)
  const notificationsEnabled = useRef(false)
  const [ids, setIds] = useState<Set<string>>(new Set())
  const [allSelected, setAllSelected] = useState(false)
  const [allCount, setAllCount] = useState<number | null>(null)
  const [selectionError, setSelectionError] = useState('')

  useEffect(() => {
    setIds(new Set())
    setAllSelected(false)
    setOpen(false)
    notificationsEnabled.current = false
  }, [userKey, site])

  const jobId = recipeExport.job?.jobId
  const status = recipeExport.job?.status
  const error = recipeExport.error
  useEffect(() => {
    if (status === 'waiting' || status === 'processing')
      notificationsEnabled.current = true
    if (
      notificationsEnabled.current &&
      (status === 'completed' || status === 'failed' || error)
    )
      setOpen(true)
  }, [jobId, status, error])

  useEffect(() => {
    if (!allSelected || !accessToken || !enabled) {
      setAllCount(null)
      setSelectionError('')
      return
    }
    if (loading) return
    let cancelled = false
    setAllCount(null)
    setSelectionError('')
    void apiFetch<{ total: number }>(
      '/exports/recipes/count',
      {
        method: 'POST',
        body: JSON.stringify({
          mode: 'all',
          ...(ids.size ? { excludedIds: [...ids] } : {}),
          ...(site ? { site } : {}),
        }),
      },
      accessToken,
    )
      .then((result) => {
        if (!cancelled) setAllCount(result.total)
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setSelectionError(
            cause instanceof Error
              ? cause.message
              : 'Failed to count selected recipes.',
          )
      })
    return () => {
      cancelled = true
    }
  }, [accessToken, allSelected, ids, loading, site, enabled])

  const selectedCount = allSelected ? allCount : ids.size
  const isAllSelected = allSelected && ids.size === 0
  const toggle = (id: string) => {
    if (!id) return
    setIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleAll = () => {
    setAllSelected(!isAllSelected)
    setIds(new Set())
  }
  const canExport = Boolean(
    accessToken &&
    enabled &&
    !recipeExport.busy &&
    selectedCount !== null &&
    selectedCount > 0,
  )
  const startSelected = () => {
    if (!canExport) return
    notificationsEnabled.current = true
    trigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    setOpen(true)
    void recipeExport.start(
      allSelected ? undefined : [...ids],
      allSelected && ids.size ? [...ids] : undefined,
    )
  }
  const close = () => {
    setOpen(false)
    trigger.current?.focus()
  }

  return {
    ...recipeExport,
    open,
    close,
    selectedCount,
    selectionError,
    isAllSelected,
    indeterminate: ids.size > 0,
    selectionDisabled: loading || !enabled,
    isSelected: (id: string) => (allSelected ? !ids.has(id) : ids.has(id)),
    toggle,
    toggleAll,
    startSelected,
    canExport,
  }
}

export type RecipeExportSelection = ReturnType<typeof useRecipeExportSelection>
