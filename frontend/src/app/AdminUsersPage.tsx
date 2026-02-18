import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'

type AdminUserApi = {
  id?: string
  _id?: string
  name?: string
  email?: string
  roles?: string[]
  isActive?: boolean
  createdAt?: string
}

type AdminUser = {
  id: string
  name: string
  email: string
  roles: string[]
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

const AdminUsersPage = () => {
  const { user, accessToken, logout } = useAuth()
  const navigate = useNavigate()
  const [users, setUsers] = useState<AdminUser[]>([])
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
  const [editForm, setEditForm] = useState({ name: '', email: '' })
  const [editError, setEditError] = useState('')
  const [passwordId, setPasswordId] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [message, setMessage] = useState('')

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
          items: AdminUserApi[]
          total: number
          page: number
          limit: number
          totalPages?: number
        }>(`/admin/users?${params.toString()}`, undefined, accessToken)

        const mapped = (data.items ?? []).map((item) => ({
          id: item.id ?? item._id ?? '',
          name: item.name ?? '',
          email: item.email ?? '',
          roles: item.roles ?? [],
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

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  const startEdit = (target: AdminUser) => {
    setEditingId(target.id)
    setEditForm({ name: target.name, email: target.email })
    setEditError('')
    setMessage('')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditError('')
  }

  const handleEditChange = (field: 'name' | 'email', value: string) => {
    setEditForm((prev) => ({ ...prev, [field]: value }))
  }

  const saveEdit = async () => {
    if (!editingId) return
    const nextName = editForm.name.trim()
    const nextEmail = editForm.email.trim()
    if (!nextName || !nextEmail) {
      setEditError('Please complete name and email before saving.')
      return
    }

    try {
      await apiFetch(
        `/admin/users/${editingId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ name: nextName, email: nextEmail }),
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
        `/admin/users/${passwordId}/password`,
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

  const applySearch = () => {
    setSearch(searchInput.trim())
    setMeta((prev) => ({ ...prev, page: 1 }))
  }

  const resetSearch = () => {
    setSearchInput('')
    setSearch('')
    setMeta((prev) => ({ ...prev, page: 1 }))
  }

  return (
    <AppShell>
      <div className="min-h-screen">
        <header className="sticky top-0 z-30 w-full bg-primary text-white shadow-lg">
          <div className="flex w-full items-center justify-between gap-4 py-2">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-white">
                DM
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-white/70">
                  Admin Workspace
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-medium text-white">
                {user?.email ?? 'admin@brand.com'}
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-2xl border border-white/30 bg-white/10 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/20"
              >
                Logout
              </button>
            </div>
          </div>
        </header>

        <div className="w-full py-2">
          <div className="space-y-6">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-muted">
                User Management
              </p>
              <h2 className="mt-2 text-2xl font-semibold">Manage users</h2>
              <p className="mt-1 text-sm text-muted">
                Update names, emails, and passwords for your team.
              </p>
            </div>

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
                <button
                  type="button"
                  onClick={() => fetchUsers(meta.page, meta.limit, search)}
                  className="rounded-2xl border border-border bg-background px-4 py-2 text-xs font-semibold text-primary"
                >
                  Refresh
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-background">
                    <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                      <th className="w-16 px-5 py-4 font-semibold">No</th>
                      <th className="px-5 py-4 font-semibold">Name</th>
                      <th className="px-5 py-4 font-semibold">Email</th>
                      <th className="px-5 py-4 font-semibold">Roles</th>
                      <th className="px-5 py-4 font-semibold">Status</th>
                      <th className="px-5 py-4 font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {meta.loading ? (
                      <tr className="border-t border-border">
                        <td colSpan={6} className="px-5 py-10 text-center text-muted">
                          Loading users...
                        </td>
                      </tr>
                    ) : users.length === 0 ? (
                      <tr className="border-t border-border">
                        <td colSpan={6} className="px-5 py-10 text-center text-muted">
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
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => startEdit(item)}
                                  className="rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold text-primary"
                                >
                                  Edit
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
                                    className="rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold text-primary"
                                  >
                                    Change password
                                  </button>
                                )}
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
              {message ? (
                <p className="px-5 pb-2 text-xs font-medium text-primary">
                  {message}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-white px-5 py-4 text-xs">
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
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  )
}

export default AdminUsersPage
