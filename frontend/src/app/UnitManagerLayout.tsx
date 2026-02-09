import RoleLayout from './RoleLayout'

const navItems = [
  {
    label: 'Approval Center',
    to: '/unit-manager',
    end: true,
    icon: (className: string) => (
      <svg viewBox="0 0 24 24" fill="none" className={className}>
        <path
          d="M12 3l7 4v5c0 4.5-3 8-7 9-4-1-7-4.5-7-9V7l7-4Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path
          d="M9.5 12l1.8 1.8 3.7-3.7"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
]

const UnitManagerLayout = () => {
  return (
    <RoleLayout
      workspaceLabel="Unit Manager Workspace"
      defaultEmail="unit.manager@brand.com"
      navItems={navItems}
    />
  )
}

export default UnitManagerLayout
