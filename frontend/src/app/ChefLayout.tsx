import RoleLayout from './RoleLayout'

const navItems = [
  {
    label: 'Dashboard',
    to: '/chef/dashboard',
    icon: (className: string) => (
      <i className={`bi bi-speedometer2 ${className}`} aria-hidden="true" />
    ),
  },
  {
    label: 'Menu Production',
    to: '/chef/menu-cycle',
    icon: (className: string) => (
      <i className={`bi bi-calendar2-week ${className}`} aria-hidden="true" />
    ),
  },
  {
    label: 'Calculator Recipe',
    to: '/chef/recipe-calculator',
    icon: (className: string) => (
      <i className={`bi bi-calculator ${className}`} aria-hidden="true" />
    ),
  },
  {
    label: 'Recipe Data',
    to: '/chef/menu-bank',
    icon: (className: string) => (
      <i className={`bi bi-book ${className}`} aria-hidden="true" />
    ),
  },
  {
    label: 'Create New Recipe',
    to: '/chef/menu-create',
    icon: (className: string) => (
      <i className={`bi bi-plus-circle ${className}`} aria-hidden="true" />
    ),
  },
  {
    label: 'Add Raw Material',
    to: '/chef/raw-material/add',
    icon: (className: string) => (
      <i className={`bi bi-plus-square ${className}`} aria-hidden="true" />
    ),
  },
  {
    label: 'Raw Material Data',
    to: '/chef/raw-material/data',
    icon: (className: string) => (
      <i className={`bi bi-box-seam ${className}`} aria-hidden="true" />
    ),
  },
  {
    label: 'Store Request',
    to: '/chef/store-request',
    icon: (className: string) => (
      <i className={`bi bi-bag ${className}`} aria-hidden="true" />
    ),
  },
]

const ChefLayout = () => {
  return (
    <RoleLayout
      workspaceLabel="Chef Workspace"
      defaultEmail="chef@brand.com"
      navItems={navItems}
    />
  )
}

export default ChefLayout
