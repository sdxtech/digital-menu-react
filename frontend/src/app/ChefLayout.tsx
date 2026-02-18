import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { useAuth } from '../lib/auth'

const navItems = [
  {
    label: 'Dashboard',
    to: '/chef/dashboard',
    icon: (className: string) => (
      <svg viewBox="0 0 24 24" fill="none" className={className}>
        <path
          d="M4 13h6V4H4v9Zm10 7h6V11h-6v9Zm0-18v7h6V2h-6ZM4 20h6v-5H4v5Z"
          fill="currentColor"
        />
      </svg>
    ),
  },
  {
    label: 'Menu Production',
    to: '/chef/menu-cycle',
    icon: (className: string) => (
      <svg viewBox="0 0 24 24" fill="none" className={className}>
        <path
          d="M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 4h12M8 11h8M8 15h5"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    label: 'Recipe Data',
    to: '/chef/menu-bank',
    icon: (className: string) => (
      <svg viewBox="0 0 24 24" fill="none" className={className}>
        <path
          d="M6 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 0-2 2V6a2 2 0 0 1 2-2Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path
          d="M8 8h8M8 12h8M8 16h5"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    label: 'Create New Recipe',
    to: '/chef/menu-create',
    icon: (className: string) => (
      <svg viewBox="0 0 24 24" fill="none" className={className}>
        <path
          d="M12 5v14M5 12h14"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <circle
          cx="12"
          cy="12"
          r="9"
          stroke="currentColor"
          strokeWidth="1.6"
        />
      </svg>
    ),
  },
  {
    label: 'Add Raw Material',
    to: '/chef/raw-material/add',
    icon: (className: string) => (
      <svg viewBox="0 0 24 24" fill="none" className={className}>
        <path
          d="M7 7h10v10H7V7Z"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <path
          d="M12 9v6M9 12h6"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    label: 'Raw Material Data',
    to: '/chef/raw-material/data',
    icon: (className: string) => (
      <svg viewBox="0 0 24 24" fill="none" className={className}>
        <path
          d="M5 6h14M5 12h14M5 18h14"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    label: 'Store Request',
    to: '/chef/store-request',
    icon: (className: string) => (
      <svg viewBox="0 0 24 24" fill="none" className={className}>
        <path
          d="M6 8h12l-1 10H7L6 8Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path
          d="M9 8V6a3 3 0 0 1 6 0v2"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
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
              <p className="text-xs uppercase tracking-[0.3em] text-white/70">
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
                className="rounded-2xl border border-white/30 bg-white/10 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/20"
              >
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
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-background text-primary transition hover:bg-primary-soft"
                aria-label={sidebarOpen ? 'Collapse menu' : 'Expand menu'}
              >
                <svg
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-4 w-4"
                  aria-hidden="true"
                >
                  {sidebarOpen ? (
                    <path d="M6.22 6.22a.75.75 0 0 1 1.06 0L10 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06L11.06 10l2.72 2.72a.75.75 0 1 1-1.06 1.06L10 11.06l-2.72 2.72a.75.75 0 1 1-1.06-1.06L8.94 10 6.22 7.28a.75.75 0 0 1 0-1.06z" />
                  ) : (
                    <path d="M3.75 5.5a.75.75 0 0 1 .75-.75h11a.75.75 0 0 1 0 1.5h-11a.75.75 0 0 1-.75-.75zm0 4.5a.75.75 0 0 1 .75-.75h11a.75.75 0 0 1 0 1.5h-11a.75.75 0 0 1-.75-.75zm0 4.5a.75.75 0 0 1 .75-.75h11a.75.75 0 0 1 0 1.5h-11a.75.75 0 0 1-.75-.75z" />
                  )}
                </svg>
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
                  {item.icon('h-5 w-5 text-current')}
                  {sidebarOpen ? (
                    <span className="truncate">{item.label}</span>
                  ) : null}
                </NavLink>
              ))}
            </nav>
          </aside>

          <main className="flex-1 pr-4">
            <Outlet />
          </main>
        </div>
      </div>
    </AppShell>
  )
}

export default ChefLayout
