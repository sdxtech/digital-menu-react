import LoadingTableBody from '../components/LoadingTableBody'
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
type DraftRecheckBatch = {
  checkedCount: number
  resolvedCount: number
  remainingCount: number
  skippedCount: number
  nextCursor: string | null
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
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [issueFilter, setIssueFilter] = useState<IssueFilter>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [recheckingId, setRecheckingId] = useState<string | null>(null)
  const [recheckingAll, setRecheckingAll] = useState(false)
  const [recheckMessage, setRecheckMessage] = useState('')
  const draftActionPending = deletingId !== null || openingId !== null || recheckingId !== null || recheckingAll
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
      if (search) params.set('search', search)
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
  }, [accessToken, page, categoryFilter, issueFilter, search])

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
    setRecheckMessage('')
    try {
      await apiFetch(`/recipes/drafts/${encodeURIComponent(id)}`, { method: 'DELETE' }, accessToken)
      await fetchDrafts()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to delete recipe draft.')
    } finally {
      setDeletingId(null)
    }
  }

  const recheckDraft = async (draft: DraftSummary) => {
    const id = draft.id ?? draft._id
    if (!id || !accessToken || draftActionPending) return
    setRecheckingId(id)
    setError('')
    setRecheckMessage('')
    try {
      const updated = await apiFetch<RecipeApi>(
        `/recipes/${encodeURIComponent(id)}`,
        { method: 'PATCH', body: JSON.stringify({ saveAsDraft: true }) },
        accessToken,
      )
      const issueCount = updated.importIssues?.length ?? 0
      setRecheckMessage(issueCount
        ? `Rechecked "${draft.name}": ${issueCount} issue${issueCount === 1 ? '' : 's'} remaining.`
        : `Rechecked "${draft.name}": no issues remaining.`)
      await fetchDrafts()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to recheck recipe draft.')
    } finally {
      setRecheckingId(null)
    }
  }

  const continueDraft = async (draft: DraftSummary) => {
    const id = draft.id ?? draft._id
    if (!id || !accessToken || openingId) return
    setOpeningId(id)
    setError('')
    setRecheckMessage('')
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

  const recheckAllDrafts = async () => {
    if (!isSuperadmin || !accessToken || draftActionPending) return
    setRecheckingAll(true)
    setError('')
    setRecheckMessage('Checking all imported drafts with issues. Keep this page open until the check finishes.')
    let afterId: string | null = null
    let checkedCount = 0
    let resolvedCount = 0
    let remainingCount = 0
    let skippedCount = 0
    try {
      do {
        const result: DraftRecheckBatch = await apiFetch<DraftRecheckBatch>(
          '/recipes/drafts/recheck',
          { method: 'POST', body: JSON.stringify(afterId ? { afterId } : {}) },
          accessToken,
        )
        checkedCount += result.checkedCount
        resolvedCount += result.resolvedCount
        remainingCount += result.remainingCount
        skippedCount += result.skippedCount
        afterId = result.nextCursor
        setRecheckMessage(
          `${afterId ? 'Checking' : 'Recheck complete'}: ${checkedCount} drafts checked, ${resolvedCount} now without issues, ${remainingCount} still with issues.`
          + (skippedCount ? ` ${skippedCount} skipped because they changed during the check; run Recheck again for these drafts.` : '')
          + (afterId ? ' Keep this page open until the check finishes.' : ''),
        )
      } while (afterId)
      await fetchDrafts()
    } catch (reason) {
      await fetchDrafts()
      setRecheckMessage('')
      const detail = reason instanceof Error ? reason.message : 'Failed to recheck recipe drafts.'
      setError(`${detail} Bulk recheck stopped. Some drafts may already have been updated; run Recheck all issues again to check the remaining drafts.`)
    } finally {
      setRecheckingAll(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <PageHeading className="text-2xl font-semibold text-foreground">Recipe Drafts</PageHeading>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-border bg-surface shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
          <form
            role="search"
            className="flex w-full gap-2 sm:w-auto"
            onSubmit={(event) => {
              event.preventDefault()
              if (draftActionPending) return
              setSearch(searchInput.trim())
              setPage(1)
            }}
          >
            <label htmlFor="recipe-drafts-search" className="sr-only">Search recipe drafts</label>
            <input
              id="recipe-drafts-search"
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search recipe code or name"
              disabled={draftActionPending}
              className={`${filterClassName} min-w-0 sm:w-64`}
            />
            <button
              type="submit"
              disabled={draftActionPending}
              className="h-10 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary/90"
            >
              Search
            </button>
          </form>
          <div className="w-full text-sm sm:w-[calc(8ch+3rem)]">
            <label htmlFor="recipe-drafts-category" className="sr-only">Category</label>
            <select
              id="recipe-drafts-category"
              disabled={draftActionPending}
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
              disabled={draftActionPending}
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
            disabled={draftActionPending}
            onClick={() => {
              setCategoryFilter('')
              setSearchInput('')
              setSearch('')
              setIssueFilter('')
              setPage(1)
            }}
            className="h-10 rounded-lg border border-primary bg-primary px-3 py-2 text-xs font-medium text-white hover:bg-primary/90"
          >
            Reset filters
          </button>
          {isSuperadmin && (
            <button
              type="button"
              disabled={loading || draftActionPending}
              onClick={() => { void recheckAllDrafts() }}
              className="h-10 rounded-lg border border-primary px-4 py-2 text-xs font-semibold text-primary hover:bg-primary-soft disabled:cursor-not-allowed disabled:opacity-60"
            >
              {recheckingAll ? 'Checking all issues...' : 'Recheck all issues'}
            </button>
          )}
          <button
            type="button"
            disabled={draftActionPending}
            onClick={() => navigate(`${workspacePath}/menu-create`)}
            className="h-10 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary/90"
          >
            + Create new recipe
          </button>
        </div>
        {recheckMessage ? <p role="status" className="px-5 pb-4 text-sm text-primary">{recheckMessage}</p> : null}
        {error ? <p className="p-5 text-sm text-danger">{error}</p> : null}
        <TablePagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          loading={loading || draftActionPending}
          summary={loading ? 'Loading drafts...' : drafts.length === 0
            ? 'Showing 0 drafts'
            : `Showing ${startIndex + 1}-${startIndex + drafts.length} of ${total} drafts`}
          className="border-b border-border px-5 py-4"
        />
        <div className="overflow-x-auto">
          <table className="dm-table min-w-full bg-white text-sm">
            <thead className="bg-background">
              <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                <th className="w-[48px] px-2 py-3 text-center font-semibold">No</th>
                <th className="px-4 py-3 font-semibold">Recipe Code</th>
                <th className="px-4 py-3 font-semibold">Recipe Name</th>
                <th className="px-4 py-3 font-semibold">Category</th>
                {isSuperadmin && <th className="px-4 py-3 font-semibold">Owner</th>}
                {isSuperadmin && <th className="px-4 py-3 font-semibold">Site</th>}
                <th className="px-4 py-3 font-semibold">Ingredients</th>
                <th className="px-4 py-3 font-semibold">Issues</th>
                <th className="px-4 py-3 font-semibold">Last Updated</th>
                <th className="px-4 py-3 font-semibold">Action</th>
              </tr>
            </thead>
            <LoadingTableBody
              key={JSON.stringify([page, search, categoryFilter, issueFilter])}
              loading={loading}
              columns={columnCount}
              rowCount={drafts.length}
              label="Loading recipe drafts..."
              error={error}
              onRetry={() => { void fetchDrafts() }}
            >
              {drafts.length === 0 ? (
                <tr>
                  <td colSpan={columnCount} className="px-5 py-10 text-center text-muted">
                    {total ? 'No recipe drafts on this page.' : categoryFilter || issueFilter ? 'No recipe drafts match the selected filters.' : 'No recipe drafts yet.'}
                  </td>
                </tr>
              ) : (
                drafts.map((draft, index) => (
                  <tr key={draft.id ?? draft._id} className="border-t border-border">
                    <td className="px-2 py-3 text-center text-muted">{startIndex + index + 1}</td>
                    <td className="px-4 py-3 text-muted">{draft.recipeCode ?? '-'}</td>
                    <td className="px-4 py-3 font-medium text-foreground">
                      {draft.name}
                    </td>
                    <td className="px-4 py-3">{draft.category}</td>
                    {isSuperadmin && <td className="px-4 py-3">{draft.createdByName || draft.createdByEmail || draft.createdBy || '-'}</td>}
                    {isSuperadmin && <td className="px-4 py-3">{draft.siteName || draft.site || '-'}</td>}
                    <td className="px-4 py-3">{draft.ingredientsCount}</td>
                    <td className="px-4 py-3">
                      {draft.importIssues?.length ? (
                        <details className="whitespace-normal text-xs text-amber-700">
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
                    <td className="px-4 py-3 text-muted">{formatUpdatedAt(draft.updatedAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={draftActionPending}
                          onClick={() => { void continueDraft(draft) }}
                          className="rounded-md border border-primary px-3 py-2 text-xs font-semibold text-primary hover:bg-primary-soft disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {openingId === (draft.id ?? draft._id) ? 'Loading...' : 'Continue'}
                        </button>
                        {draft.importIssues !== undefined && (
                          <button
                            type="button"
                            disabled={draftActionPending}
                            onClick={() => { void recheckDraft(draft) }}
                            aria-label={`Recheck draft ${draft.name}`}
                            className="rounded-md border border-primary px-3 py-2 text-xs font-semibold text-primary hover:bg-primary-soft disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {recheckingId === (draft.id ?? draft._id) ? 'Checking...' : 'Recheck'}
                          </button>
                        )}
                        <button type="button" disabled={draftActionPending}
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
            </LoadingTableBody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default ChefRecipeDrafts
