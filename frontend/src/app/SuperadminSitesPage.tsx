import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'

type SiteApi = {
  id?: string
  _id?: string
  code?: string
  name?: string
  isActive?: boolean
}

type Site = {
  id: string
  code: string
  name: string
  isActive: boolean
}

const SuperadminSitesPage = () => {
  const { accessToken } = useAuth()
  const [sites, setSites] = useState<Site[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({
    code: '',
    name: '',
  })
  const [createError, setCreateError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({
    name: '',
    isActive: true,
  })
  const [editError, setEditError] = useState('')

  const fetchSites = useCallback(
    async (searchValue = '') => {
      if (!accessToken) {
        setSites([])
        setError('Please log in first to load sites.')
        setLoading(false)
        return
      }

      setLoading(true)
      setError('')

      try {
        const params = new URLSearchParams()
        if (searchValue.trim()) {
          params.set('search', searchValue.trim())
        }

        const queryString = params.toString()
        const data = await apiFetch<{ items?: SiteApi[] }>(
          queryString ? `/superadmin/sites?${queryString}` : '/superadmin/sites',
          undefined,
          accessToken,
        )

        setSites(
          (data.items ?? []).map((site) => ({
            id: site.id ?? site._id ?? '',
            code: site.code?.trim().toUpperCase() ?? '',
            name: site.name?.trim() ?? '',
            isActive: site.isActive ?? true,
          })),
        )
      } catch (nextError) {
        setError(
          nextError instanceof Error ? nextError.message : 'Failed to load sites.',
        )
      } finally {
        setLoading(false)
      }
    },
    [accessToken],
  )

  useEffect(() => {
    fetchSites(search).catch(() => null)
  }, [fetchSites, search])

  const applySearch = () => {
    setSearch(searchInput.trim())
  }

  const openCreateModal = () => {
    setCreateError('')
    setCreateForm({
      code: '',
      name: '',
    })
    setCreateOpen(true)
  }

  const closeCreateModal = () => {
    setCreateOpen(false)
  }

  const handleCreateChange = (field: 'code' | 'name', value: string) => {
    setCreateForm((prev) => ({ ...prev, [field]: value }))
  }

  const saveCreate = async () => {
    if (!accessToken) return

    const code = createForm.code.trim().toUpperCase()
    const name = createForm.name.trim()

    if (!code || !name) {
      setCreateError('Please complete site code and site name.')
      return
    }

    try {
      await apiFetch(
        '/superadmin/sites',
        {
          method: 'POST',
          body: JSON.stringify({ code, name }),
        },
        accessToken,
      )

      setCreateOpen(false)
      setCreateError('')
      setMessage('Site created.')
      fetchSites(search).catch(() => null)
    } catch (nextError) {
      setCreateError(
        nextError instanceof Error ? nextError.message : 'Failed to create site.',
      )
    }
  }

  const startEdit = (site: Site) => {
    setEditingId(site.id)
    setEditError('')
    setMessage('')
    setEditForm({
      name: site.name,
      isActive: site.isActive,
    })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditError('')
  }

  const saveEdit = async () => {
    if (!accessToken || !editingId) return

    const name = editForm.name.trim()
    if (!name) {
      setEditError('Site name is required.')
      return
    }

    try {
      await apiFetch(
        `/superadmin/sites/${editingId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            name,
            isActive: editForm.isActive,
          }),
        },
        accessToken,
      )

      setEditingId(null)
      setEditError('')
      setMessage('Site updated.')
      fetchSites(search).catch(() => null)
    } catch (nextError) {
      setEditError(
        nextError instanceof Error ? nextError.message : 'Failed to update site.',
      )
    }
  }

  const toggleStatus = async (site: Site) => {
    if (!accessToken) return

    try {
      await apiFetch(
        `/superadmin/sites/${site.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            isActive: !site.isActive,
          }),
        },
        accessToken,
      )

      setMessage(site.isActive ? 'Site deactivated.' : 'Site activated.')
      fetchSites(search).catch(() => null)
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : 'Failed to update site status.',
      )
    }
  }

  return (
    <div className="w-full py-2">
      <div className="space-y-6">
        <div className="space-y-2">
          <div>
            <h1 className="text-2xl font-semibold">Site Management</h1>
            <p className="mt-1 text-sm text-muted">
              Manage the site master used for user assignments and data scoping.
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
                    <p className="mt-1 text-xs text-muted">New site master data</p>
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
                      Site code
                    </label>
                    <input
                      type="text"
                      value={createForm.code}
                      onChange={(event) =>
                        handleCreateChange('code', event.target.value.toUpperCase())
                      }
                      placeholder="e.g. A1"
                      className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-2 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-foreground">
                      Site name
                    </label>
                    <input
                      type="text"
                      value={createForm.name}
                      onChange={(event) =>
                        handleCreateChange('name', event.target.value)
                      }
                      placeholder="e.g. Jakarta Pusat"
                      className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-2 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                    />
                  </div>
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
                  placeholder="Search by site code or name"
                  className="w-64 rounded-2xl border border-border bg-white px-4 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                />
                <button
                  type="button"
                  onClick={applySearch}
                  className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white"
                >
                  Search
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={openCreateModal}
                  className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white shadow-sm"
                >
                  <span className="flex items-center gap-2">
                    <i className="bi bi-building-add text-base" aria-hidden="true" />
                    <span>Create site</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => fetchSites(search)}
                  aria-label="Refresh sites"
                  title="Refresh sites"
                  className="rounded-md border border-border bg-background p-2 text-primary"
                >
                  <i
                    className="bi bi-arrow-clockwise text-base"
                    aria-hidden="true"
                  />
                </button>
              </div>
            </div>

            <div className="max-w-full overflow-x-auto">
              <table className="dm-table min-w-full text-sm">
                <thead className="bg-background">
                  <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                    <th className="w-16 px-5 py-4 font-semibold">No</th>
                    <th className="px-5 py-4 font-semibold">Code</th>
                    <th className="px-5 py-4 font-semibold">Name</th>
                    <th className="px-5 py-4 font-semibold">Status</th>
                    <th className="px-5 py-4 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr className="border-t border-border">
                      <td colSpan={5} className="px-5 py-10 text-center text-muted">
                        Loading sites...
                      </td>
                    </tr>
                  ) : sites.length === 0 ? (
                    <tr className="border-t border-border">
                      <td colSpan={5} className="px-5 py-10 text-center text-muted">
                        {error ? error : 'No sites found.'}
                      </td>
                    </tr>
                  ) : (
                    sites.map((site, index) => (
                      <tr key={site.id} className="border-t border-border">
                        <td className="px-5 py-4 text-sm text-muted">
                          {index + 1}
                        </td>
                        <td className="px-5 py-4 font-medium">{site.code}</td>
                        <td className="px-5 py-4">
                          {editingId === site.id ? (
                            <input
                              type="text"
                              value={editForm.name}
                              onChange={(event) =>
                                setEditForm((prev) => ({
                                  ...prev,
                                  name: event.target.value,
                                }))
                              }
                              className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                            />
                          ) : (
                            site.name
                          )}
                        </td>
                        <td className="px-5 py-4">
                          {editingId === site.id ? (
                            <label className="inline-flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={editForm.isActive}
                                onChange={(event) =>
                                  setEditForm((prev) => ({
                                    ...prev,
                                    isActive: event.target.checked,
                                  }))
                                }
                                className="h-4 w-4 rounded border-border text-primary focus:ring-accent-blue"
                              />
                              <span>{editForm.isActive ? 'Active' : 'Inactive'}</span>
                            </label>
                          ) : site.isActive ? (
                            'Active'
                          ) : (
                            'Inactive'
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
                                <i
                                  className="bi bi-pencil-square text-base"
                                  aria-hidden="true"
                                />
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleStatus(site)}
                                className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-primary transition hover:bg-primary-soft"
                              >
                                {site.isActive ? 'Deactivate' : 'Activate'}
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
            {error && sites.length > 0 ? (
              <p className="px-5 pb-2 text-xs font-medium text-red-600">
                {error}
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
    </div>
  )
}

export default SuperadminSitesPage
