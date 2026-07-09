import {
  useEffect,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useRef,
} from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { apiFetch } from '../lib/api'
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
  createdAt?: string
}

type NotificationFilter = 'unread' | 'read'

const formatNotificationTimestamp = (value?: string) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
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
  const [notificationDropdownOpen, setNotificationDropdownOpen] = useState(false)
  const [notificationFilter, setNotificationFilter] =
    useState<NotificationFilter>('unread')
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  
  const dropdownRef = useRef<HTMLDivElement>(null)
  const notificationDropdownRef = useRef<HTMLDivElement>(null)

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

        const data = await apiFetch<NotificationItem[]>(
          `/notifications/role?siteCode=${encodeURIComponent(siteCode)}&targetUserRole=${encodeURIComponent(apiRole)}`,
          undefined,
          accessToken,
        )

        setNotifications(data)
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

  const unreadNotifications = notifications.filter((notification) => !notification.read)
  const readNotifications = notifications.filter((notification) => notification.read)
  const visibleNotifications =
    notificationFilter === 'unread' ? unreadNotifications : readNotifications
  const emptyNotificationMessage =
    notificationFilter === 'unread'
      ? 'No unread notifications.'
      : 'No read notifications.'
  const totalUnreadCount = unreadNotifications.length

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setProfileDropdownOpen(false)
      }
      if (
        notificationDropdownRef.current &&
        !notificationDropdownRef.current.contains(event.target as Node)
      ) {
        setNotificationDropdownOpen(false)
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

  const toggleNotificationDropdown = () => {
    setNotificationDropdownOpen((current) => !current)
    setProfileDropdownOpen(false)
  }

  const handleNotificationBellPointerDown = (
    event: PointerEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    toggleNotificationDropdown()
  }

  const handleNotificationBellKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
  ) => {
    if (event.key !== 'Enter' && event.key !== ' ') return

    event.preventDefault()
    toggleNotificationDropdown()
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
  const normalizeComponentKey = (value?: string) =>
    value?.toLowerCase().replace(/[-_.\s]/g, '') ?? ''

  const findNotificationTarget = (componentKey?: string) => {
    const key = normalizeComponentKey(componentKey)
    if (!key) return undefined

    const items = navItems.flatMap((item) => [item, ...(item.children ?? [])])
    return items.find((item) => normalizeComponentKey(item.componentKey) === key)
  }

  const getComponentBadgeCount = (item: NavItem): number => {
    const itemKey = normalizeComponentKey(item.componentKey)
    if (!itemKey) return 0

    return unreadNotifications.filter(
      (notification) =>
        normalizeComponentKey(notification.componentKey) === itemKey,
    ).length
  }

  const renderNotificationItem = (notification: NotificationItem) => {
    const target = findNotificationTarget(notification.componentKey)
    const timestamp = formatNotificationTimestamp(notification.createdAt)
    const content = (
      <div className="flex items-start gap-2">
        <span
          className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
            notification.read ? 'bg-border' : 'bg-amber-400'
          }`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p
              className={`min-w-0 truncate text-xs font-semibold ${
                notification.read ? 'text-muted' : 'text-foreground'
              }`}
            >
              {notification.title}
            </p>
            {timestamp ? (
              <p className="flex shrink-0 items-center gap-1 whitespace-nowrap text-[10px] font-medium text-muted">
                <i className="bi bi-clock text-[10px]" aria-hidden="true" />
                <span>{timestamp}</span>
              </p>
            ) : null}
          </div>
          <p className="mt-1 line-clamp-2 text-[11px] text-muted">
            {notification.message}
          </p>
          {target ? (
            <p className="mt-1 text-[10px] font-semibold text-primary">
              {target.label}
            </p>
          ) : null}
        </div>
      </div>
    )

    return target ? (
      <button
        key={notification.id}
        type="button"
        onClick={() => {
          setNotificationDropdownOpen(false)
          navigate(target.to)
        }}
        className="block w-full rounded-md px-3 py-2 text-left transition hover:bg-primary-soft"
      >
        {content}
      </button>
    ) : (
      <div key={notification.id} className="px-3 py-2">
        {content}
      </div>
    )
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
              
              <div className="relative" ref={notificationDropdownRef}>
                <button
                  type="button"
                  onPointerDown={handleNotificationBellPointerDown}
                  onKeyDown={handleNotificationBellKeyDown}
                  className="relative flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/40"
                  aria-label="Notifications"
                  aria-expanded={notificationDropdownOpen}
                  aria-haspopup="menu"
                >
                  <i className="bi bi-bell text-base text-white" />
                  {totalUnreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[9px] font-black text-primary-dark shadow-sm ring-2 ring-primary">
                      {totalUnreadCount}
                    </span>
                  )}
                </button>

                {notificationDropdownOpen && (
                  <div
                    className="fixed left-3 right-3 top-16 z-50 mt-0 max-h-[calc(100vh-5rem)] overflow-hidden rounded-md border border-border bg-surface p-1 text-foreground shadow-xl ring-1 ring-black/5 md:absolute md:left-auto md:right-0 md:top-full md:mt-2 md:w-[26rem] md:max-w-[calc(100vw-1rem)] md:max-h-none md:overflow-visible"
                    role="menu"
                  >
                    <div className="border-b border-border px-3 py-2">
                      <p className="text-xs font-semibold">Notifications</p>
                      <div className="mt-2 grid grid-cols-2 rounded-md bg-muted/30 p-0.5">
                        <button
                          type="button"
                          onClick={() => setNotificationFilter('unread')}
                          className={`rounded px-2 py-1 text-[11px] font-semibold transition ${
                            notificationFilter === 'unread'
                              ? 'bg-surface text-primary shadow-sm'
                              : 'text-muted hover:text-foreground'
                          }`}
                          aria-pressed={notificationFilter === 'unread'}
                        >
                          {totalUnreadCount} Unread
                        </button>
                        <button
                          type="button"
                          onClick={() => setNotificationFilter('read')}
                          className={`rounded px-2 py-1 text-[11px] font-semibold transition ${
                            notificationFilter === 'read'
                              ? 'bg-surface text-primary shadow-sm'
                              : 'text-muted hover:text-foreground'
                          }`}
                          aria-pressed={notificationFilter === 'read'}
                        >
                          {readNotifications.length} Read
                        </button>
                      </div>
                    </div>

                    <div className="max-h-80 overflow-y-auto py-1">
                      {notifications.length === 0 ? (
                        <div className="px-3 py-6 text-center text-xs text-muted">
                          No notifications yet.
                        </div>
                      ) : visibleNotifications.length === 0 ? (
                        <div className="px-3 py-6 text-center text-xs text-muted">
                          {emptyNotificationMessage}
                        </div>
                      ) : (
                        visibleNotifications.slice(0, 10).map(renderNotificationItem)
                      )}
                    </div>
                  </div>
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
                  <div className="fixed left-3 right-3 top-16 z-50 mt-0 w-auto rounded-md border border-border bg-surface p-1 shadow-xl ring-1 ring-black/5 animate-in fade-in slide-in-from-top-1 duration-100 md:absolute md:left-auto md:right-0 md:top-full md:mt-2 md:w-64">
                    
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
        <div className="relative flex w-full items-stretch">
          <aside
            className={`fixed left-0 top-14 z-20 flex h-[calc(100vh-56px)] shrink-0 flex-col border-r border-border bg-surface shadow-sm transition-all md:static md:h-auto md:min-h-[calc(100vh-56px)] ${
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

          <main
            className={`min-w-0 w-full flex-1 pt-4 transition-[padding] md:px-4 ${
              sidebarOpen ? 'px-3' : 'pl-[3.75rem] pr-3'
            }`}
          >
            <Outlet />
          </main>
        </div>
      </div>
    </AppShell>
  )
}

export default RoleLayout
