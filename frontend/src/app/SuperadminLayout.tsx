import RoleLayout from './RoleLayout'

const navItems = [
  {
    label: 'User Management',
    to: '/superadmin',
    end: true,
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
