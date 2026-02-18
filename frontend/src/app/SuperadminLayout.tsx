import RoleLayout from './RoleLayout'

const navItems = [
  {
    label: 'User Management',
    to: '/superadmin',
    end: true,
    icon: (className: string) => (
      <svg viewBox="0 0 24 24" fill="none" className={className}>
        <path
          d="M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <path
          d="M4 20a8 8 0 0 1 16 0"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
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
