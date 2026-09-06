import RoleLayout from './RoleLayout'

const navItems = [
  {
    label: 'Menu Production Progress',
    to: '/executive/menu-production-progress',
    icon: (className: string) => (
      <i className={`bi bi-graph-up-arrow ${className}`} aria-hidden="true" />
    ),
  },
  {
    label: 'Recipe Data',
    to: '/executive/recipe-data',
    icon: (className: string) => (
      <i className={`bi bi-book ${className}`} aria-hidden="true" />
    ),
  },
]

const ExecutiveLayout = () => (
  <RoleLayout
    workspaceLabel="Executive Workspace"
    defaultEmail="executive@example.com"
    navItems={navItems}
  />
)

export default ExecutiveLayout
