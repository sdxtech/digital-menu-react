import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'

type SuperadminUserApi = {
  id?: string
  _id?: string
  name?: string
  email?: string
  roles?: string[]
  sites?: string[]
  isActive?: boolean
  createdAt?: string
}

type SuperadminUser = {
  id: string
  name: string
  email: string
  roles: string[]
  sites: string[]
  isActive: boolean
  createdAt: string
}

type UsersMeta = {
  page: number
  limit: number
  total: number
  totalPages: number
  loading: boolean
  error: string
}

const DEFAULT_LIMIT = 10

const SuperadminUsersPage = () => {
  const { accessToken } = useAuth()
  const [users, setUsers] = useState<SuperadminUser[]>([])
  const [meta, setMeta] = useState<UsersMeta>({
    page: 1,
    limit: DEFAULT_LIMIT,
    total: 0,
    totalPages: 1,
    loading: false,
    error: '',
  })
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ name: '', email: '', sites: '' })
  const [editError, setEditError] = useState('')
  const [passwordId, setPasswordId] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [message, setMessage] = useState('')
  const [importError, setImportError] = useState('')
  const [importMessage, setImportMessage] = useState('')
  const [importing, setImporting] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'chef',
    sites: '',
  })
  const [createError, setCreateError] = useState('')

  const fetchUsers = useCallback(
    async (page = 1, limit = DEFAULT_LIMIT, searchValue = '') => {
      if (!accessToken) {
        setMeta((prev) => ({
          ...prev,
          loading: false,
          error: 'Please log in first to load users.',
        }))
        return
      }

      setMeta((prev) => ({ ...prev, loading: true, error: '' }))
      try {
        const params = new URLSearchParams()
        params.set('page', String(page))
        params.set('limit', String(limit))
        if (searchValue.trim()) {
          params.set('search', searchValue.trim())
        }

        const data = await apiFetch<{
          items: SuperadminUserApi[]
          total: number
          page: number
          limit: number
          totalPages?: number
        }>(`/superadmin/users?${params.toString()}`, undefined, accessToken)

        const mapped = (data.items ?? []).map((item) => ({
          id: item.id ?? item._id ?? '',
          name: item.name ?? '',
          email: item.email ?? '',
          roles: item.roles ?? [],
          sites: item.sites ?? [],
          isActive: item.isActive ?? true,
          createdAt: item.createdAt ?? '',
        }))

        setUsers(mapped)
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
          error instanceof Error ? error.message : 'Failed to load users.'
        setMeta((prev) => ({
          ...prev,
          loading: false,
          error: messageText,
        }))
      }
    },
    [accessToken],
  )

  useEffect(() => {
    fetchUsers(1, DEFAULT_LIMIT, search).catch(() => null)
  }, [fetchUsers, search])

  const startEdit = (target: SuperadminUser) => {
    setEditingId(target.id)
    setEditForm({
      name: target.name,
      email: target.email,
      sites: target.sites.join(', '),
    })
    setEditError('')
    setMessage('')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditError('')
  }

  const handleEditChange = (field: 'name' | 'email' | 'sites', value: string) => {
    setEditForm((prev) => ({ ...prev, [field]: value }))
  }

  const saveEdit = async () => {
    if (!editingId) return
    const nextName = editForm.name.trim()
    const nextEmail = editForm.email.trim()
    const nextSites = editForm.sites
      .split(',')
      .map((site) => site.trim())
      .filter(Boolean)
    if (!nextName || !nextEmail) {
      setEditError('Please complete name and email before saving.')
      return
    }

    try {
      await apiFetch(
        `/superadmin/users/${editingId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            name: nextName,
            email: nextEmail,
            sites: nextSites,
          }),
        },
        accessToken ?? undefined,
      )
      setEditingId(null)
      setMessage('User updated.')
      setEditError('')
      fetchUsers(meta.page, meta.limit, search).catch(() => null)
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : 'Failed to update user.'
      setEditError(messageText)
    }
  }

  const openPasswordEditor = (id: string) => {
    setPasswordId(id)
    setPassword('')
    setPasswordError('')
    setMessage('')
  }

  const cancelPassword = () => {
    setPasswordId(null)
    setPassword('')
    setPasswordError('')
  }

  const savePassword = async () => {
    if (!passwordId) return
    const nextPassword = password.trim()
    if (nextPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters.')
      return
    }

    try {
      await apiFetch(
        `/superadmin/users/${passwordId}/password`,
        {
          method: 'PATCH',
          body: JSON.stringify({ password: nextPassword }),
        },
        accessToken ?? undefined,
      )
      setPasswordId(null)
      setPassword('')
      setMessage('Password updated.')
      setPasswordError('')
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : 'Failed to update password.'
      setPasswordError(messageText)
    }
  }

  const deleteUser = async (id: string, email: string) => {
    if (!accessToken) return
    const ok = window.confirm(`Delete ${email}?`)
    if (!ok) return

    setDeleteError('')
    setMessage('')
    try {
      await apiFetch(
        `/superadmin/users/${id}`,
        { method: 'DELETE' },
        accessToken,
      )
      setEditingId(null)
      setPasswordId(null)
      setMessage('User deleted.')
      fetchUsers(meta.page, meta.limit, search).catch(() => null)
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : 'Failed to delete user.'
      setDeleteError(messageText)
    }
  }

  const applySearch = () => {
    setSearch(searchInput.trim())
    setMeta((prev) => ({ ...prev, page: 1 }))
  }

  const resetSearch = () => {
    setSearchInput('')
    setSearch('')
    setMeta((prev) => ({ ...prev, page: 1 }))
  }

  const openCreateModal = () => {
    setCreateError('')
    setCreateForm({
      name: '',
      email: '',
      password: '',
      role: 'chef',
      sites: '',
    })
    setCreateOpen(true)
  }

  const closeCreateModal = () => {
    setCreateOpen(false)
  }

  const handleCreateChange = (
    field: 'name' | 'email' | 'password' | 'role' | 'sites',
    value: string,
  ) => {
    setCreateForm((prev) => ({ ...prev, [field]: value }))
  }

  const saveCreate = async () => {
    if (!accessToken) return
    const name = createForm.name.trim()
    const email = createForm.email.trim()
    const password = createForm.password.trim()
    const role = createForm.role.trim()
    const sites = createForm.sites
      .split(',')
      .map((site) => site.trim())
      .filter(Boolean)

    if (!name || !email || !password) {
      setCreateError('Please complete name, email, and password.')
      return
    }
    if (password.length < 6) {
      setCreateError('Password must be at least 6 characters.')
      return
    }

    try {
      await apiFetch(
        '/superadmin/users',
        {
          method: 'POST',
          body: JSON.stringify({
            name,
            email,
            password,
            roles: role ? [role] : undefined,
            sites,
          }),
        },
        accessToken,
      )
      setCreateOpen(false)
      setMessage('User created.')
      setCreateError('')
      fetchUsers(meta.page, meta.limit, search).catch(() => null)
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : 'Failed to create user.'
      setCreateError(messageText)
    }
  }

  const openImportModal = () => {
    setImportError('')
    setImportMessage('')
    setImportOpen(true)
  }

  const handleImportFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] ?? null
    event.target.value = ''
    if (!nextFile) return

    const isExcelFile = /\.(xlsx|xls)$/i.test(nextFile.name)
    if (!isExcelFile) {
      setImportError('File must be .xlsx or .xls')
      setImportMessage('')
      return
    }

    if (!accessToken) {
      setImportError('Please log in first to import users.')
      setImportMessage('')
      return
    }

    setImporting(true)
    setImportError('')
    setImportMessage('')
    setMessage('')

    try {
      const formData = new FormData()
      formData.append('file', nextFile)

      const result = await apiFetch<{
        insertedCount: number
        skippedCount?: number
      }>(
        '/superadmin/users/import',
        {
          method: 'POST',
          body: formData,
        },
        accessToken,
      )

      const skipped = result.skippedCount ?? 0
      setImportMessage(
        `${result.insertedCount} users imported${skipped ? `, ${skipped} skipped` : ''}.`,
      )
      fetchUsers(meta.page, meta.limit, search).catch(() => null)
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : 'Failed to import users.'
      setImportError(messageText)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="w-full py-2">
      <div className="space-y-6">
        <div className="space-y-2">
          <div>
            <h1 className="text-2xl font-semibold">User Management</h1>
            <p className="mt-1 text-sm text-muted">
              Update names, emails, and passwords for your team.
            </p>
          </div>

          {createOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div
                className="w-full max-w-xl rounded-3xl border border-border bg-surface p-6 shadow-xl"
                role="dialog"
                aria-modal="true"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-muted">
                      Create account
                    </p>
                    <h3 className="mt-2 text-lg font-semibold">New user</h3>
                    <p className="mt-2 text-sm text-muted">
                      Add a new user and assign their role.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeCreateModal}
                    className="rounded-2xl border border-border bg-background px-3 py-2 text-xs font-semibold text-primary"
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
                        handleCreateChange('name', event.target.value)
                      }
                      className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-2 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-foreground">
                      Email
                    </label>
                    <input
                      type="email"
                      value={createForm.email}
                      onChange={(event) =>
                        handleCreateChange('email', event.target.value)
                      }
                      className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-2 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-foreground">
                      Password
                    </label>
                    <input
                      type="password"
                      value={createForm.password}
                      onChange={(event) =>
                        handleCreateChange('password', event.target.value)
                      }
                      className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-2 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="text-sm font-medium text-foreground">
                        Role
                      </label>
                      <select
                        value={createForm.role}
                        onChange={(event) =>
                          handleCreateChange('role', event.target.value)
                        }
                        className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-2 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                      >
                        <option value="chef">chef</option>
                        <option value="unit-manager">unit-manager</option>
                        <option value="storekeeper">storekeeper</option>
                        <option value="superadmin">superadmin</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-foreground">
                        Sites
                      </label>
                      <input
                        type="text"
                        value={createForm.sites}
                        onChange={(event) =>
                          handleCreateChange('sites', event.target.value)
                        }
                        placeholder="e.g. Jakarta, Bandung"
                        className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-2 text-sm shadow-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                      />
                    </div>
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
                      className="flex-1 rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-white"
                    >
                      Create user
                    </button>
                    <button
                      type="button"
                      onClick={closeCreateModal}
                      className="rounded-2xl border border-border bg-background px-4 py-3 text-sm font-semibold text-primary"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {importOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div
                className="w-full max-w-xl rounded-3xl border border-border bg-surface p-6 shadow-xl"
                role="dialog"
                aria-modal="true"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-muted">
                      Import accounts
                    </p>
                    <h3 className="mt-2 text-lg font-semibold">
                      Upload Excel file
                    </h3>
                    <p className="mt-2 text-sm text-muted">
                      Import multiple user accounts at once using .xlsx or .xls.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setImportOpen(false)}
                    disabled={importing}
                    className="rounded-2xl border border-border bg-background px-3 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Close
                  </button>
                </div>

                <div className="mt-4 rounded-2xl border border-border bg-background p-4 text-sm text-muted">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted">
                    Required columns
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    <li>name</li>
                    <li>email</li>
                    <li>password</li>
                    <li>roles</li>
                  </ul>
                  <p className="mt-3 text-xs text-muted">
                    roles: superadmin, chef, unit-manager, storekeeper. You can
                    separate multiple roles with commas.
                  </p>
                </div>

                <div className="mt-4">
                  <label className="text-sm font-medium text-foreground">
                    File Excel
                  </label>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleImportFileChange}
                    disabled={importing}
                    className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-2 text-sm shadow-sm file:mr-4 file:rounded-xl file:border-0 file:bg-primary-soft file:px-3 file:py-2 file:text-xs file:font-semibold file:text-primary disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  {importing ? (
                    <p className="mt-2 text-xs text-muted">Importing...</p>
                  ) : null}
                  {importError ? (
                    <p className="mt-2 text-xs font-medium text-red-600">
                      {importError}
                    </p>
                  ) : null}
                  {importMessage ? (
                    <p className="mt-2 text-xs font-medium text-primary">
                      {importMessage}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          <div className="rounded-3xl border border-border bg-surface shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search by name or email"
                className="w-56 rounded-2xl border border-border bg-white px-4 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
              />
              <button
                type="button"
                onClick={applySearch}
                className="rounded-2xl bg-primary px-4 py-2 text-xs font-semibold text-white"
              >
                Search
              </button>
              <button
                type="button"
                onClick={resetSearch}
                className="rounded-2xl border border-border bg-background px-4 py-2 text-xs font-semibold text-primary"
              >
                Reset
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={openCreateModal}
                className="rounded-2xl border border-border bg-background px-4 py-2 text-xs font-semibold text-primary"
              >
                <span className="flex items-center gap-2">
                  <i className="bi bi-person-plus text-base" aria-hidden="true" />
                  <span>Create user</span>
                </span>
              </button>
              <button
                type="button"
                onClick={openImportModal}
                className="rounded-2xl bg-primary px-4 py-2 text-xs font-semibold text-white shadow-sm"
              >
                <span className="flex items-center gap-2">
                  <i className="bi bi-upload text-base" aria-hidden="true" />
                  <span>Import accounts</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => fetchUsers(meta.page, meta.limit, search)}
                aria-label="Refresh users"
                title="Refresh users"
                className="rounded-2xl border border-border bg-background p-2 text-primary"
              >
                <i
                  className="bi bi-arrow-clockwise text-base"
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-white px-5 py-4 text-xs">
            <span className="text-muted">
              Showing {users.length} of {meta.total} users
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fetchUsers(meta.page - 1, meta.limit, search)}
                disabled={meta.page <= 1 || meta.loading}
                className="rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                Prev
              </button>
              <span className="text-xs font-semibold text-foreground">
                Page {meta.page} / {meta.totalPages}
              </span>
              <button
                type="button"
                onClick={() => fetchUsers(meta.page + 1, meta.limit, search)}
                disabled={meta.page >= meta.totalPages || meta.loading}
                className="rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                Next
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-background">
                <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                  <th className="w-16 px-5 py-4 font-semibold">No</th>
                  <th className="px-5 py-4 font-semibold">Name</th>
                  <th className="px-5 py-4 font-semibold">Email</th>
                  <th className="px-5 py-4 font-semibold">Roles</th>
                  <th className="px-5 py-4 font-semibold">Sites</th>
                  <th className="px-5 py-4 font-semibold">Status</th>
                  <th className="px-5 py-4 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {meta.loading ? (
                  <tr className="border-t border-border">
                    <td colSpan={7} className="px-5 py-10 text-center text-muted">
                      Loading users...
                    </td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr className="border-t border-border">
                    <td colSpan={7} className="px-5 py-10 text-center text-muted">
                      {meta.error ? meta.error : 'No users found.'}
                    </td>
                  </tr>
                ) : (
                  users.map((item, index) => (
                    <tr key={item.id} className="border-t border-border">
                      <td className="px-5 py-4 text-sm text-muted">
                        {(meta.page - 1) * meta.limit + index + 1}
                      </td>
                      <td className="px-5 py-4">
                        {editingId === item.id ? (
                          <input
                            type="text"
                            value={editForm.name}
                            onChange={(event) =>
                              handleEditChange('name', event.target.value)
                            }
                            className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                          />
                        ) : (
                          item.name
                        )}
                      </td>
                      <td className="px-5 py-4">
                        {editingId === item.id ? (
                          <input
                            type="email"
                            value={editForm.email}
                            onChange={(event) =>
                              handleEditChange('email', event.target.value)
                            }
                            className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                          />
                        ) : (
                          item.email
                        )}
                      </td>
                      <td className="px-5 py-4">
                        {item.roles.length ? item.roles.join(', ') : '-'}
                      </td>
                      <td className="px-5 py-4">
                        {editingId === item.id ? (
                          <input
                            type="text"
                            value={editForm.sites}
                            onChange={(event) =>
                              handleEditChange('sites', event.target.value)
                            }
                            placeholder="e.g. Jakarta, Bandung"
                            className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                          />
                        ) : item.sites.length ? (
                          item.sites.join(', ')
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="px-5 py-4">
                        {item.isActive ? 'Active' : 'Disabled'}
                      </td>
                      <td className="px-5 py-4">
                        {editingId === item.id ? (
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={saveEdit}
                              className="rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-white"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              className="rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold text-primary"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => startEdit(item)}
                              className="rounded-full border border-border bg-background p-2 text-muted transition hover:bg-primary-soft hover:text-primary"
                              aria-label="Edit user"
                              title="Edit user"
                            >
                              <i
                                className="bi bi-pencil-square text-base"
                                aria-hidden="true"
                              />
                            </button>
                            {passwordId === item.id ? (
                              <div className="flex flex-col gap-2">
                                <input
                                  type="password"
                                  value={password}
                                  onChange={(event) =>
                                    setPassword(event.target.value)
                                  }
                                  placeholder="New password"
                                  className="w-40 rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                                />
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={savePassword}
                                    className="rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-white"
                                  >
                                    Update
                                  </button>
                                  <button
                                    type="button"
                                    onClick={cancelPassword}
                                    className="rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold text-primary"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => openPasswordEditor(item.id)}
                                className="rounded-full border border-border bg-background p-2 text-muted transition hover:bg-primary-soft hover:text-primary"
                                aria-label="Change password"
                                title="Change password"
                              >
                                <i className="bi bi-lock text-base" aria-hidden="true" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => deleteUser(item.id, item.email)}
                              className="rounded-full border border-border bg-background p-2 text-danger transition hover:bg-danger/10"
                              aria-label="Delete user"
                              title="Delete user"
                            >
                              <i
                                className="bi bi-trash text-base"
                                aria-hidden="true"
                              />
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
          {passwordError ? (
            <p className="px-5 pb-2 text-xs font-medium text-red-600">
              {passwordError}
            </p>
          ) : null}
          {deleteError ? (
            <p className="px-5 pb-2 text-xs font-medium text-red-600">
              {deleteError}
            </p>
          ) : null}
          {importError ? (
            <p className="px-5 pb-2 text-xs font-medium text-red-600">
              {importError}
            </p>
          ) : null}
          {message ? (
            <p className="px-5 pb-2 text-xs font-medium text-primary">
              {message}
            </p>
          ) : null}
          {importMessage ? (
            <p className="px-5 pb-2 text-xs font-medium text-primary">
              {importMessage}
            </p>
          ) : null}
        </div>
      </div>
      </div>
    </div>
  )
}

export default SuperadminUsersPage
