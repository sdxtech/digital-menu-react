import RoleLayout from './RoleLayout'

const navItems = [
  {
    label: 'Quick View',
    to: '/storekeeper',
    end: true,
    componentKey: 'STORE_REQUEST_STOREKEEPER',
    icon: (className: string) => (
      <i className={`bi bi-speedometer2 ${className}`} aria-hidden="true" />
    ),
  },
  {
    label: 'Issuance History',
    to: '/storekeeper/history',
    componentKey: 'STORE_ISSUANCE_HISTORY', // 🌟 ADDED: Component key tracking for history records
    icon: (className: string) => (
      <i className={`bi bi-clock-history ${className}`} aria-hidden="true" />
    ),
  },
]

const StorekeeperLayout = () => {
  return (
    <RoleLayout
      workspaceLabel="Storekeeper Workspace"
      defaultEmail="storekeeper@example.com"
      navItems={navItems}
    />
  )
}

export default StorekeeperLayout
