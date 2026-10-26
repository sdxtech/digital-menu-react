import PageHeading from '../components/PageHeading'
import TablePagination from '../components/TablePagination'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { Recipe } from '../lib/chef-data'

type RecipeApi = Omit<Recipe, 'id'> & { id?: string; _id?: string }
type DraftSummary = Pick<Recipe, 'name' | 'category' | 'recipeCode' | 'createdBy' | 'createdByName' | 'createdByEmail' | 'site' | 'siteName' | 'importIssues' | 'updatedAt'> & {
  id?: string
  _id?: string
  ingredientsCount: number
}
type DraftPage = {
  items: DraftSummary[]
  total: number
  totalPages: number
  categories: string[]
}
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
  const isSuperadmin = user?.role === 'superadmin'
  const columnCount = isSuperadmin ? 10 : 8
  const workspacePath = user?.role === 'superadmin' ? '/superadmin' : user?.role === 'corporate-chef' ? '/corporate-chef' : '/chef'
  const [drafts, setDrafts] = useState<DraftSummary[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [categories, setCategories] = useState<string[]>([])
  const [categoryFilter, setCategoryFilter] = useState('')
  const [issueFilter, setIssueFilter] = useState<IssueFilter>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const startIndex = (page - 1) * DRAFTS_PER_PAGE

  const fetchDrafts = useCallback(async (signal?: AbortSignal) => {
    if (!accessToken) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(DRAFTS_PER_PAGE) })
      if (categoryFilter) params.set('category', categoryFilter)
      if (issueFilter) params.set('issueStatus', issueFilter)
      const data = await apiFetch<DraftPage>(
        `/recipes/drafts?${params.toString()}`,
        { signal },
        accessToken,
      )
      if (signal?.aborted) return
      setDrafts(data.items)
      setTotal(data.total)
      setTotalPages(data.totalPages)
      setCategories(data.categories)
      if (page > data.totalPages) setPage(data.totalPages)
    } catch (reason) {
      if (!signal?.aborted) setError(reason instanceof Error ? reason.message : 'Failed to load recipe drafts.')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [accessToken, page, categoryFilter, issueFilter])

  useEffect(() => {
    const controller = new AbortController()
    void fetchDrafts(controller.signal)
    return () => controller.abort()
  }, [fetchDrafts])

  const deleteDraft = async (draft: DraftSummary) => {
    const id = draft.id ?? draft._id
    if (!id || !accessToken || deletingId) return
    if (!window.confirm(`Delete draft "${draft.name}"?`)) return
    setDeletingId(id)
    setError('')
    try {
      await apiFetch(`/recipes/drafts/${encodeURIComponent(id)}`, { method: 'DELETE' }, accessToken)
      await fetchDrafts()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to delete recipe draft.')
    } finally {
      setDeletingId(null)
    }
  }

  const continueDraft = async (draft: DraftSummary) => {
    const id = draft.id ?? draft._id
    if (!id || !accessToken || openingId) return
    setOpeningId(id)
    setError('')
    try {
      const fullDraft = await apiFetch<RecipeApi>(
        `/recipes/drafts/${encodeURIComponent(id)}`,
        undefined,
        accessToken,
      )
      navigate(`${workspacePath}/menu-create`, {
        state: {
          baseRecipe: {
            id,
            recipeCode: fullDraft.recipeCode,
            version: fullDraft.version,
            name: fullDraft.name,
            category: fullDraft.category,
            description: fullDraft.description ?? '',
            cookingMethod: fullDraft.cookingMethod ?? [],
            importIssues: fullDraft.importIssues,
            portionSize: fullDraft.portionSize,
            targetFoodCostPercentage: fullDraft.targetFoodCostPercentage,
            site: fullDraft.site,
            approvalStatus: fullDraft.approvalStatus,
            isDraft: true,
            ingredients: fullDraft.ingredients ?? [],
          },
        },
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to load recipe draft.')
    } finally {
      setOpeningId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <PageHeading className="text-2xl font-semibold text-foreground">Recipe Drafts</PageHeading>
          <p className="mt-1 text-sm text-muted">
            {isSuperadmin
              ? 'Manage recipe drafts from all users and sites. Continue a draft to edit, save, or submit it.'
              : 'Continue recipes that have not been submitted for approval.'}
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
                {isSuperadmin && <th className="px-5 py-3">OWNER</th>}
                {isSuperadmin && <th className="px-5 py-3">SITE</th>}
                <th className="px-5 py-3">INGREDIENTS</th>
                <th className="px-5 py-3">ISSUES</th>
                <th className="px-5 py-3">LAST UPDATED</th>
                <th className="px-5 py-3">ACTION</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={columnCount} className="px-5 py-10 text-center text-muted">
                    Loading recipe drafts...
                  </td>
                </tr>
              ) : drafts.length === 0 ? (
                <tr>
                  <td colSpan={columnCount} className="px-5 py-10 text-center text-muted">
                    {total ? 'No recipe drafts on this page.' : categoryFilter || issueFilter ? 'No recipe drafts match the selected filters.' : 'No recipe drafts yet.'}
                  </td>
                </tr>
              ) : (
                drafts.map((draft, index) => (
                  <tr key={draft.id ?? draft._id} className="border-t border-border">
                    <td className="px-5 py-4">{startIndex + index + 1}</td>
                    <td className="px-5 py-4 text-muted">{draft.recipeCode ?? '-'}</td>
                    <td className="px-5 py-4 font-medium text-foreground">
                      {draft.name}
                    </td>
                    <td className="px-5 py-4">{draft.category}</td>
                    {isSuperadmin && <td className="px-5 py-4">{draft.createdByName || draft.createdByEmail || draft.createdBy || '-'}</td>}
                    {isSuperadmin && <td className="px-5 py-4">{draft.siteName || draft.site || '-'}</td>}
                    <td className="px-5 py-4">{draft.ingredientsCount}</td>
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
                          disabled={deletingId !== null || openingId !== null}
                          onClick={() => { void continueDraft(draft) }}
                          className="rounded-md border border-primary px-3 py-2 text-xs font-semibold text-primary hover:bg-primary-soft disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {openingId === (draft.id ?? draft._id) ? 'Loading...' : 'Continue'}
                        </button>
                        <button type="button" disabled={deletingId !== null || openingId !== null}
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
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          loading={loading || deletingId !== null}
          summary={loading ? 'Loading drafts...' : drafts.length === 0
            ? 'Showing 0 drafts'
            : `Showing ${startIndex + 1}-${startIndex + drafts.length} of ${total} drafts`}
          className="border-t border-border px-5 py-4"
        />
      </div>
    </div>
  )
}

export default ChefRecipeDrafts
