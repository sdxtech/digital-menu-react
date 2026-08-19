import { useCallback, useEffect, useState } from 'react'
import TablePagination from '../components/TablePagination'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'

type Site = { id: string; name: string; code: string }
type Client = { id: string; name: string; clientId: string; sites: Site[] }
type ClientForm = { name: string; clientId: string; siteIds: string[] }

const DEFAULT_LIMIT = 10
const emptyForm: ClientForm = { name: '', clientId: '', siteIds: [] }

const SuperadminClientManagementPage = () => {
  const { accessToken } = useAuth()
  const [clients, setClients] = useState<Client[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ClientForm>(emptyForm)
  const [formError, setFormError] = useState('')

  const fetchSites = useCallback(async () => {
    if (!accessToken) return
    const fetchSitePage = (sitePage: number) =>
      apiFetch<{
        items?: Site[]
        totalPages?: number
      }>(
        `/superadmin/sites?page=${sitePage}&limit=100&isActive=true`,
        undefined,
        accessToken,
      )

    const firstPage = await fetchSitePage(1)
    const totalPages = firstPage.totalPages ?? 1
    const remainingPages = await Promise.all(
      Array.from({ length: Math.max(0, totalPages - 1) }, (_, index) =>
        fetchSitePage(index + 2),
      ),
    )
    setSites(
      [firstPage, ...remainingPages].flatMap((page) => page.items ?? []),
    )
  }, [accessToken])

  const fetchClients = useCallback(async () => {
    if (!accessToken) return
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(DEFAULT_LIMIT),
      })
      if (search) params.set('search', search)
      const data = await apiFetch<{
        items?: Client[]
        total?: number
        page?: number
        totalPages?: number
      }>(`/superadmin/clients?${params.toString()}`, undefined, accessToken)
      setClients(data.items ?? [])
      setTotal(data.total ?? 0)
      setTotalPages(data.totalPages ?? 1)
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load clients.')
    } finally {
      setLoading(false)
    }
  }, [accessToken, page, search])

  useEffect(() => {
    fetchSites().catch((fetchError) => {
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load sites.')
    })
  }, [fetchSites])

  useEffect(() => {
    fetchClients().catch(() => null)
  }, [fetchClients])

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyForm)
    setFormError('')
    setModalOpen(true)
  }

  const openEdit = (client: Client) => {
    setEditingId(client.id)
    setForm({
      name: client.name,
      clientId: client.clientId,
      siteIds: client.sites.map((site) => site.id),
    })
    setFormError('')
    setModalOpen(true)
  }

  const toggleSite = (siteId: string) => {
    setForm((current) => ({
      ...current,
      siteIds: current.siteIds.includes(siteId)
        ? current.siteIds.filter((id) => id !== siteId)
        : [...current.siteIds, siteId],
    }))
  }

  const toggleAllSites = () => {
    setForm((current) => ({
      ...current,
      siteIds:
        sites.length > 0 && current.siteIds.length === sites.length
          ? []
          : sites.map((site) => site.id),
    }))
  }

  const getServedSitesLabel = (client: Client) =>
    client.sites.length > 3
      ? `${client.sites.length} sites selected`
      : client.sites.map((site) => `${site.name} (${site.code})`).join(', ') || '-'

  const save = async () => {
    if (!accessToken) return
    if (!form.name.trim() || !form.clientId.trim() || form.siteIds.length === 0) {
      setFormError('Nama client, ID client, dan minimal satu site wajib diisi.')
      return
    }
    try {
      await apiFetch(
        editingId ? `/superadmin/clients/${editingId}` : '/superadmin/clients',
        {
          method: editingId ? 'PATCH' : 'POST',
          body: JSON.stringify({
            name: form.name.trim(),
            clientId: form.clientId.trim(),
            siteIds: form.siteIds,
          }),
        },
        accessToken,
      )
      setModalOpen(false)
      setMessage(editingId ? 'Client updated.' : 'Client created.')
      fetchClients().catch(() => null)
    } catch (saveError) {
      setFormError(saveError instanceof Error ? saveError.message : 'Failed to save client.')
    }
  }

  const remove = async (client: Client) => {
    if (!accessToken || !window.confirm(`Delete ${client.name} permanently?`)) return
    try {
      await apiFetch(`/superadmin/clients/${client.id}`, { method: 'DELETE' }, accessToken)
      setMessage('Client deleted.')
      if (clients.length === 1 && page > 1) setPage((current) => current - 1)
      else fetchClients().catch(() => null)
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Failed to delete client.')
    }
  }

  return (
    <div className="w-full py-2">
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Client Management</h1>
            <p className="mt-1 text-sm text-muted">Manage clients and the sites serving them.</p>
          </div>
          <button type="button" onClick={openCreate} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white">
            Add Client
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                setPage(1)
                setSearch(searchInput.trim())
              }
            }}
            placeholder="Search client name or ID"
            className="w-full max-w-sm rounded-md border border-border bg-white px-3 py-2 text-sm"
          />
          <button type="button" onClick={() => { setPage(1); setSearch(searchInput.trim()) }} className="rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold text-primary">
            Search
          </button>
        </div>

        {message ? <p className="text-sm text-success">{message}</p> : null}
        {error ? <p className="text-sm text-danger">{error}</p> : null}

        <div className="overflow-hidden rounded-md border border-border bg-surface">
          <TablePagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            loading={loading}
            summary={`Showing ${clients.length} of ${total} clients`}
            className="rounded-t-md border-b border-border bg-white px-5 py-4"
          />

          <div className="max-w-full overflow-x-auto">
            <table className="dm-table min-w-full text-sm">
            <thead className="bg-background">
              <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                <th className="w-16 px-5 py-4 font-semibold">No</th>
                <th className="px-5 py-4 font-semibold">Client Name</th>
                <th className="px-5 py-4 font-semibold">Client ID</th>
                <th className="px-5 py-4 font-semibold">Served Site(s)</th>
                <th className="px-5 py-4 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr className="border-t border-border">
                  <td colSpan={5} className="px-5 py-10 text-center text-muted">Loading clients...</td>
                </tr>
              ) : null}
              {!loading && clients.length === 0 ? (
                <tr className="border-t border-border">
                  <td colSpan={5} className="px-5 py-10 text-center text-muted">{error || 'No clients found.'}</td>
                </tr>
              ) : null}
              {!loading && clients.map((client, index) => (
                <tr key={client.id} className="border-t border-border">
                  <td className="px-5 py-4 text-sm text-muted">{(page - 1) * DEFAULT_LIMIT + index + 1}</td>
                  <td className="px-5 py-4">{client.name}</td>
                  <td className="px-5 py-4">{client.clientId}</td>
                  <td className="px-5 py-4">{getServedSitesLabel(client)}</td>
                  <td className="px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => openEdit(client)} className="rounded-md border border-border bg-background p-2 text-muted transition hover:bg-primary-soft hover:text-primary" aria-label="Edit client" title="Edit client">
                        <i className="bi bi-pencil-square text-base" aria-hidden="true" />
                      </button>
                      <button type="button" onClick={() => remove(client)} className="rounded-md border border-danger/40 bg-background p-2 text-danger transition hover:bg-danger/10" aria-label="Delete client" title="Delete client">
                        <i className="bi bi-trash3 text-base" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
        </div>
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-md border border-border bg-surface p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{editingId ? 'Edit Client' : 'Add Client'}</h2>
              <button type="button" onClick={() => setModalOpen(false)} className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-primary">Close</button>
            </div>
            <div className="mt-5 space-y-4">
              <label className="block text-sm font-medium">Client Name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-1 w-full rounded-md border border-border px-3 py-2 font-normal" /></label>
              <label className="block text-sm font-medium">Client ID<input value={form.clientId} onChange={(event) => setForm({ ...form, clientId: event.target.value })} className="mt-1 w-full rounded-md border border-border px-3 py-2 font-normal" /></label>
              <fieldset>
                <legend className="text-sm font-medium">Served Site(s)</legend>
                <div className="mt-2 max-h-48 space-y-2 overflow-y-auto rounded-md border border-border p-3">
                  {sites.length === 0 ? <p className="text-xs text-muted">No active sites available.</p> : (
                    <>
                      <label className="flex items-center gap-2 border-b border-border pb-2 text-sm font-semibold">
                        <input
                          type="checkbox"
                          checked={form.siteIds.length === sites.length}
                          onChange={toggleAllSites}
                        />
                        Select all active sites
                      </label>
                      {sites.map((site) => (
                        <label key={site.id} className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={form.siteIds.includes(site.id)} onChange={() => toggleSite(site.id)} />
                          {site.name} ({site.code})
                        </label>
                      ))}
                    </>
                  )}
                </div>
              </fieldset>
              {formError ? <p className="text-sm text-danger">{formError}</p> : null}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setModalOpen(false)} className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-primary">Cancel</button>
                <button type="button" onClick={save} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white">Save</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default SuperadminClientManagementPage
