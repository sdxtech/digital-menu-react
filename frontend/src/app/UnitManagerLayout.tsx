import RoleLayout from './RoleLayout'

const navItems = [
  {
    label: 'Approval Center',
    to: '/unit-manager?section=recipes',
    icon: (className: string) => (
      <i className={`bi bi-shield-check ${className}`} aria-hidden="true" />
    ),
    componentKey: 'APPROVAL_CENTER',
    children: [
      {
        label: 'Recipe Approval',
        to: '/unit-manager?section=recipes',
        icon: (className: string) => (
          <i className={`bi bi-journal-check ${className}`} aria-hidden="true" />
        ),
        componentKey: 'RECIPE_APPROVAL_REQUESTS', // 🚀 Only lights up for recipe reviews
      },
      {
        label: 'Menu Production Approval',
        to: '/unit-manager?section=menu-productions',
        icon: (className: string) => (
          <i className={`bi bi-clipboard2-check ${className}`} aria-hidden="true" />
        ),
        componentKey: 'MENU_PRODUCTION_APPROVAL_REQUESTS', // 🚀 Only lights up for batch reviews
      },
    ],
  },
  {
    label: 'Menu Production Records',
    to: '/unit-manager/menu-production-records',
    icon: (className: string) => (
      <i className={`bi bi-journal-check ${className}`} aria-hidden="true" />
    ),
    componentKey: 'MGR_PRODUCTION_RECORDS',
  },
  {
    label: 'Recipe Data',
    to: '/unit-manager/recipe-data',
    icon: (className: string) => (
      <i className={`bi bi-book ${className}`} aria-hidden="true" />
    ),
    componentKey: 'MGR_RECIPE_DATA',
  },
]

const UnitManagerLayout = () => {
  return (
    <RoleLayout
      workspaceLabel="Unit Manager Workspace"
      defaultEmail="unit.manager@example.com"
      navItems={navItems}
    />
  )
}

export default UnitManagerLayout