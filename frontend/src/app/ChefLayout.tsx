import RoleLayout from './RoleLayout'

const navItems = [
  {
    label: 'Quick View',
    to: '/chef/dashboard',
    icon: (className: string) => (
      <i className={`bi bi-speedometer2 ${className}`} aria-hidden="true" />
    ),
    componentKey: 'CHEF_DASHBOARD', // 🌟 Explicit key stops fallback matches
  },
  {
    label: 'Menu Production',
    to: '/chef/menu-cycle',
    icon: (className: string) => (
      <i className={`bi bi-calendar2-week ${className}`} aria-hidden="true" />
    ),
    componentKey: 'MENU_PRODUCTION_RECORDS',
  },
  {
    label: 'Calculator Recipe',
    to: '/chef/recipe-calculator',
    icon: (className: string) => (
      <i className={`bi bi-calculator ${className}`} aria-hidden="true" />
    ),
    componentKey: 'CHEF_CALCULATOR',
  },
  {
    label: 'Recipe Data',
    to: '/chef/menu-bank',
    icon: (className: string) => (
      <i className={`bi bi-book ${className}`} aria-hidden="true" />
    ),
    componentKey: 'RECIPE_DATA_BANK',
  },
  {
    label: 'Create New Recipe',
    to: '/chef/menu-create',
    icon: (className: string) => (
      <i className={`bi bi-plus-circle ${className}`} aria-hidden="true" />
    ),
    componentKey: 'CREATE_RECIPE_FLOW',
  },
  {
    label: 'Add Raw Material',
    to: '/chef/raw-material/add',
    icon: (className: string) => (
      <i className={`bi bi-plus-square ${className}`} aria-hidden="true" />
    ),
    componentKey: 'ADD_RAW_MATERIAL_FLOW',
  },
  {
    label: 'Raw Material Data',
    to: '/chef/raw-material/data',
    icon: (className: string) => (
      <i className={`bi bi-box-seam ${className}`} aria-hidden="true" />
    ),
    componentKey: 'RAW_MATERIAL_DATA_BANK',
  },
  {
    label: 'Store Request',
    to: '/chef/store-request',
    icon: (className: string) => (
      <i className={`bi bi-bag ${className}`} aria-hidden="true" />
    ),
    componentKey: 'STORE_REQUEST_RECORDS',
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
