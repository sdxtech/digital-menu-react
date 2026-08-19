import RoleLayout from './RoleLayout'

const navItems = [
  {
    label: 'Menu Production Sales Input',
    to: '/admin-site/menu-productions',
    icon: (className: string) => (
      <i className={`bi bi-cash-coin ${className}`} aria-hidden="true" />
    ),
    componentKey: 'ADMIN_SITE_MENU_PRODUCTION_SALES',
  },
  {
    label: 'Menu Production History',
    to: '/admin-site/menu-production-history',
    icon: (className: string) => (
      <i className={`bi bi-clock-history ${className}`} aria-hidden="true" />
    ),
  },
]

const AdminSiteLayout = () => (
  <RoleLayout
    workspaceLabel="Admin Site Workspace"
    defaultEmail="admin.site@example.com"
    navItems={navItems}
  />
)

export default AdminSiteLayout
