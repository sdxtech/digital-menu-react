import RoleLayout from './RoleLayout'

const navItems = [
  {
    label: 'Dashboard',
    to: '/superadmin',
    end: true,
    icon: (className: string) => (
      <i className={`bi bi-grid ${className}`} aria-hidden="true" />
    ),
  },
  {
    label: 'User Management',
    to: '/superadmin/users',
    icon: (className: string) => (
      <i className={`bi bi-people ${className}`} aria-hidden="true" />
    ),
  },
  {
    label: 'Site Management',
    to: '/superadmin/sites',
    icon: (className: string) => (
      <i className={`bi bi-building ${className}`} aria-hidden="true" />
    ),
  },
  {
    label: 'Menu Management',
    to: '/superadmin/menu-management',
    icon: (className: string) => (
      <i className={`bi bi-journal-text ${className}`} aria-hidden="true" />
    ),
  },
  {
    label: 'Store Request',
    to: '/superadmin/store-request',
    icon: (className: string) => (
      <i className={`bi bi-clipboard-check ${className}`} aria-hidden="true" />
    ),
  },
  {
    label: 'Store Export',
    to: '/superadmin/store-request-export',
    icon: (className: string) => (
      <i className={`bi bi-box-arrow-down ${className}`} aria-hidden="true" />
    ),
  },
]

const SuperadminLayout = () => {
  return (
    <RoleLayout
      workspaceLabel="Superadmin Workspace"
      defaultEmail="superadmin@example.com"
      navItems={navItems}
      showSite={false}
    />
  )
}

export default SuperadminLayout
