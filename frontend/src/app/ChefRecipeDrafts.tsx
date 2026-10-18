import PageHeading from '../components/PageHeading'
import TablePagination from '../components/TablePagination'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { Recipe } from '../lib/chef-data'

type RecipeApi = Omit<Recipe, 'id'> & { id?: string; _id?: string }
type IssueFilter = '' | 'issues' | 'no-issues'

const DRAFTS_PER_PAGE = 20
const filterClassName =
  'h-10 w-full rounded-xl border border-border bg-white px-3 py-2 text-sm text-primary shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20'

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
  const workspacePath = user?.role === 'superadmin' ? '/superadmin' : user?.role === 'corporate-chef' ? '/corporate-chef' : '/chef'
  const [drafts, setDrafts] = useState<RecipeApi[]>([])
  const [page, setPage] = useState(1)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [issueFilter, setIssueFilter] = useState<IssueFilter>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const categories = Array.from(new Set([
    ...drafts.map((draft) => (draft.category ?? '').trim()),
    categoryFilter,
  ])).filter(Boolean).sort((a, b) => a.localeCompare(b))
  const filteredDrafts = drafts.filter((draft) => {
    const matchesCategory = !categoryFilter || (draft.category ?? '').trim() === categoryFilter
    const hasIssues = (draft.importIssues?.length ?? 0) > 0
    const matchesIssues = !issueFilter || (issueFilter === 'issues' ? hasIssues : !hasIssues)
    return matchesCategory && matchesIssues
  })
  const totalPages = Math.max(1, Math.ceil(filteredDrafts.length / DRAFTS_PER_PAGE))
  const currentPage = Math.min(page, totalPages)
  const startIndex = (currentPage - 1) * DRAFTS_PER_PAGE
  const pageDrafts = filteredDrafts.slice(startIndex, startIndex + DRAFTS_PER_PAGE)

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
      setPage(1)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to load recipe drafts.')
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  useEffect(() => {
    fetchDrafts().catch(() => null)
  }, [fetchDrafts])

  const deleteDraft = async (draft: RecipeApi) => {
    const id = draft.id ?? draft._id
    if (!id || !accessToken || deletingId) return
    if (!window.confirm(`Delete draft "${draft.name}"?`)) return
    setDeletingId(id)
    setError('')
    try {
      await apiFetch(`/recipes/drafts/${encodeURIComponent(id)}`, { method: 'DELETE' }, accessToken)
      setDrafts((current) => current.filter((item) => (item.id ?? item._id) !== id))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to delete recipe draft.')
    } finally {
      setDeletingId(null)
    }
  }

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
          cookingMethod: draft.cookingMethod ?? [],
          importIssues: draft.importIssues,
          portionSize: draft.portionSize,
          targetFoodCostPercentage: draft.targetFoodCostPercentage,
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
          <PageHeading className="text-2xl font-semibold text-foreground">Recipe Drafts</PageHeading>
          <p className="mt-1 text-sm text-muted">
            Continue recipes that have not been submitted for approval.
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-border bg-surface shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
          <div className="w-full text-sm sm:w-[calc(8ch+3rem)]">
            <label htmlFor="recipe-drafts-category" className="sr-only">Category</label>
            <select
              id="recipe-drafts-category"
              value={categoryFilter}
              onChange={(event) => {
                setCategoryFilter(event.target.value)
                setPage(1)
              }}
              className={filterClassName}
            >
              <option value="">Category</option>
              {categories.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </div>
          <div className="w-full text-sm sm:w-[calc(12ch+3rem)]">
            <label htmlFor="recipe-drafts-issues" className="sr-only">Issue status</label>
            <select
              id="recipe-drafts-issues"
              value={issueFilter}
              onChange={(event) => {
                setIssueFilter(event.target.value as IssueFilter)
                setPage(1)
              }}
              className={filterClassName}
            >
              <option value="">Issue status</option>
              <option value="issues">Issues</option>
              <option value="no-issues">No issues</option>
            </select>
          </div>
          <button
            type="button"
            onClick={() => {
              setCategoryFilter('')
              setIssueFilter('')
              setPage(1)
            }}
            className="h-10 rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-200"
          >
            Reset filters
          </button>
          <button
            type="button"
            onClick={() => navigate(`${workspacePath}/menu-create`)}
            className="h-10 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary/90"
          >
            + Create new recipe
          </button>
        </div>
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
                <th className="px-5 py-3">ISSUES</th>
                <th className="px-5 py-3">LAST UPDATED</th>
                <th className="px-5 py-3">ACTION</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-muted">
                    Loading recipe drafts...
                  </td>
                </tr>
              ) : filteredDrafts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-muted">
                    {drafts.length ? 'No recipe drafts match the selected filters.' : 'No recipe drafts yet.'}
                  </td>
                </tr>
              ) : (
                pageDrafts.map((draft, index) => (
                  <tr key={draft.id ?? draft._id} className="border-t border-border">
                    <td className="px-5 py-4">{startIndex + index + 1}</td>
                    <td className="px-5 py-4 text-muted">{draft.recipeCode ?? '-'}</td>
                    <td className="px-5 py-4 font-medium text-foreground">
                      {draft.name}
                    </td>
                    <td className="px-5 py-4">{draft.category}</td>
                    <td className="px-5 py-4">{draft.ingredients?.length ?? 0}</td>
                    <td className="px-5 py-4">
                      {draft.importIssues?.length ? (
                        <details className="text-xs text-amber-700">
                          <summary className="cursor-pointer whitespace-nowrap font-semibold">{draft.importIssues.length} issues</summary>
                          <p className="mt-2 text-muted">Issues at last check</p>
                          <ul className="mt-2 max-h-48 min-w-64 max-w-md list-disc space-y-1 overflow-y-auto pl-4">
                            {draft.importIssues.map((issue, index) => <li key={index}>{issue}</li>)}
                          </ul>
                        </details>
                      ) : (
                        <span className="whitespace-nowrap text-xs text-muted">{draft.importIssues ? 'No issues' : '-'}</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-muted">{formatUpdatedAt(draft.updatedAt)}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={deletingId !== null}
                          onClick={() => continueDraft(draft)}
                          className="rounded-md border border-primary px-3 py-2 text-xs font-semibold text-primary hover:bg-primary-soft disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Continue
                        </button>
                        <button type="button" disabled={deletingId !== null}
                          onClick={() => { void deleteDraft(draft) }}
                          aria-label={`Delete draft ${draft.name}`}
                          className="inline-flex items-center gap-2 rounded-md border border-red-600 bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60">
                          <i className="bi bi-trash3" aria-hidden="true" />
                          {deletingId === (draft.id ?? draft._id) ? 'Deleting...' : 'Delete'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <TablePagination
          page={currentPage}
          totalPages={totalPages}
          onPageChange={setPage}
          loading={loading || deletingId !== null}
          summary={filteredDrafts.length === 0
            ? 'Showing 0 drafts'
            : `Showing ${startIndex + 1}-${startIndex + pageDrafts.length} of ${filteredDrafts.length} drafts`}
          className="border-t border-border px-5 py-4"
        />
      </div>
    </div>
  )
}

export default ChefRecipeDrafts
