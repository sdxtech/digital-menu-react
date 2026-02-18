import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'

type SuperadminUserApi = {
  id?: string
  _id?: string
  name?: string
  email?: string
  roles?: string[]
  isActive?: boolean
  createdAt?: string
}

type SuperadminUser = {
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
  const [editForm, setEditForm] = useState({ name: '', email: '' })
  const [editError, setEditError] = useState('')
  const [passwordId, setPasswordId] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [deleteError, setDeleteError] = useState('')
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
        `/superadmin/users/${editingId}`,
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

  return (
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
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => startEdit(item)}
                              className="rounded-full border border-border bg-background p-2 text-muted transition hover:bg-primary-soft hover:text-primary"
                              aria-label="Edit user"
                              title="Edit user"
                            >
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.6"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="h-4 w-4"
                                aria-hidden="true"
                              >
                                <path d="M12 20h9" />
                                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                              </svg>
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
                                <svg
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.6"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  className="h-4 w-4"
                                  aria-hidden="true"
                                >
                                  <rect x="5" y="10" width="14" height="10" rx="2" />
                                  <path d="M8 10V7a4 4 0 1 1 8 0v3" />
                                </svg>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => deleteUser(item.id, item.email)}
                              className="rounded-full border border-border bg-background p-2 text-danger transition hover:bg-danger/10"
                              aria-label="Delete user"
                              title="Delete user"
                            >
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.6"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="h-4 w-4"
                                aria-hidden="true"
                              >
                                <path d="M3 6h18" />
                                <path d="M8 6V4h8v2" />
                                <path d="M6 6l1 14h10l1-14" />
                                <path d="M10 11v6" />
                                <path d="M14 11v6" />
                              </svg>
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
  )
}

export default SuperadminUsersPage
