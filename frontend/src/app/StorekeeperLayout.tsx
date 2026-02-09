import RoleLayout from './RoleLayout'

const navItems = [
  {
    label: 'Storekeeper Dashboard',
    to: '/storekeeper',
    end: true,
    icon: (className: string) => (
      <svg viewBox="0 0 24 24" fill="none" className={className}>
        <path
          d="M4 13h6V4H4v9Zm10 7h6V11h-6v9Zm0-18v7h6V2h-6ZM4 20h6v-5H4v5Z"
          fill="currentColor"
        />
      </svg>
    ),
  },
  {
    label: 'Issuance History',
    to: '/storekeeper/history',
    icon: (className: string) => (
      <svg viewBox="0 0 24 24" fill="none" className={className}>
        <path
          d="M5 6h14M5 12h14M5 18h10"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
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
