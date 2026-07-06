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
  componentKey?: string; // Supported option placeholder configuration identifier
}

type RoleLayoutProps = {
  workspaceLabel: string
  defaultEmail: string
  navItems: NavItem[]
  showSite?: boolean
}

type NotificationItem = {
  id: string
  title: string
  message: string
  componentKey?: string
  read: boolean
}

const RoleLayout = ({
  workspaceLabel,
  defaultEmail,
  navItems,
  showSite = true,
}: RoleLayoutProps) => {
  const { user, logout, accessToken } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  
  const [sidebarOpen, setSidebarOpen] = useState(
    () => (typeof window !== 'undefined' ? window.innerWidth >= 768 : true),
  )
  const [expandedMenus, setExpandedMenus] = useState<string[]>([])
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  
  const dropdownRef = useRef<HTMLDivElement>(null)

  const rawRole = user?.roles?.[0] || user?.role || ''
  const cleanRole = rawRole.startsWith('/') ? rawRole.slice(1) : rawRole
  
  const targetUserRole = cleanRole === 'unit-manager' ? 'unit.manager' : cleanRole
  const siteCode = user?.site || 'global'

  // Dynamic metrics polling loop 
  useEffect(() => {
    if (!targetUserRole || !siteCode || !accessToken) return

    const fetchActiveNotifications = async () => {
      try {
        const apiRole = targetUserRole === 'unit-manager' ? 'unit.manager' : targetUserRole;

        // 🌟 FIXED: Routed path back to 'role-unread' query instead of intercepting 'mark-role-read' as a GET
        const response = await fetch(
          `/api/notifications/role-unread?siteCode=${encodeURIComponent(siteCode)}&targetUserRole=${encodeURIComponent(apiRole)}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
          }
        )
        if (response.ok) {
          const data = await response.json()
          
          setNotifications(data)
        }
      } catch (err) {
        console.error('Failed to look up unread notification metrics:', err)
      }
    }

    // 🚀 Execute immediately on layout mount
    fetchActiveNotifications()
    
    // ⏳ Background polling loop safety backup (every 5s)
    const pollInterval = setInterval(fetchActiveNotifications, 5000)

    // 🌟 ADDED: Listen for single-click tab changes to update badges instantly!
    window.addEventListener('refresh-notifications', fetchActiveNotifications)

    // 🧼 Clean up everything safely when switching workspaces or logging out
    return () => {
      clearInterval(pollInterval)
      window.removeEventListener('refresh-notifications', fetchActiveNotifications)
    }
  }, [targetUserRole, siteCode, accessToken])

  // 🌟 Persistent Sticky Notification Handler: Marks read ONLY upon navigating away from the page
  useEffect(() => {
    if (notifications.length === 0 || !accessToken) return

    return () => {
      const clearNotificationsOnLeave = async () => {
        try {
          // 🌟 FIXED: Appended '/api' prefix back safely so the Vite configuration forwards the request
          await fetch('/api/notifications/mark-role-read', {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ siteCode, targetUserRole }),
          })
          setNotifications([])
        } catch (err) {
          console.error('Failed to auto-clear layout notifications on page transition:', err)
        }
      }

      clearNotificationsOnLeave()
    }
  }, [location.pathname, accessToken, siteCode, targetUserRole])

  const totalUnreadCount = notifications.length

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
  const userRolesArray = user?.roles || (user?.role ? [user.role] : [])

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

  // 🌟 Flexible Badge Processor matching string route paths and uppercase components
  const getComponentBadgeCount = (item: NavItem): number => {
    const directMatches = notifications.filter((n) => {
      if (!n.componentKey) return false

      const backendKey = n.componentKey.toLowerCase().replace(/[-_.]/g, '')
      const itemKeyFallback = item.componentKey?.toLowerCase().replace(/[-_.]/g, '') || ''
      const itemLabelFallback = item.label.toLowerCase().replace(/[-_.\s]/g, '')
      const itemUrlFallback = item.to.toLowerCase().replace(/[-_./\s]/g, '')

      return (
        backendKey === itemKeyFallback ||
        backendKey.includes(itemKeyFallback) ||
        backendKey.includes(itemLabelFallback) ||
        itemLabelFallback.includes(backendKey) ||
        backendKey.includes(itemUrlFallback) ||
        itemUrlFallback.includes(backendKey) ||
        (backendKey.includes('rawmaterial') && itemLabelFallback.includes('rawmaterial'))
      )
    }).length

    if (directMatches > 0) return directMatches

    if (item.children?.length) {
      return item.children.reduce((acc, child) => acc + getComponentBadgeCount(child), 0)
    }
    
    return 0
  }

  const renderPanelLink = (item: NavItem, level = 0) => {
    const target = getTarget(item.to)
    const hasChildren = Boolean(item.children?.length)
    const active = isItemActive(item)
    const childActive = Boolean(item.children?.some((child) => isItemActive(child)))
    const pathActive = location.pathname === target.pathname
    const expanded = hasChildren && expandedMenus.includes(item.to)
    const parentActive = active || childActive || pathActive
    const highlightActive = active || (level === 0 && childActive)
    const showChildren = sidebarOpen && expanded

    const itemBadgeCount = getComponentBadgeCount(item)

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
              'group flex min-h-8 items-center gap-2 rounded-md text-xs font-medium transition relative',
              sidebarOpen
                ? level > 0
                  ? 'min-h-7 px-2 py-1.5 text-[11px]'
                  : 'px-2 py-1.5'
                : 'mx-auto h-9 w-9 justify-center px-0 py-0',
              highlightActive
                ? 'bg-primary text-white shadow-sm'
                : level === 0 && parentActive
                  ? 'bg-primary-soft text-primary'
                  : 'text-foreground hover:bg-primary-soft hover:text-primary',
            ].join(' ')
          }
        >
          {item.icon('w-4 shrink-0 text-sm leading-none text-current')}
          
          {!sidebarOpen && itemBadgeCount > 0 && (
            <span className="absolute top-1.5 right-1.5 flex h-2 w-2 rounded-full bg-amber-400 ring-2 ring-white animate-pulse" />
          )}

          {sidebarOpen ? (
            <>
              <span className="min-w-0 flex-1 whitespace-nowrap pr-4 truncate">
                {item.label}
              </span>

              {itemBadgeCount > 0 && (
                <span className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded-full text-[10px] font-bold leading-none shrink-0 mr-2 ${
                  active ? 'bg-white text-primary' : 'bg-amber-400 text-primary-dark'
                }`}>
                  {itemBadgeCount}
                </span>
              )}

              <i
                className={`bi ${
                  hasChildren
                    ? expanded
                      ? 'bi-chevron-down'
                      : 'bi-chevron-up'
                    : active
                      ? 'bi-chevron-right'
                      : 'bi-chevron-up'
                } text-[10px] leading-none text-current transition`}
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
            
            {/* LEFT SIDE: BRAND LOGO & LOCATION */}
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

            {/* RIGHT SIDE: NOTIFICATION BELL & PROFILE AREA */}
            <div className="flex items-center gap-4 shrink-0">
              
              {/* Navbar Total Volume Bell Badge */}
              <div className="relative flex items-center justify-center h-8 w-8 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition cursor-pointer">
                <i className="bi bi-bell text-base text-white" />
                {totalUnreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[9px] font-black text-primary-dark shadow-sm ring-2 ring-primary">
                    {totalUnreadCount}
                  </span>
                )}
              </div>

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
                    
                    <div className="px-3 py-1.5 border-b border-border bg-muted/30 rounded-t-sm mb-1">
                      <p className="text-[10px] uppercase tracking-wider text-muted font-bold">Authenticated As</p>
                      <p className="text-xs font-medium text-foreground truncate mt-0.5">{user?.email ?? defaultEmail}</p>
                    </div>

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