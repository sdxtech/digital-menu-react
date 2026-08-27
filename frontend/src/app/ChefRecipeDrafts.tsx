import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { Recipe } from '../lib/chef-data'

type RecipeApi = Omit<Recipe, 'id'> & { id?: string; _id?: string }

const formatUpdatedAt = (value?: string) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

const ChefRecipeDrafts = () => {
  const navigate = useNavigate()
  const { accessToken, user } = useAuth()
  const workspacePath = user?.role === 'corporate-chef' ? '/corporate-chef' : '/chef'
  const [drafts, setDrafts] = useState<RecipeApi[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchDrafts = useCallback(async () => {
    if (!accessToken) return
    setLoading(true)
    setError('')
    try {
      const data = await apiFetch<{ items?: RecipeApi[] }>(
        '/recipes/drafts',
        undefined,
        accessToken,
      )
      setDrafts(data.items ?? [])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to load recipe drafts.')
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  useEffect(() => {
    fetchDrafts().catch(() => null)
  }, [fetchDrafts])

  const continueDraft = (draft: RecipeApi) => {
    const id = draft.id ?? draft._id
    if (!id) return
    navigate(`${workspacePath}/menu-create`, {
      state: {
        baseRecipe: {
          id,
          recipeCode: draft.recipeCode,
          version: draft.version,
          name: draft.name,
          category: draft.category,
          description: draft.description ?? '',
          portionSize: draft.portionSize,
          site: draft.site,
          approvalStatus: draft.approvalStatus,
          isDraft: true,
          ingredients: draft.ingredients ?? [],
        },
      },
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Recipe Drafts</h1>
          <p className="mt-1 text-sm text-muted">
            Continue recipes that have not been submitted for approval.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate(`${workspacePath}/menu-create`)}
          className="rounded-md bg-primary px-4 py-3 text-sm font-semibold text-white hover:bg-primary/90"
        >
          + Create new recipe
        </button>
      </div>

      <div className="overflow-hidden rounded-md border border-border bg-surface shadow-sm">
        {error ? <p className="p-5 text-sm text-danger">{error}</p> : null}
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-primary text-white">
              <tr>
                <th className="px-5 py-3">NO</th>
                <th className="px-5 py-3">RECIPE CODE</th>
                <th className="px-5 py-3">RECIPE NAME</th>
                <th className="px-5 py-3">CATEGORY</th>
                <th className="px-5 py-3">INGREDIENTS</th>
                <th className="px-5 py-3">LAST UPDATED</th>
                <th className="px-5 py-3">ACTION</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-muted">
                    Loading recipe drafts...
                  </td>
                </tr>
              ) : drafts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-muted">
                    No recipe drafts yet.
                  </td>
                </tr>
              ) : (
                drafts.map((draft, index) => (
                  <tr key={draft.id ?? draft._id} className="border-t border-border">
                    <td className="px-5 py-4">{index + 1}</td>
                    <td className="px-5 py-4 text-muted">{draft.recipeCode ?? '-'}</td>
                    <td className="px-5 py-4 font-medium text-foreground">{draft.name}</td>
                    <td className="px-5 py-4">{draft.category}</td>
                    <td className="px-5 py-4">{draft.ingredients?.length ?? 0}</td>
                    <td className="px-5 py-4 text-muted">{formatUpdatedAt(draft.updatedAt)}</td>
                    <td className="px-5 py-4">
                      <button
                        type="button"
                        onClick={() => continueDraft(draft)}
                        className="rounded-md border border-primary px-3 py-2 text-xs font-semibold text-primary hover:bg-primary-soft"
                      >
                        Continue
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default ChefRecipeDrafts
