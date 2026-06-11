import RoleLayout from './RoleLayout'

const navItems = [
  {
    label: 'Dashboard',
    to: '/superadmin',
    end: true,
    icon: (className: string) => (
      <i className={`bi bi-grid ${className}`} aria-hidden="true" />
    ),
  },
  {
    label: 'User Management',
    to: '/superadmin/users',
    icon: (className: string) => (
      <i className={`bi bi-people ${className}`} aria-hidden="true" />
    ),
  },
  {
    label: 'Site Management',
    to: '/superadmin/sites',
    icon: (className: string) => (
      <i className={`bi bi-building ${className}`} aria-hidden="true" />
    ),
  },
  {
    label: 'UOM Management',
    to: '/superadmin/unit-of-measures',
    icon: (className: string) => (
      <i className={`bi bi-rulers ${className}`} aria-hidden="true" />
    ),
  },
  {
    label: 'Menu Management',
    to: '/superadmin/menu-management?tab=recipes',
    icon: (className: string) => (
      <i className={`bi bi-journal-text ${className}`} aria-hidden="true" />
    ),
    children: [
      {
        label: 'Menu Production',
        to: '/superadmin/menu-management?tab=menu-production',
        icon: (className: string) => (
          <i className={`bi bi-calendar2-week ${className}`} aria-hidden="true" />
        ),
      },
      {
        label: 'Calculator Recipe',
        to: '/superadmin/menu-management?tab=recipe-calculator',
        icon: (className: string) => (
          <i className={`bi bi-calculator ${className}`} aria-hidden="true" />
        ),
      },
      {
        label: 'Recipe Data',
        to: '/superadmin/menu-management?tab=recipes',
        icon: (className: string) => (
          <i className={`bi bi-journal-text ${className}`} aria-hidden="true" />
        ),
      },
      {
        label: 'Raw Material Data',
        to: '/superadmin/menu-management?tab=raw-materials',
        icon: (className: string) => (
          <i className={`bi bi-box-seam ${className}`} aria-hidden="true" />
        ),
      },
      {
        label: 'Categories',
        to: '/superadmin/menu-management?tab=categories',
        icon: (className: string) => (
          <i className={`bi bi-tags ${className}`} aria-hidden="true" />
        ),
      },
    ],
  },
  {
    label: 'Approval Centers',
    to: '/superadmin/approval-centers?section=recipes',
    icon: (className: string) => (
      <i className={`bi bi-shield-check ${className}`} aria-hidden="true" />
    ),
    children: [
      {
        label: 'Recipe Approval',
        to: '/superadmin/approval-centers?section=recipes',
        icon: (className: string) => (
          <i className={`bi bi-journal-check ${className}`} aria-hidden="true" />
        ),
      },
      {
        label: 'Menu Production Approval',
        to: '/superadmin/approval-centers?section=menu-productions',
        icon: (className: string) => (
          <i className={`bi bi-clipboard2-check ${className}`} aria-hidden="true" />
        ),
      },
    ],
  },
  {
    label: 'Store Request',
    to: '/superadmin/store-request',
    icon: (className: string) => (
      <i className={`bi bi-clipboard-check ${className}`} aria-hidden="true" />
    ),
  },
  {
    label: 'Store Export',
    to: '/superadmin/store-request-export',
    icon: (className: string) => (
      <i className={`bi bi-box-arrow-down ${className}`} aria-hidden="true" />
    ),
  },
]

const SuperadminLayout = () => {
  return (
    <RoleLayout
      workspaceLabel="Superadmin Workspace"
      defaultEmail="superadmin@example.com"
      navItems={navItems}
      showSite={false}
    />
  )
}

export default SuperadminLayout
