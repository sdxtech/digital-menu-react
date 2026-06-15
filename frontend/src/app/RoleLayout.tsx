import { useEffect, useState, type ReactNode, useRef } from 'react'
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
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false)
  
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setProfileDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleLogout = () => {
    setProfileDropdownOpen(false)
    logout()
    navigate('/login', { replace: true })
  }

  const displayName = user?.name?.trim() || user?.email || defaultEmail
  
  // Normalize role matching arrays for conditional guards
  const userRolesArray = user?.roles || (user?.role ? [user.role] : [])
  const isAuthorizedToSwitch = userRolesArray.includes('unit-manager') || userRolesArray.includes('superadmin')

  const siteLabel = showSite
    ? user?.siteName || user?.site || 'No site assigned'
    : user?.siteName || user?.site || workspaceLabel

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
        {/* NAVBAR */}
        <header className="sticky top-0 z-30 w-full bg-primary text-white shadow-lg">
          <div className="flex w-full items-center justify-between gap-3 px-3 py-2 sm:px-4">
            
            {/* LEFT SIDE: BRAND LOGO & LOCATION ONLY */}
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white p-1.5 ring-1 ring-white/30">
                <img
                  src="/Logo.png"
                  alt="Food Recipe System logo"
                  className="h-full w-full object-contain"
                />
              </div>
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 font-semibold text-sm tracking-wide text-white">
                  <i className="bi bi-geo-alt-fill text-amber-300 text-xs" />
                  {siteLabel}
                </p>
              </div>
            </div>

            {/* RIGHT SIDE: PROFILE AREA */}
            <div className="relative flex shrink-0 items-center" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
                className="flex items-center gap-3 rounded-md border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/40"
              >
                <div className="flex items-center gap-2">
                  <i className="bi bi-person-circle text-base text-white/80" />
                  <span className="font-semibold leading-none">
                    {displayName}
                  </span>
                </div>
                <i className={`bi bi-chevron-down text-[10px] text-white/60 transition-transform ${profileDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {profileDropdownOpen && (
                <div className="absolute right-0 top-full mt-2 w-64 rounded-md border border-border bg-surface p-1 shadow-xl ring-1 ring-black/5 animate-in fade-in slide-in-from-top-1 duration-100">
                  
                  {/* Account Header context */}
                  <div className="px-3 py-1.5 border-b border-border bg-muted/30 rounded-t-sm mb-1">
                    <p className="text-[10px] uppercase tracking-wider text-muted font-bold">Authenticated As</p>
                    <p className="text-xs font-medium text-foreground truncate mt-0.5">{user?.email ?? defaultEmail}</p>
                  </div>

                  {/* GROUP 1: PERSONAL WORKSPACE OPTIONS */}
                  <div className="space-y-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setProfileDropdownOpen(false);
                        const rawRole = userRolesArray[0] || '';
                        const cleanRole = rawRole.startsWith('/') ? rawRole : `/${rawRole}`;
                        navigate(`${cleanRole}/profile`);
                      }}
                      className="flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-xs text-foreground transition hover:bg-primary-soft hover:text-primary focus:outline-none group"
                    >
                      <i className="bi bi-person text-sm text-muted group-hover:text-primary" />
                      My Profile
                    </button>
                    
                    {/* 🌟 FIXED: Programmed the handler link to dynamically route into the active security space config */}
                    <button
                      type="button"
                      onClick={() => {
                        setProfileDropdownOpen(false);
                        const rawRole = userRolesArray[0] || '';
                        const cleanRole = rawRole.startsWith('/') ? rawRole : `/${rawRole}`;
                        navigate(`${cleanRole}/security`);
                      }}
                      className="flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-xs text-foreground transition hover:bg-primary-soft hover:text-primary focus:outline-none group"
                    >
                      <i className="bi bi-shield-lock text-sm text-muted group-hover:text-primary" />
                      Security & Password
                    </button>
                  </div>

                  <div className="my-1 border-t border-border" />

                  {/* GROUP 2: SESSION TERMINATION */}
                  <div>
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-xs font-bold text-rose-600 transition hover:bg-rose-50 hover:text-rose-700 focus:outline-none"
                    >
                      <i className="bi bi-box-arrow-right text-sm" />
                      Sign Out
                    </button>
                  </div>

                </div>
              )}
            </div>

          </div>
        </header>

        {/* WORKSPACE SIDEBAR & CONTENTS */}
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
                    Navigation Menu
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