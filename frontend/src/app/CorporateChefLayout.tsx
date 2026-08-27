import RoleLayout from './RoleLayout'

const navItems = [
  {
    label: 'Recipe Approval',
    to: '/corporate-chef?section=recipes',
    icon: (className: string) => (
      <i className={`bi bi-journal-check ${className}`} aria-hidden="true" />
    ),
    componentKey: 'RECIPE_APPROVAL_REQUESTS',
  },
  {
    label: 'Create New Recipe',
    to: '/corporate-chef/menu-create',
    icon: (className: string) => (
      <i className={`bi bi-journal-plus ${className}`} aria-hidden="true" />
    ),
    componentKey: 'CREATE_RECIPE_FLOW',
  },
  {
    label: 'Recipe Drafts',
    to: '/corporate-chef/recipe-drafts',
    icon: (className: string) => (
      <i className={`bi bi-file-earmark-text ${className}`} aria-hidden="true" />
    ),
    componentKey: 'CREATE_RECIPE_FLOW',
  },
  {
    label: 'Recipe Data',
    to: '/corporate-chef/recipe-data',
    icon: (className: string) => (
      <i className={`bi bi-book ${className}`} aria-hidden="true" />
    ),
    componentKey: 'MGR_RECIPE_DATA',
  },
]

const CorporateChefLayout = () => (
  <RoleLayout
    workspaceLabel="Corporate Chef Workspace"
    defaultEmail="corporate.chef@example.com"
    navItems={navItems}
  />
)

export default CorporateChefLayout
