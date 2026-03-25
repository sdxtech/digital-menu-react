import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { useAuth } from '../lib/auth'

const navItems = [
  {
    label: 'Dashboard',
    to: '/chef/dashboard',
    icon: (className: string) => (
      <i className={`bi bi-speedometer2 ${className}`} aria-hidden="true" />
    ),
  },
  {
    label: 'Menu Production',
    to: '/chef/menu-cycle',
    icon: (className: string) => (
      <i className={`bi bi-calendar2-week ${className}`} aria-hidden="true" />
    ),
  },
  {
    label: 'Recipe Data',
    to: '/chef/menu-bank',
    icon: (className: string) => (
      <i className={`bi bi-book ${className}`} aria-hidden="true" />
    ),
  },
  {
    label: 'Create New Recipe',
    to: '/chef/menu-create',
    icon: (className: string) => (
      <i className={`bi bi-plus-circle ${className}`} aria-hidden="true" />
    ),
  },
  {
    label: 'Add Raw Material',
    to: '/chef/raw-material/add',
    icon: (className: string) => (
      <i className={`bi bi-plus-square ${className}`} aria-hidden="true" />
    ),
  },
  {
    label: 'Raw Material Data',
    to: '/chef/raw-material/data',
    icon: (className: string) => (
      <i className={`bi bi-box-seam ${className}`} aria-hidden="true" />
    ),
  },
  {
    label: 'Store Request',
    to: '/chef/store-request',
    icon: (className: string) => (
      <i className={`bi bi-bag ${className}`} aria-hidden="true" />
    ),
  },
]

const ChefLayout = () => {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(
    () => (typeof window !== 'undefined' ? window.innerWidth >= 768 : true),
  )

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <AppShell>
      <div className="min-h-screen">
        <header className="sticky top-0 z-30 w-full bg-primary text-white shadow-lg">
          <div className="flex w-full items-center justify-between gap-4 px-4 py-2">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-white">
                DM
              </div>
            <div>
              <p className="text-xs text-white/70">
                Chef Workspace
              </p>
            </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-medium text-white">
                {user?.email ?? 'chef@brand.com'}
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-2 rounded-md border border-white/30 bg-white/10 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/20"
              >
                <i className="bi bi-box-arrow-right text-sm leading-none" aria-hidden="true" />
                Logout
              </button>
            </div>
          </div>
        </header>

        <div className="flex w-full items-stretch gap-6">
          <aside
            className={`shrink-0 border border-border bg-white shadow-sm transition-all ${
              sidebarOpen ? 'w-40 sm:w-64' : 'w-10 sm:w-16'
            } min-h-[calc(100vh-64px)]`}
          >
            <div
              className={`flex items-center border-b border-border px-3 py-3 ${
                sidebarOpen ? 'justify-between' : 'justify-center'
              }`}
            >
              {sidebarOpen ? (
                <span className="text-xs uppercase tracking-[0.3em] text-muted">
                  Menu
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => setSidebarOpen((prev) => !prev)}
                className="dm-x-button"
                aria-label={sidebarOpen ? 'Collapse menu' : 'Expand menu'}
              >
                <i
                  className={`bi ${
                    sidebarOpen ? 'bi-x-lg' : 'bi-list'
                  } text-base leading-none`}
                  aria-hidden="true"
                />
              </button>
            </div>

            <nav className="p-2">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    [
                      'group flex items-center gap-3 rounded-xl px-3 py-2 text-[11px] font-medium transition sm:text-sm',
                      sidebarOpen ? 'justify-start' : 'justify-center',
                      isActive
                        ? 'bg-primary-soft text-primary'
                        : 'text-foreground hover:bg-primary-soft',
                    ].join(' ')
                  }
                >
                  {item.icon('text-lg leading-none text-current')}
                  {sidebarOpen ? (
                    <span className="truncate">{item.label}</span>
                  ) : null}
                </NavLink>
              ))}
            </nav>
          </aside>

          <main className="min-w-0 flex-1 pr-4 pt-4">
            <Outlet />
          </main>
        </div>
      </div>
    </AppShell>
  )
}

export default ChefLayout
