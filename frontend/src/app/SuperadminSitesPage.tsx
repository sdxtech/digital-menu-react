import { useCallback, useEffect, useState } from 'react'
import TablePagination from '../components/TablePagination'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'

type SiteApi = {
  id?: string
  _id?: string
  name?: string
  code?: string
  description?: string
  isActive?: boolean
  createdAt?: string
}

type Site = {
  id: string
  name: string
  code: string
  description: string
  isActive: boolean
  createdAt: string
}

type SiteMeta = {
  page: number
  limit: number
  total: number
  totalPages: number
  loading: boolean
  error: string
}

type SiteForm = {
  name: string
  code: string
  description: string
  isActive: boolean
}

type StatusFilter = 'all' | 'active' | 'disabled'

const DEFAULT_LIMIT = 10

const emptyForm: SiteForm = {
  name: '',
  code: '',
  description: '',
  isActive: true,
}

const mapSite = (item: SiteApi): Site => ({
  id: item.id ?? item._id ?? '',
  name: item.name ?? '',
  code: item.code ?? '',
  description: item.description ?? '',
  isActive: item.isActive ?? true,
  createdAt: item.createdAt ?? '',
})

const SuperadminSitesPage = () => {
  const { accessToken } = useAuth()
  const [sites, setSites] = useState<Site[]>([])
  const [meta, setMeta] = useState<SiteMeta>({
    page: 1,
    limit: DEFAULT_LIMIT,
    total: 0,
    totalPages: 1,
    loading: false,
    error: '',
  })
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState<SiteForm>(emptyForm)
  const [createError, setCreateError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<SiteForm>(emptyForm)
  const [editError, setEditError] = useState('')
  const [message, setMessage] = useState('')

  const fetchSites = useCallback(
    async (page = 1, limit = DEFAULT_LIMIT, searchValue = search) => {
      if (!accessToken) {
        setMeta((prev) => ({
          ...prev,
          loading: false,
          error: 'Please log in first to load sites.',
        }))
        return
      }

      setMeta((prev) => ({ ...prev, loading: true, error: '' }))
      try {
        const params = new URLSearchParams()
        params.set('page', String(page))
        params.set('limit', String(limit))
        if (searchValue.trim()) params.set('search', searchValue.trim())
        if (statusFilter === 'active') params.set('isActive', 'true')
        if (statusFilter === 'disabled') params.set('isActive', 'false')

        const data = await apiFetch<{
          items: SiteApi[]
          total: number
          page: number
          limit: number
          totalPages?: number
        }>(`/superadmin/sites?${params.toString()}`, undefined, accessToken)

        const mapped = (data.items ?? []).map(mapSite).filter((site) => site.id)
        setSites(mapped)
        setMeta({
          page: data.page ?? page,
          limit: data.limit ?? limit,
          total: data.total ?? 0,
          totalPages:
            data.totalPages ??
            Math.max(1, Math.ceil((data.total ?? 0) / limit)),
          loading: false,
          error: '',
        })
      } catch (error) {
        const messageText =
          error instanceof Error ? error.message : 'Failed to load sites.'
        setMeta((prev) => ({
          ...prev,
          loading: false,
          error: messageText,
        }))
      }
    },
    [accessToken, search, statusFilter],
  )

  useEffect(() => {
    fetchSites(1, DEFAULT_LIMIT, search).catch(() => null)
  }, [fetchSites, search])

  const applySearch = () => {
    setSearch(searchInput.trim())
    setMeta((prev) => ({ ...prev, page: 1 }))
  }

  const openCreateModal = () => {
    setCreateForm(emptyForm)
    setCreateError('')
    setMessage('')
    setCreateOpen(true)
  }

  const closeCreateModal = () => {
    setCreateOpen(false)
  }

  const updateCreateForm = (field: keyof SiteForm, value: string | boolean) => {
    setCreateForm((prev) => ({ ...prev, [field]: value }))
  }

  const updateEditForm = (field: keyof SiteForm, value: string | boolean) => {
    setEditForm((prev) => ({ ...prev, [field]: value }))
  }

  const saveCreate = async () => {
    if (!accessToken) return
    const name = createForm.name.trim()
    const code = createForm.code.trim()
    const description = createForm.description.trim()

    if (!name || !code) {
      setCreateError('Please complete site name and code.')
      return
    }

    try {
      await apiFetch(
        '/superadmin/sites',
        {
          method: 'POST',
          body: JSON.stringify({
            name,
            code,
            description: description || undefined,
            isActive: createForm.isActive,
          }),
        },
        accessToken,
      )
      setCreateOpen(false)
      setMessage('Site created.')
      setCreateError('')
      fetchSites(1, meta.limit, search).catch(() => null)
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : 'Failed to create site.'
      setCreateError(messageText)
    }
  }

  const startEdit = (site: Site) => {
    setEditingId(site.id)
    setEditForm({
      name: site.name,
      code: site.code,
      description: site.description,
      isActive: site.isActive,
    })
    setEditError('')
    setMessage('')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditError('')
  }

  const saveEdit = async () => {
    if (!accessToken || !editingId) return
    const name = editForm.name.trim()
    const code = editForm.code.trim()
    const description = editForm.description.trim()
    if (!name || !code) {
      setEditError('Please complete site name and code.')
      return
    }

    try {
      await apiFetch(
        `/superadmin/sites/${editingId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            name,
            code,
            description,
            isActive: editForm.isActive,
          }),
        },
        accessToken,
      )
      setEditingId(null)
      setEditError('')
      setMessage('Site updated.')
      fetchSites(meta.page, meta.limit, search).catch(() => null)
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : 'Failed to update site.'
      setEditError(messageText)
    }
  }

  const toggleStatus = async (site: Site) => {
    if (!accessToken) return
    const nextActive = !site.isActive
    try {
      await apiFetch(
        `/superadmin/sites/${site.id}/status`,
        {
          method: 'PATCH',
          body: JSON.stringify({ isActive: nextActive }),
        },
        accessToken,
      )
      setMessage(nextActive ? 'Site activated.' : 'Site disabled.')
      fetchSites(meta.page, meta.limit, search).catch(() => null)
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : 'Failed to update site status.'
      setEditError(messageText)
    }
  }

  return (
    <div className="w-full py-2">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Site Management</h1>
          <p className="mt-1 text-sm text-muted">
            Manage branches and assignable workspaces for operational users.
          </p>
        </div>

        {createOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div
              className="w-full max-w-xl rounded-md border border-border bg-surface p-6 shadow-xl"
              role="dialog"
              aria-modal="true"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-foreground">Create site</h3>
                  <p className="mt-1 text-xs text-muted">New workspace</p>
                </div>
                <button
                  type="button"
                  onClick={closeCreateModal}
                  className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-primary"
                >
                  Close
                </button>
              </div>

              <div className="mt-5 space-y-4">
                <div>
                  <label className="text-sm font-medium text-foreground">
                    Name
                  </label>
                  <input
                    type="text"
                    value={createForm.name}
                    onChange={(event) =>
                      updateCreateForm('name', event.target.value)
                    }
                    className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-2 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">
                    Code
                  </label>
                  <input
                    type="text"
                    value={createForm.code}
                    onChange={(event) =>
                      updateCreateForm('code', event.target.value)
                    }
                    placeholder="e.g. SITE-001"
                    className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-2 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">
                    Description
                  </label>
                  <textarea
                    value={createForm.description}
                    onChange={(event) =>
                      updateCreateForm('description', event.target.value)
                    }
                    rows={3}
                    className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-2 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                  />
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={createForm.isActive}
                    onChange={(event) =>
                      updateCreateForm('isActive', event.target.checked)
                    }
                    className="h-4 w-4 rounded border-border text-primary focus:ring-accent-blue"
                  />
                  Active
                </label>
                {createError ? (
                  <p className="text-xs font-medium text-red-600">
                    {createError}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={saveCreate}
                    className="flex-1 rounded-md bg-primary px-4 py-3 text-sm font-semibold text-white"
                  >
                    Create site
                  </button>
                  <button
                    type="button"
                    onClick={closeCreateModal}
                    className="rounded-md border border-border bg-background px-4 py-3 text-sm font-semibold text-primary"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="rounded-md border border-border bg-surface shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search by name, code, or description"
                className="w-72 rounded-2xl border border-border bg-white px-4 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
              />
              <button
                type="button"
                onClick={applySearch}
                className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white"
              >
                Search
              </button>
              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as StatusFilter)
                }
                className="rounded-2xl border border-border bg-white px-4 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
              >
                <option value="all">All status</option>
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={openCreateModal}
                className="rounded-md border border-border bg-background px-4 py-2 text-xs font-semibold text-primary"
              >
                <span className="flex items-center gap-2">
                  <i className="bi bi-building-add text-base" aria-hidden="true" />
                  <span>Create site</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => fetchSites(meta.page, meta.limit, search)}
                aria-label="Refresh sites"
                title="Refresh sites"
                className="rounded-md border border-border bg-background p-2 text-primary"
              >
                <i className="bi bi-arrow-clockwise text-base" aria-hidden="true" />
              </button>
            </div>
          </div>

          <TablePagination
            page={meta.page}
            totalPages={meta.totalPages}
            loading={meta.loading}
            summary={`Showing ${sites.length} of ${meta.total} sites`}
            onPageChange={(page) => fetchSites(page, meta.limit, search)}
            className="rounded-t-md border-b border-border bg-white px-5 py-4"
          />

          <div className="max-w-full overflow-x-auto">
            <table className="dm-table min-w-full text-sm">
              <thead className="bg-background">
                <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                  <th className="w-16 px-5 py-4 font-semibold">No</th>
                  <th className="px-5 py-4 font-semibold">Name</th>
                  <th className="px-5 py-4 font-semibold">Code</th>
                  <th className="px-5 py-4 font-semibold">Description</th>
                  <th className="px-5 py-4 font-semibold">Status</th>
                  <th className="px-5 py-4 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {meta.loading ? (
                  <tr className="border-t border-border">
                    <td colSpan={6} className="px-5 py-10 text-center text-muted">
                      Loading sites...
                    </td>
                  </tr>
                ) : sites.length === 0 ? (
                  <tr className="border-t border-border">
                    <td colSpan={6} className="px-5 py-10 text-center text-muted">
                      {meta.error ? meta.error : 'No sites found.'}
                    </td>
                  </tr>
                ) : (
                  sites.map((site, index) => (
                    <tr key={site.id} className="border-t border-border">
                      <td className="px-5 py-4 text-sm text-muted">
                        {(meta.page - 1) * meta.limit + index + 1}
                      </td>
                      <td className="px-5 py-4">
                        {editingId === site.id ? (
                          <input
                            type="text"
                            value={editForm.name}
                            onChange={(event) =>
                              updateEditForm('name', event.target.value)
                            }
                            className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                          />
                        ) : (
                          site.name
                        )}
                      </td>
                      <td className="px-5 py-4">
                        {editingId === site.id ? (
                          <input
                            type="text"
                            value={editForm.code}
                            onChange={(event) =>
                              updateEditForm('code', event.target.value)
                            }
                            className="w-36 rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                          />
                        ) : (
                          site.code
                        )}
                      </td>
                      <td className="px-5 py-4">
                        {editingId === site.id ? (
                          <input
                            type="text"
                            value={editForm.description}
                            onChange={(event) =>
                              updateEditForm('description', event.target.value)
                            }
                            className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                          />
                        ) : site.description ? (
                          site.description
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="px-5 py-4">
                        {editingId === site.id ? (
                          <select
                            value={editForm.isActive ? 'active' : 'disabled'}
                            onChange={(event) =>
                              updateEditForm(
                                'isActive',
                                event.target.value === 'active',
                              )
                            }
                            className="rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                          >
                            <option value="active">Active</option>
                            <option value="disabled">Disabled</option>
                          </select>
                        ) : site.isActive ? (
                          'Active'
                        ) : (
                          'Disabled'
                        )}
                      </td>
                      <td className="px-5 py-4">
                        {editingId === site.id ? (
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={saveEdit}
                              className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-white"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-primary"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => startEdit(site)}
                              className="rounded-md border border-border bg-background p-2 text-muted transition hover:bg-primary-soft hover:text-primary"
                              aria-label="Edit site"
                              title="Edit site"
                            >
                              <i className="bi bi-pencil-square text-base" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleStatus(site)}
                              className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-primary"
                            >
                              {site.isActive ? 'Disable' : 'Activate'}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {editError ? (
            <p className="px-5 pb-2 text-xs font-medium text-red-600">
              {editError}
            </p>
          ) : null}
          {message ? (
            <p className="px-5 pb-2 text-xs font-medium text-primary">
              {message}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default SuperadminSitesPage
