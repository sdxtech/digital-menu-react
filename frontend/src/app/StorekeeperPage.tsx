import { NavLink, useNavigate } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { useAuth } from '../lib/auth'

const navItems = [{ label: 'Storekeeper Dashboard', to: '/storekeeper' }]

const StorekeeperPage = () => {
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
              SK
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-muted">
                Storekeeper Workspace
              </p>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Inventory Desk
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl border border-border bg-surface px-4 py-2 text-xs font-medium text-muted shadow-sm">
              {user?.email ?? 'storekeeper@brand.com'}
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
              <h2 className="mt-2 text-lg font-semibold">Storekeeper</h2>
              <p className="mt-3 text-xs text-muted">
                Kelola stok dan distribusi bahan baku.
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
            <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
              <p className="text-xs uppercase tracking-[0.3em] text-muted">
                Status
              </p>
              <h2 className="mt-2 text-xl font-semibold">
                Halaman Storekeeper sementara aktif
              </h2>
              <p className="mt-3 text-sm text-muted">
                Kamu sudah bisa login, lihat layout dashboard, dan logout dari
                role Storekeeper.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
                <p className="text-xs uppercase tracking-[0.2em] text-muted">
                  Incoming Request
                </p>
                <p className="mt-3 text-3xl font-semibold">0</p>
                <p className="mt-2 text-xs text-muted">
                  Menunggu integrasi modul Store Request.
                </p>
              </div>
              <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
                <p className="text-xs uppercase tracking-[0.2em] text-muted">
                  Stock Alert
                </p>
                <p className="mt-3 text-3xl font-semibold">0</p>
                <p className="mt-2 text-xs text-muted">
                  Belum ada alert stok untuk ditindaklanjuti.
                </p>
              </div>
            </div>
          </main>
        </div>
      </div>
    </AppShell>
  )
}

export default StorekeeperPage
