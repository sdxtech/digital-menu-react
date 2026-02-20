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
]

const SuperadminLayout = () => {
  return (
    <RoleLayout
      workspaceLabel="Superadmin Workspace"
      defaultEmail="superadmin@example.com"
      navItems={navItems}
    />
  )
}

export default SuperadminLayout
