import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { useAuth } from '../lib/auth'

const navItems = [
  { label: 'Dashboard', to: '/chef/dashboard' },
  { label: 'Menu Production', to: '/chef/menu-cycle' },
  { label: 'Recipe Data', to: '/chef/menu-bank' },
  { label: 'Create New Recipe', to: '/chef/menu-create' },
  { label: 'Add Raw Material', to: '/chef/raw-material/add' },
  { label: 'Raw Material Data', to: '/chef/raw-material/data' },
  { label: 'Store Request', to: '/chef/store-request' },
]

const ChefLayout = () => {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

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
              DM
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-muted">
                Chef Workspace
              </p>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Operasional Dapur
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl border border-border bg-surface px-4 py-2 text-xs font-medium text-muted shadow-sm">
              {user?.email ?? 'chef@brand.com'}
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-2xl border border-border bg-white px-4 py-2 text-xs font-semibold text-primary shadow-sm transition hover:bg-primary-soft"
            >
              Keluar
            </button>
          </div>
        </header>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <aside className="lg:col-span-3">
            <div className="rounded-3xl border border-border bg-surface p-5 shadow-sm">
              <p className="text-xs uppercase tracking-[0.3em] text-muted">
                Role
              </p>
              <h2 className="mt-2 text-lg font-semibold">Chef</h2>
              <p className="mt-3 text-xs text-muted">
                Akses khusus menu & produksi harian.
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

            <div className="mt-5 rounded-3xl border border-border bg-gradient-to-br from-primary to-accent-indigo p-5 text-white shadow-lg">
              <p className="text-xs uppercase tracking-[0.3em] text-white/70">
                Shift
              </p>
              <p className="mt-2 text-lg font-semibold">Pagi - 07:00</p>
              <p className="mt-2 text-xs text-white/80">
                Fokus menu sarapan & minuman dingin.
              </p>
            </div>
          </aside>

          <main className="lg:col-span-9">
            <Outlet />
          </main>
        </div>
      </div>
    </AppShell>
  )
}

export default ChefLayout
