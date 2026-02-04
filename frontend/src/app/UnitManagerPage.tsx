import { useMemo, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { useChefData } from '../lib/chef-data'
import { useAuth } from '../lib/auth'

const navItems = [{ label: 'Approval Center', to: '/unit-manager' }]

const UnitManagerPage = () => {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const {
    recipes,
    menuProductions,
    approveRecipe,
    rejectRecipe,
    approveMenuProduction,
    rejectMenuProduction,
  } = useChefData()
  const [actionError, setActionError] = useState('')

  const pendingRecipes = useMemo(
    () => recipes.filter((item) => item.approvalStatus === 'pending'),
    [recipes],
  )

  const pendingMenuProductions = useMemo(
    () => menuProductions.filter((item) => item.approvalStatus === 'pending'),
    [menuProductions],
  )

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-6xl px-6 py-10 lg:px-10">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-white shadow-[0_12px_30px_rgba(11,41,87,0.25)]">
              UM
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-muted">
                Unit Manager Workspace
              </p>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Approval Center
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl border border-border bg-surface px-4 py-2 text-xs font-medium text-muted shadow-sm">
              {user?.email ?? 'unit.manager@brand.com'}
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-2xl border border-border bg-white px-4 py-2 text-xs font-semibold text-primary shadow-sm transition hover:bg-primary-soft"
            >
              Logout
            </button>
          </div>
        </header>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <aside className="lg:col-span-3">
            <div className="rounded-3xl border border-border bg-surface p-5 shadow-sm">
              <p className="text-xs uppercase tracking-[0.3em] text-muted">
                Role
              </p>
              <h2 className="mt-2 text-lg font-semibold">Unit Manager</h2>
              <p className="mt-3 text-xs text-muted">
                Review and approve recipes and production menus.
              </p>
            </div>

            <nav className="mt-5 space-y-2 rounded-3xl border border-border bg-surface p-4 shadow-sm">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    [
                      'flex items-center justify-between rounded-2xl px-4 py-3 text-sm font-medium transition',
                      isActive
                        ? 'bg-primary text-white shadow-[0_12px_30px_rgba(11,41,87,0.25)]'
                        : 'bg-background text-foreground hover:bg-primary-soft',
                    ].join(' ')
                  }
                >
                  <span>{item.label}</span>
                  <span className="text-xs opacity-70">-&gt;</span>
                </NavLink>
              ))}
            </nav>
          </aside>

          <main className="space-y-6 lg:col-span-9">
            <div>
              <p className="text-sm text-muted">
                Review recipes and production menus from the Chef team.
              </p>
              {actionError ? (
                <p className="mt-2 text-xs font-medium text-red-600">
                  {actionError}
                </p>
              ) : null}
            </div>

            <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
              <h2 className="text-lg font-semibold">Approval Recipe</h2>
              <div className="mt-4 overflow-x-auto rounded-2xl border border-border">
                <table className="min-w-full bg-white text-sm">
                  <thead className="bg-background">
                    <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                      <th className="px-4 py-3 font-semibold">Name</th>
                      <th className="px-4 py-3 font-semibold">Category</th>
                      <th className="px-4 py-3 font-semibold">Recipe status</th>
                      <th className="px-4 py-3 font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingRecipes.length === 0 ? (
                      <tr>
                        <td
                          colSpan={4}
                          className="px-4 py-6 text-center text-muted"
                        >
                          No recipes pending approval.
                        </td>
                      </tr>
                    ) : (
                      pendingRecipes.map((item) => (
                        <tr key={item.id} className="border-t border-border">
                          <td className="px-4 py-3">{item.name}</td>
                          <td className="px-4 py-3">{item.category}</td>
                          <td className="px-4 py-3">
                            {item.status === 'active' ? 'Active' : 'Draft'}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={async () => {
                                  setActionError('')
                                  try {
                                    await approveRecipe(item.id)
                                  } catch (error) {
                                    setActionError(
                                      error instanceof Error
                                        ? error.message
                                        : 'Failed to approve recipe.',
                                    )
                                  }
                                }}
                                className="rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-white"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  setActionError('')
                                  try {
                                    await rejectRecipe(item.id)
                                  } catch (error) {
                                    setActionError(
                                      error instanceof Error
                                        ? error.message
                                        : 'Failed to reject recipe.',
                                    )
                                  }
                                }}
                                className="rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold text-primary"
                              >
                                Reject
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
              <h2 className="text-lg font-semibold">Approval Menu Production</h2>
              <div className="mt-4 overflow-x-auto rounded-2xl border border-border">
                <table className="min-w-full bg-white text-sm">
                  <thead className="bg-background">
                    <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                      <th className="px-4 py-3 font-semibold">Menu</th>
                      <th className="px-4 py-3 font-semibold">Category</th>
                      <th className="px-4 py-3 font-semibold">Portion</th>
                      <th className="px-4 py-3 font-semibold">Production date</th>
                      <th className="px-4 py-3 font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingMenuProductions.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-4 py-6 text-center text-muted"
                        >
                          No production menus pending approval.
                        </td>
                      </tr>
                    ) : (
                      pendingMenuProductions.map((item) => (
                        <tr key={item.id} className="border-t border-border">
                          <td className="px-4 py-3">{item.menuName}</td>
                          <td className="px-4 py-3">{item.category}</td>
                          <td className="px-4 py-3">{item.portion}</td>
                          <td className="px-4 py-3">{item.productionDate}</td>
                          <td className="px-4 py-3">
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={async () => {
                                  setActionError('')
                                  try {
                                    await approveMenuProduction(item.id)
                                  } catch (error) {
                                    setActionError(
                                      error instanceof Error
                                        ? error.message
                                        : 'Failed to approve menu production.',
                                    )
                                  }
                                }}
                                className="rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-white"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  setActionError('')
                                  try {
                                    await rejectMenuProduction(item.id)
                                  } catch (error) {
                                    setActionError(
                                      error instanceof Error
                                        ? error.message
                                        : 'Failed to reject menu production.',
                                    )
                                  }
                                }}
                                className="rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold text-primary"
                              >
                                Reject
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </main>
        </div>
      </div>
    </AppShell>
  )
}

export default UnitManagerPage
