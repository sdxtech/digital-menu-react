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
  {
    label: 'Menu Production Records',
    to: '/unit-manager/menu-production-records',
    icon: (className: string) => (
      <i className={`bi bi-journal-check ${className}`} aria-hidden="true" />
    ),
  },
  {
    label: 'Recipe Data',
    to: '/unit-manager/recipe-data',
    icon: (className: string) => (
      <i className={`bi bi-book ${className}`} aria-hidden="true" />
    ),
  },
]

const UnitManagerLayout = () => {
  return <RoleLayout navItems={navItems} />
}

export default UnitManagerLayout
