import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { useAuth } from '../lib/auth'

type NavItem = {
  label: string
  to: string
  end?: boolean
  icon: (className: string) => ReactNode
  children?: NavItem[]
}

type RoleLayoutProps = {
  workspaceLabel: string
  defaultEmail: string
  navItems: NavItem[]
  showSite?: boolean
}

const roleLabels: Record<string, string> = {
  chef: 'Chef',
  'unit-manager': 'Unit Manager',
  storekeeper: 'Storekeeper',
  superadmin: 'Superadmin',
}

const formatRoles = (roles?: string[]) => {
  const labels = (roles ?? [])
    .map((role) => roleLabels[role] ?? role)
    .filter(Boolean)

  return labels.length ? labels.join(', ') : undefined
}

const RoleLayout = ({
  workspaceLabel,
  defaultEmail,
  navItems,
  showSite = true,
}: RoleLayoutProps) => {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(
    () => (typeof window !== 'undefined' ? window.innerWidth >= 768 : true),
  )
  const [expandedMenus, setExpandedMenus] = useState<string[]>([])

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }
  const displayName = user?.name?.trim() || user?.email || defaultEmail
  const roleLabel = formatRoles(user?.roles) ?? (user ? roleLabels[user.role] : undefined)
  const identityLabel = roleLabel ? `${displayName} - ${roleLabel}` : workspaceLabel
  const siteLabel = showSite
    ? user?.siteName ?? user?.site ?? 'No site assigned'
    : user?.siteName ?? user?.site ?? workspaceLabel

  const getTarget = (to: string) => {
    const [pathname, search = ''] = to.split('?')
    return {
      pathname,
      search: search ? `?${search}` : '',
    }
  }

  const isItemActive = (item: NavItem) => {
    const target = getTarget(item.to)
    const pathActive = item.end
      ? location.pathname === target.pathname
      : location.pathname === target.pathname ||
        location.pathname.startsWith(`${target.pathname}/`)

    if (!pathActive) return false
    if (target.search) return location.search === target.search
    return true
  }

  useEffect(() => {
    const activeParentKeys = navItems
      .filter(
        (item) =>
          item.children?.length &&
          location.pathname === getTarget(item.to).pathname,
      )
      .map((item) => item.to)

    if (!activeParentKeys.length) return

    setExpandedMenus((current) => {
      const next = Array.from(new Set([...current, ...activeParentKeys]))
      return next.length === current.length ? current : next
    })
  }, [location.pathname, navItems])

  const toggleExpandedMenu = (key: string) => {
    setExpandedMenus((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    )
  }

  const renderPanelLink = (item: NavItem, level = 0) => {
    const target = getTarget(item.to)
    const hasChildren = Boolean(item.children?.length)
    const active = isItemActive(item)
    const pathActive = location.pathname === target.pathname
    const expanded = hasChildren && expandedMenus.includes(item.to)
    const parentActive = active || pathActive
    const showChildren = sidebarOpen && expanded

    return (
      <div key={item.to} className="space-y-1">
        <NavLink
          to={item.to}
          end={item.end}
          title={item.label}
          aria-label={item.label}
          onClick={() => {
            if (hasChildren) toggleExpandedMenu(item.to)
          }}
          className={() =>
            [
              'group flex min-h-8 items-center gap-2 rounded-md text-xs font-medium transition',
              sidebarOpen
                ? level > 0
                  ? 'min-h-7 px-2 py-1.5 text-[11px]'
                  : 'px-2 py-1.5'
                : 'mx-auto h-9 w-9 justify-center px-0 py-0',
              active
                ? 'bg-primary text-white shadow-sm'
                : level === 0 && parentActive
                  ? 'bg-primary-soft text-primary'
                  : 'text-foreground hover:bg-primary-soft hover:text-primary',
            ].join(' ')
          }
        >
          {item.icon('w-4 shrink-0 text-sm leading-none text-current')}
          {sidebarOpen ? (
            <>
              <span className="min-w-0 flex-1 whitespace-nowrap pr-4">
                {item.label}
              </span>
              <i
                className={`bi ${
                  hasChildren
                    ? expanded
                      ? 'bi-chevron-down'
                      : 'bi-chevron-up'
                    : active
                      ? 'bi-chevron-right'
                      : 'bi-chevron-up'
                } ml-auto text-[10px] leading-none text-current transition`}
                aria-hidden="true"
              />
            </>
          ) : null}
        </NavLink>

        {showChildren ? (
          <div className="ml-4 space-y-1 border-l border-border pl-2">
            {item.children?.map((child) => renderPanelLink(child, level + 1))}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <AppShell>
      <div className="min-h-screen">
        <header className="sticky top-0 z-30 w-full bg-primary text-white shadow-lg">
          <div className="flex w-full items-center justify-between gap-3 px-3 py-2 sm:px-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white p-1.5 ring-1 ring-white/30">
                <img
                  src="/Logo.png"
                  alt="Food Recipe System logo"
                  className="h-full w-full object-contain"
                />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold leading-tight text-white">
                  {identityLabel}
                </p>
                <p className="mt-0.5 truncate text-xs text-white/70">
                  {siteLabel}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="hidden rounded-md border border-white/20 bg-white/10 px-3 py-2 text-xs font-medium text-white md:block">
                {user?.email ?? defaultEmail}
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

        <div className="flex w-full items-stretch">
          <aside
            className={`flex min-h-[calc(100vh-56px)] shrink-0 flex-col border-r border-border bg-surface shadow-sm transition-all ${
              sidebarOpen ? 'w-max min-w-40 max-w-64' : 'w-12'
            }`}
          >
            <div className="flex h-[52px] items-center border-b border-border p-2">
              {sidebarOpen ? (
                <div className="flex h-9 w-full items-center gap-2 px-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-primary">
                    Menu
                  </span>
                  <button
                    type="button"
                    onClick={() => setSidebarOpen(false)}
                    className="flex h-7 w-7 items-center justify-center rounded-md bg-primary-soft text-primary transition hover:bg-primary hover:text-white"
                    aria-label="Collapse menu"
                  >
                    <i className="bi bi-chevron-left text-xs leading-none" aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setSidebarOpen(true)}
                  className="mx-auto flex h-8 w-8 items-center justify-center rounded-md bg-primary-soft text-primary shadow-sm transition hover:bg-primary hover:text-white"
                  aria-label="Expand menu"
                >
                  <i className="bi bi-list text-base leading-none" aria-hidden="true" />
                </button>
              )}
            </div>

            <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
              {navItems.map(renderPanelLink)}
            </nav>
          </aside>

          <main className="min-w-0 flex-1 px-3 pt-4 sm:px-4">
            <Outlet />
          </main>
        </div>
      </div>
    </AppShell>
  )
}

export default RoleLayout
