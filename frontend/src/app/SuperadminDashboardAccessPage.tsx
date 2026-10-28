import { applyDashboardPolicies } from '../lib/dashboard-access-save'
import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import PageHeading from '../components/PageHeading'
import TablePagination from '../components/TablePagination'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'
import { dashboardComponents, emptyDashboardPolicy, type AccessDecision, type DashboardSettings, type DashboardPolicy } from '../lib/dashboard-access'

const roles = [
  ['superadmin', 'Superadmin'], ['chef', 'Chef'], ['corporate-chef', 'Corporate Chef'],
  ['unit-manager', 'Unit Manager'], ['executive', 'Executive'], ['admin-site', 'Admin Sales'], ['storekeeper', 'Storekeeper'],
] as const
type Site = { code: string; name: string }
type UserOption = { id?: string; _id?: string; name: string; email: string; roles: string[] }
type SelectedUser = { id: string; name: string }

const fieldClass = 'w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/20 disabled:bg-gray-100'

function PolicyEditor({ initial, type, sites, selectedUsers = [], onSavingChange }: { initial?: DashboardSettings; type: 'role' | 'user'; sites: Site[]; selectedUsers?: SelectedUser[]; onSavingChange: (saving: boolean) => void }) {
  const { accessToken } = useAuth()
  const queryClient = useQueryClient()
  const [saved, setSaved] = useState(initial)
  const startingPolicy = initial?.policy ?? emptyDashboardPolicy()
  const bulk = selectedUsers.length > 1
  const [draft, setDraft] = useState<DashboardPolicy>({
    dashboard: startingPolicy.dashboard, components: startingPolicy.components,
    siteMode: startingPolicy.siteMode, sites: startingPolicy.sites,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const locked = initial?.target.locked ?? false
  const inheritLabel = type === 'user' ? 'Follow role' : 'Default (not granted)'
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (locked || saving) return
    if (draft.siteMode === 'selected' && !draft.sites.length) {
      setError('Select at least one site before saving.')
      return
    }
    setSaving(true)
    onSavingChange(true)
    setError('')
    setMessage('')
    try {
      const targets = type === 'user'
        ? selectedUsers.map((user) => ({ ...user, type: 'user' as const }))
        : initial ? [{ id: initial.target.id, name: initial.target.name, type: 'role' as const }] : []
      const result = await applyDashboardPolicies(targets, draft, (target, policy) =>
        apiFetch<DashboardSettings>(`/dashboard/access-settings/${target.type}/${target.id}`, {
          method: 'PUT', body: JSON.stringify(policy),
        }, accessToken ?? undefined),
      )
      result.saved.forEach((settings) => queryClient.setQueryData(['dashboard-settings', type, settings.target.id], settings))
      if (!bulk && result.saved[0]) {
        const settings = result.saved[0]
        setSaved(settings)
        setDraft({ dashboard: settings.policy.dashboard, components: settings.policy.components, siteMode: settings.policy.siteMode, sites: settings.policy.sites })
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['dashboard-access'] }),
        queryClient.invalidateQueries({ queryKey: ['analytics'] }),
      ])
      if (result.saved.length) setMessage(bulk
        ? `Dashboard permissions saved for ${result.saved.length} of ${targets.length} selected users.`
        : 'Dashboard permissions saved.')
      if (result.failed.length) setError(result.failed.map((failure) => `${failure.name}: ${failure.message}`).join('; '))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to save dashboard permissions.')
    } finally {
      setSaving(false)
      onSavingChange(false)
    }
  }
  const effectiveSiteLabel = !saved ? '' : saved.effective.sites === null ? 'All sites, including future sites'
    : saved.effective.sites.length ? saved.effective.sites.map((code) => sites.find((site) => site.code === code)?.name ?? code).join(', ')
      : type === 'role' && saved.effective.dashboard && saved.policy.siteMode === 'inherit' ? "Each user's assigned sites" : 'No sites'

  return <div className="space-y-4">
    <form onSubmit={(event) => { void save(event) }}>

      {locked ? <p className="mt-4 rounded-lg bg-primary-soft p-3 text-sm text-primary">Superadmin always has access to every site and dashboard component.</p> : null}
      <fieldset disabled={saving || locked} className="space-y-5">
        <div className={`grid items-end gap-4 ${type === 'user' && !locked ? 'md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]' : 'md:grid-cols-2'}`}>
        <div>
          <label htmlFor="dashboard-permission" className="mb-2 block text-sm font-semibold">Dashboard access</label>
          <select id="dashboard-permission" className={fieldClass} value={locked ? 'allow' : draft.dashboard} onChange={(event) => setDraft({ ...draft, dashboard: event.target.value as AccessDecision })}>
            <option value="inherit">{inheritLabel}</option><option value="allow">Allow</option><option value="deny">Deny</option>
          </select>
        </div>
        <div>
          <label htmlFor="dashboard-site-scope" className="mb-2 block text-sm font-semibold">Site access</label>
          <select id="dashboard-site-scope" className={fieldClass} value={locked ? 'all' : draft.siteMode} onChange={(event) => setDraft({ ...draft, siteMode: event.target.value as DashboardPolicy['siteMode'] })}>
            <option value="inherit">{type === 'user' ? 'Follow role' : "User's assigned sites"}</option>
            <option value="all">All sites (including future sites)</option>
            <option value="selected">Selected sites (one or more)</option>
          </select>

        </div>
        {type === 'user' && !locked ? <button type="button" disabled={saving} onClick={() => {
          setDraft({ dashboard: 'allow', siteMode: 'all', sites: [], components: dashboardComponents.map(({ key }) => ({ key, decision: 'allow' })) })
          setMessage('Full access selected. Save changes to apply it.')
        }} className="h-10 whitespace-nowrap rounded-lg border border-primary px-3 py-2 text-xs font-semibold text-primary">Select full dashboard access</button> : null}
        </div>
          {draft.siteMode === 'selected' && !locked ? <div className="mt-3 max-h-56 space-y-2 overflow-y-auto rounded-lg border border-border p-3">
            {sites.map((site) => <label key={site.code} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.sites.includes(site.code)} onChange={(event) => setDraft({ ...draft, sites: event.target.checked ? [...draft.sites, site.code] : draft.sites.filter((code) => code !== site.code) })} />
              {site.name} <span className="text-xs text-muted">({site.code})</span>
            </label>)}
            {!sites.length ? <p className="text-sm text-muted">No sites available.</p> : null}
          </div> : null}
        <div>
          <h3 className="text-sm font-semibold">Visible dashboard components</h3>
          {['Summary cards', 'Production status', 'Charts'].map((group) => <div key={group} className="mt-4">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{group}</h4>
            <div className="divide-y divide-border rounded-lg border border-border">
              {dashboardComponents.filter((item) => item.group === group).map((item) => <div key={item.key} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <label htmlFor={`permission-${item.key}`} className="text-sm">{item.label}</label>
                <select id={`permission-${item.key}`} value={locked ? 'allow' : draft.components.find((rule) => rule.key === item.key)?.decision ?? 'inherit'}
                  onChange={(event) => setDraft({ ...draft, components: [...draft.components.filter((rule) => rule.key !== item.key), { key: item.key, decision: event.target.value as AccessDecision }] })}
                  className={`${fieldClass} !w-44`}>
                  <option value="inherit">{inheritLabel}</option><option value="allow">Allow</option><option value="deny">Deny</option>
                </select>
              </div>)}
            </div>
          </div>)}
        </div>
      </fieldset>
      {error ? <p role="alert" className="mt-4 text-sm text-red-600">{error}</p> : null}
      {message ? <p role="status" className="mt-4 text-sm text-emerald-700">{message}</p> : null}
      {!locked ? <div className="mt-5 flex flex-wrap justify-end gap-3 border-t border-border pt-4">
        <button type="button" disabled={saving} onClick={() => { setDraft(emptyDashboardPolicy()); setMessage('Defaults selected. Save changes to apply them.') }} className="rounded-lg border border-border px-4 py-2 text-sm">{type === 'user' ? 'Follow role for all settings' : 'Reset to defaults'}</button>
        <button type="submit" disabled={saving} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving...' : bulk ? `Save for ${selectedUsers.length} users` : 'Save changes'}</button>
      </div> : null}
    </form>
    {saved && !bulk ? <section className="rounded-xl border border-blue-200 bg-blue-50 p-5">
      <h2 className="font-semibold">Dashboard Access Summary</h2>
      <p className="mt-2 text-sm">Dashboard: <strong>{saved.effective.dashboard ? 'Allowed' : 'Denied'}</strong></p>
      <p className="mt-1 text-sm">Sites: {effectiveSiteLabel}</p>
      <p className="mt-2 text-sm font-medium">Visible components</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {dashboardComponents.filter((item) => saved.effective.components[item.key]).map((item) => <span key={item.key} className="rounded-full border border-blue-200 bg-white px-3 py-1 text-xs">{item.label}</span>)}
        {!Object.values(saved.effective.components).some(Boolean) ? <span className="text-sm text-muted">None</span> : null}
      </div>
      {type === 'role' ? <p className="mt-3 text-xs text-muted">Users with multiple roles receive the combined grants of their enabled roles. Individual user overrides take precedence.</p> : null}
    </section> : null}
  </div>
}

export default function SuperadminDashboardAccessPage() {
  const { accessToken } = useAuth()
  const [type, setType] = useState<'role' | 'user'>('role')
  const [role, setRole] = useState('unit-manager')
  const [selectedUsers, setSelectedUsers] = useState<SelectedUser[]>([])
  const [savingSelection, setSavingSelection] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const targetId = type === 'role' ? role : selectedUsers.length === 1 ? selectedUsers[0].id : ''
  const sitesQuery = useQuery({
    queryKey: ['dashboard-settings-sites'],
    queryFn: async ({ signal }) => {
      const first = await apiFetch<{ items: Site[]; totalPages: number }>('/superadmin/sites?limit=200&page=1', { signal }, accessToken ?? undefined)
      const items = [...first.items]
      for (let sitePage = 2; sitePage <= first.totalPages; sitePage++) {
        const next = await apiFetch<{ items: Site[] }>(`/superadmin/sites?limit=200&page=${sitePage}`, { signal }, accessToken ?? undefined)
        items.push(...next.items)
      }
      return { items }
    },
  })
  const usersQuery = useQuery({
    queryKey: ['dashboard-settings-users', search, page], enabled: type === 'user' && search !== null,
    queryFn: ({ signal }) => apiFetch<{ items: UserOption[]; total: number; totalPages: number }>(`/superadmin/users?${new URLSearchParams({ search: search ?? '', page: String(page), limit: '10' })}`, { signal }, accessToken ?? undefined),
  })
  const settingsQuery = useQuery({
    queryKey: ['dashboard-settings', type, targetId], enabled: Boolean(targetId),
    queryFn: ({ signal }) => apiFetch<DashboardSettings>(`/dashboard/access-settings/${type}/${targetId}`, { signal }, accessToken ?? undefined),
  })
  const userTableMessage = search === null
    ? 'Enter a name or email, then press Enter or Search to find users.'
    : usersQuery.isLoading ? 'Loading users...'
    : usersQuery.error ? usersQuery.error.message
    : usersQuery.data?.items.length === 0 ? 'No users found.' : null
  const selectableUsers = (userTableMessage ? [] : usersQuery.data?.items ?? []).filter((user) => !user.roles.includes('superadmin') && Boolean(user.id ?? user._id))
  const allPageSelected = selectableUsers.length > 0 && selectableUsers.every((user) => selectedUsers.some((selected) => selected.id === (user.id ?? user._id)))
  const somePageSelected = selectableUsers.some((user) => selectedUsers.some((selected) => selected.id === (user.id ?? user._id)))
  const toggleUser = (user: SelectedUser) => setSelectedUsers((current) => current.some((selected) => selected.id === user.id)
    ? current.filter((selected) => selected.id !== user.id) : [...current, user])
  const handleSearch = (event: FormEvent) => {
    event.preventDefault()
    if (savingSelection) return
    const nextSearch = searchInput.trim()
    if (nextSearch && nextSearch === search && page === 1) {
      void usersQuery.refetch()
    }
    setSearch(nextSearch || null)
    setPage(1)
  }
  return <div className="space-y-4">
    <div>
      <PageHeading className="text-2xl font-semibold">Dashboard Access</PageHeading>
    </div>
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-black">Changes apply after saving. Users without a dashboard grant remain blocked. Superadmin access is always unrestricted.</div>
    <div className="space-y-5 rounded-xl border border-border bg-surface p-5 shadow-sm">
      <div className="grid grid-cols-1 gap-3 border-b border-black pb-5 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div>
          <label htmlFor="dashboard-permission-type" className="mb-2 block text-sm font-medium">Permission type</label>
          <select id="dashboard-permission-type" disabled={savingSelection} value={type} onChange={(event) => {
            setType(event.target.value as 'role' | 'user')
            setSearch(null)
            setSearchInput('')
            setSelectedUsers([])
            setPage(1)
          }} className={fieldClass}>
            <option value="role">Role permissions</option>
            <option value="user">User permissions</option>
          </select>
        </div>
        {type === 'role' ? <div>
          <label htmlFor="dashboard-role" className="mb-2 block text-sm font-medium">Select role</label>
          <select id="dashboard-role" disabled={savingSelection} value={role} onChange={(event) => setRole(event.target.value)} className={fieldClass}>{roles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        </div> : <>
          <form onSubmit={handleSearch} className="flex min-w-0 gap-2 md:self-end">
            <input aria-label="Search users by name or email" disabled={savingSelection} placeholder="Name or email" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} className={fieldClass} />
            <button type="submit" disabled={savingSelection} className="rounded-lg border border-border px-3 text-sm">Search</button>
          </form>
          <div className="space-y-3 md:col-span-2">
          <TablePagination
            page={page}
            totalPages={usersQuery.data?.totalPages ?? 1}
            onPageChange={setPage}
            loading={search === null || Boolean(usersQuery.error) || usersQuery.isFetching || savingSelection}
            summary={`Showing ${usersQuery.data?.items.length ?? 0} of ${usersQuery.data?.total ?? 0} users`}
          />
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="dm-table min-w-full text-sm">
              <thead className="bg-background">
                <tr className="text-left">
                  <th scope="col" className="w-12 px-4 py-3">
                    <input type="checkbox" aria-label="Select all editable users on this page" checked={allPageSelected}
                      disabled={savingSelection || !selectableUsers.length}
                      ref={(input) => { if (input) input.indeterminate = somePageSelected && !allPageSelected }}
                      onChange={(event) => {
                        const pageIds = new Set(selectableUsers.map((user) => user.id ?? user._id))
                        setSelectedUsers((current) => event.target.checked
                          ? [...current.filter((user) => !pageIds.has(user.id)), ...selectableUsers.map((user) => ({ id: user.id ?? user._id ?? '', name: user.name }))]
                          : current.filter((user) => !pageIds.has(user.id)))
                      }} />
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">Name</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Email</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Role</th>
                </tr>
              </thead>
              <tbody>
                {userTableMessage ? <tr>
                  <td colSpan={4} role={usersQuery.error ? 'alert' : 'status'} className={`px-4 py-6 text-center ${usersQuery.error ? 'text-red-600' : 'text-muted'}`}>{userTableMessage}</td>
                </tr> : usersQuery.data?.items.map((user) => {
                  const id = user.id ?? user._id ?? ''
                  const selected = selectedUsers.some((user) => user.id === id)
                  return <tr key={id} className={`border-t border-border ${selected ? 'bg-primary-soft' : 'hover:bg-background'}`}>
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={selected} disabled={savingSelection || !id || user.roles.includes('superadmin')}
                        aria-label={`Select ${user.name}`} title={user.roles.includes('superadmin') ? 'Superadmin always has unrestricted access.' : undefined}
                        onChange={() => toggleUser({ id, name: user.name })} />
                    </td>
                    <td className="px-4 py-3 font-semibold">{user.name}</td>
                    <td className="px-4 py-3">{user.email}</td>
                    <td className="px-4 py-3">{user.roles.join(', ')}</td>

                  </tr>
                })}
              </tbody>
            </table>
          </div>
        {type === 'user' && selectedUsers.length > 0 ? <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{selectedUsers.length} users selected</span>
          {selectedUsers.map((user) => <button key={user.id} type="button" disabled={savingSelection} onClick={() => toggleUser(user)}
            aria-label={`Remove ${user.name} from selection`} className="rounded-full border border-border bg-primary-soft px-3 py-1 text-xs text-primary">{user.name} <span aria-hidden="true">&times;</span></button>)}
          <button type="button" disabled={savingSelection} onClick={() => setSelectedUsers([])} className="text-xs font-semibold text-primary underline">Clear selection</button>
        </div> : null}
          {selectedUsers.length > 1 ? <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">Saving applies all settings below to {selectedUsers.length} selected users, replacing their existing user overrides. Select one user to view their current permissions.</p> : null}
          </div>
        </>}
      </div>
      <div>

        {sitesQuery.error ? <p role="alert" className="mb-3 text-sm text-red-600">{sitesQuery.error.message}</p> : null}
        {type === 'user' && selectedUsers.length > 1 && sitesQuery.data
          ? <PolicyEditor key={`users-${selectedUsers.map((user) => user.id).sort().join('-')}`} type="user" sites={sitesQuery.data.items} selectedUsers={selectedUsers} onSavingChange={setSavingSelection} />
          : !targetId ? <p className="p-6 text-sm text-muted">Select one or more users to manage dashboard access.</p>
          : settingsQuery.isPending || sitesQuery.isPending ? <p className="p-6 text-sm text-muted">Loading dashboard permissions...</p>
          : settingsQuery.error ? <p role="alert" className="p-6 text-sm text-red-600">{settingsQuery.error.message}</p>
          : settingsQuery.data && sitesQuery.data ? <PolicyEditor key={`${type}-${targetId}`} initial={settingsQuery.data} type={type} sites={sitesQuery.data.items} selectedUsers={selectedUsers} onSavingChange={setSavingSelection} /> : null}
      </div>
    </div>
  </div>
}
