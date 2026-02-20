import RoleLayout from './RoleLayout'

const navItems = [
  {
    label: 'Approval Center',
    to: '/unit-manager',
    end: true,
    icon: (className: string) => (
      <i className={`bi bi-shield-check ${className}`} aria-hidden="true" />
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
