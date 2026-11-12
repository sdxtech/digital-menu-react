import RoleLayout from './RoleLayout'

const navItems = [
  {
    label: 'Approval Center',
    to: '/finance-controller',
    icon: (className: string) => <i className={`bi bi-shield-check ${className}`} aria-hidden="true" />,
    componentKey: 'APPROVAL_CENTER',
    children: [
      {
        label: 'Menu Production Approval',
        to: '/finance-controller',
        icon: (className: string) => <i className={`bi bi-clipboard2-check ${className}`} aria-hidden="true" />,
        componentKey: 'MENU_PRODUCTION_APPROVAL_REQUESTS',
      },
    ],
  },
  {
    label: 'Menu Production Records',
    to: '/finance-controller/menu-production-records',
    icon: (className: string) => <i className={`bi bi-journal-check ${className}`} aria-hidden="true" />,
    componentKey: 'MGR_PRODUCTION_RECORDS',
  },
]

export default function FinanceControllerLayout() {
  return <RoleLayout workspaceLabel="Finance Operations Controller Workspace" defaultEmail="finance.controller@example.com" navItems={navItems} />
}
