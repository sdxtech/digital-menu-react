import RoleLayout from './RoleLayout'

const navItems = [
  {
    label: 'Storekeeper Dashboard',
    to: '/storekeeper',
    end: true,
    icon: (className: string) => (
      <i className={`bi bi-speedometer2 ${className}`} aria-hidden="true" />
    ),
  },
  {
    label: 'Issuance History',
    to: '/storekeeper/history',
    icon: (className: string) => (
      <i className={`bi bi-clock-history ${className}`} aria-hidden="true" />
    ),
  },
]

const StorekeeperLayout = () => {
  return (
    <RoleLayout
      workspaceLabel="Storekeeper Workspace"
      defaultEmail="storekeeper@brand.com"
      navItems={navItems}
    />
  )
}

export default StorekeeperLayout
