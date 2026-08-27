import { useCallback, useEffect, useState } from 'react'
import ActionButton from '../components/ActionButton'
import TablePagination from '../components/TablePagination'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'

type GroupByStatusFilter = 'active' | 'disabled'

type GroupByApi = {
  id?: string
  _id?: string
  name?: string
  isActive?: boolean
}

type GroupByOption = {
  id: string
  name: string
  isActive: boolean
}

const DEFAULT_LIMIT = 10

const mapGroupByOption = (item: GroupByApi): GroupByOption => ({
  id: item.id ?? item._id ?? '',
  name: item.name?.trim() ?? '',
  isActive: item.isActive ?? true,
})

const SuperadminGroupByManagement = () => {
  const { accessToken } = useAuth()
  const [items, setItems] = useState<GroupByOption[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<GroupByStatusFilter>('active')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<GroupByOption | null>(null)
  const [name, setName] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const totalPages = Math.max(1, Math.ceil(total / DEFAULT_LIMIT))

  const fetchItems = useCallback(
    async (nextPage: number, nextSearch: string) => {
      if (!accessToken) return
      setLoading(true)
      setError('')
      try {
        const params = new URLSearchParams({
          page: String(nextPage),
          limit: String(DEFAULT_LIMIT),
          isActive: String(status === 'active'),
        })
        if (nextSearch.trim()) params.set('search', nextSearch.trim())
        const data = await apiFetch<{
          items?: GroupByApi[]
          total?: number
          page?: number
        }>(`/menu-groups?${params.toString()}`, undefined, accessToken)
        setItems(
          (data.items ?? [])
            .map(mapGroupByOption)
            .filter((item) => item.id && item.name),
        )
        setTotal(data.total ?? 0)
        setPage(data.page ?? nextPage)
      } catch (reason) {
        setItems([])
        setTotal(0)
        setError(
          reason instanceof Error
            ? reason.message
            : 'Failed to load Group By options.',
        )
      } finally {
        setLoading(false)
      }
    },
    [accessToken, status],
  )

  useEffect(() => {
    void fetchItems(1, search)
  }, [fetchItems, search, status])

  const openCreate = () => {
    setEditingItem(null)
    setName('')
    setIsActive(true)
    setFormError('')
    setMessage('')
    setModalOpen(true)
  }

  const openEdit = (item: GroupByOption) => {
    setEditingItem(item)
    setName(item.name)
    setIsActive(item.isActive)
    setFormError('')
    setMessage('')
    setModalOpen(true)
  }

  const closeModal = () => {
    if (saving) return
    setModalOpen(false)
    setEditingItem(null)
    setFormError('')
  }

  const save = async () => {
    if (!accessToken || saving) return
    const trimmedName = name.trim()
    if (!trimmedName) {
      setFormError('Group By name is required.')
      return
    }

    setSaving(true)
    setFormError('')
    try {
      await apiFetch(
        editingItem ? `/menu-groups/${editingItem.id}` : '/menu-groups',
        {
          method: editingItem ? 'PATCH' : 'POST',
          body: JSON.stringify({ name: trimmedName, isActive }),
        },
        accessToken,
      )
      setModalOpen(false)
      setEditingItem(null)
      setMessage(
        editingItem ? 'Group By option updated.' : 'Group By option created.',
      )
      await fetchItems(page, search)
    } catch (reason) {
      setFormError(
        reason instanceof Error
          ? reason.message
          : 'Failed to save Group By option.',
      )
    } finally {
      setSaving(false)
    }
  }

  const toggleStatus = async (item: GroupByOption) => {
    if (!accessToken) return
    const nextActive = !item.isActive
    setError('')
    try {
      await apiFetch(
        `/menu-groups/${item.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ isActive: nextActive }),
        },
        accessToken,
      )
      setMessage(
        nextActive
          ? 'Group By option activated.'
          : 'Group By option disabled.',
      )
      await fetchItems(page, search)
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Failed to update Group By option.',
      )
    }
  }

  return (
    <>
      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            className="w-full max-w-lg rounded-md border border-border bg-surface p-6 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="group-by-modal-title"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="group-by-modal-title" className="font-semibold">
                  {editingItem ? 'Edit Group By option' : 'Create Group By option'}
                </h3>
                <p className="mt-1 text-xs text-muted">
                  This value will appear in the Menu Production dropdown.
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                disabled={saving}
                className="dm-x-button disabled:opacity-60"
                aria-label="Close Group By form"
              >
                <i className="bi bi-x-lg" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <label htmlFor="group-by-name" className="text-sm font-medium">
                  Group By name
                </label>
                <input
                  id="group-by-name"
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={100}
                  autoFocus
                  className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(event) => setIsActive(event.target.checked)}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-accent-blue"
                />
                Active
              </label>
              {formError ? (
                <p className="text-xs font-medium text-red-600">{formError}</p>
              ) : null}
              <div className="flex gap-2">
                <ActionButton
                  action="save"
                  onClick={() => void save()}
                  disabled={saving}
                  className="flex-1"
                />
                <ActionButton
                  action="cancel"
                  onClick={closeModal}
                  disabled={saving}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <section className="rounded-md border border-border bg-surface shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Group By Management</h2>
            <p className="mt-1 text-xs text-muted">
              Manage options shown in the Menu Production Group By dropdown.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white shadow-sm"
          >
            <span className="flex items-center gap-2">
              <i className="bi bi-plus-circle text-base" aria-hidden="true" />
              <span>Input</span>
            </span>
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  setPage(1)
                  setSearch(searchInput.trim())
                }
              }}
              placeholder="Search Group By"
              className="w-56 rounded-2xl border border-border bg-white px-4 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
            />
            <button
              type="button"
              onClick={() => {
                setPage(1)
                setSearch(searchInput.trim())
              }}
              className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white"
            >
              Search
            </button>
            <select
              value={status}
              onChange={(event) => {
                setPage(1)
                setStatus(event.target.value as GroupByStatusFilter)
              }}
              className="rounded-2xl border border-border bg-white px-4 py-2 text-sm outline-none focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
            >
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
            </select>
          </div>
          <button
            type="button"
            onClick={() => void fetchItems(page, search)}
            aria-label="Refresh Group By options"
            title="Refresh Group By options"
            className="rounded-md border border-primary/40 bg-primary-soft p-2 text-primary"
          >
            <i className="bi bi-arrow-clockwise text-base" aria-hidden="true" />
          </button>
        </div>

        <TablePagination
          page={page}
          totalPages={totalPages}
          loading={loading}
          summary={`Showing ${items.length} of ${total} Group By options`}
          onPageChange={(nextPage) => void fetchItems(nextPage, search)}
          className="border-b border-border bg-white px-5 py-4"
        />

        <div className="max-w-full overflow-x-auto">
          <table className="dm-table min-w-full text-sm">
            <thead className="bg-background">
              <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                <th className="w-16 px-5 py-4 font-semibold">No</th>
                <th className="px-5 py-4 font-semibold">Group By Name</th>
                <th className="px-5 py-4 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr className="border-t border-border">
                  <td colSpan={3} className="px-5 py-10 text-center text-muted">
                    Loading Group By options...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr className="border-t border-border">
                  <td colSpan={3} className="px-5 py-10 text-center text-muted">
                    {error || 'No Group By options found.'}
                  </td>
                </tr>
              ) : (
                items.map((item, index) => (
                  <tr key={item.id} className="border-t border-border">
                    <td className="px-5 py-4 text-muted">
                      {(page - 1) * DEFAULT_LIMIT + index + 1}
                    </td>
                    <td className="px-5 py-4 font-medium">{item.name}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(item)}
                          className="rounded-md border border-border bg-background p-2 text-muted transition hover:bg-primary-soft hover:text-primary"
                          aria-label={`Edit ${item.name}`}
                          title="Edit"
                        >
                          <i className="bi bi-pencil-square text-base" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void toggleStatus(item)}
                          className="rounded-md border border-primary/40 bg-background p-2 text-primary transition hover:bg-primary-soft"
                          aria-label={item.isActive ? `Disable ${item.name}` : `Activate ${item.name}`}
                          title={item.isActive ? 'Disable' : 'Activate'}
                        >
                          <i
                            className={`bi ${item.isActive ? 'bi-toggle-on' : 'bi-toggle-off'} text-base`}
                            aria-hidden="true"
                          />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {message ? (
          <p className="px-5 pb-3 text-xs font-medium text-primary">{message}</p>
        ) : null}
        {error && items.length > 0 ? (
          <p className="px-5 pb-3 text-xs font-medium text-red-600">{error}</p>
        ) : null}
      </section>
    </>
  )
}

export default SuperadminGroupByManagement
