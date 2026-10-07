import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'

const RecipeFoodCostSetting = () => {
  const { accessToken } = useAuth()
  const [required, setRequired] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!accessToken) return
    let active = true
    apiFetch<{ targetFoodCostRequired: boolean }>('/recipes/settings', undefined, accessToken)
      .then((settings) => { if (active) setRequired(settings.targetFoodCostRequired) })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Failed to load recipe settings.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [accessToken])

  const save = async (nextRequired: boolean) => {
    if (!accessToken) return
    setSaving(true)
    setError('')
    try {
      const settings = await apiFetch<{ targetFoodCostRequired: boolean }>('/recipes/settings', {
        method: 'PATCH', body: JSON.stringify({ targetFoodCostRequired: nextRequired }),
      }, accessToken)
      setRequired(settings.targetFoodCostRequired)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to save recipe settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <label className="flex items-center gap-3 text-sm font-medium">
        <input type="checkbox" checked={required} disabled={loading || saving || !accessToken}
          onChange={(event) => { void save(event.target.checked) }} />
        Require target food cost when creating or updating recipes
      </label>
      <p className="mt-2 text-xs text-muted">Applies to chef, corporate chef, and superadmin. Existing recipes can be completed through update.</p>
      {saving ? <p className="mt-2 text-xs text-muted" role="status">Saving...</p> : null}
      {error ? <p className="mt-2 text-xs text-danger" role="alert">{error}</p> : null}
    </div>
  )
}

export default RecipeFoodCostSetting
