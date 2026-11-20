import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../lib/auth'
import RoleLayout from './RoleLayout'

const navItems = [
  {
    label: 'Quick View',
    to: '/storekeeper',
    end: true,
    componentKey: 'STORE_REQUEST_STOREKEEPER',
    icon: (className: string) => (
      <i className={`bi bi-speedometer2 ${className}`} aria-hidden="true" />
    ),
  },
  {
    label: 'Issuance History',
    to: '/storekeeper/history',
    componentKey: 'STORE_ISSUANCE_HISTORY', // 🌟 ADDED: Component key tracking for history records
    icon: (className: string) => (
      <i className={`bi bi-clock-history ${className}`} aria-hidden="true" />
    ),
  },
  {
    label: 'Inventory Management',
    to: '/storekeeper/inventory?view=stock',
    icon: (className: string) => (
      <i className={`bi bi-boxes ${className}`} aria-hidden="true" />
    ),
    children: [
      { label: 'List of Inventory', to: '/storekeeper/inventory?view=stock', breadcrumbPaths: ['/storekeeper/inventory/receive-goods', '/storekeeper/inventory/import-po'], icon: (className: string) => <i className={`bi bi-box-seam ${className}`} aria-hidden="true" /> },
      { label: 'Stock Movement', to: '/storekeeper/inventory?view=movements', icon: (className: string) => <i className={`bi bi-arrow-left-right ${className}`} aria-hidden="true" /> },
    ],
  },
]

const StorekeeperLayout = () => {
  const { accessToken } = useAuth()
  const [inventoryEnabled, setInventoryEnabled] = useState(false)

  useEffect(() => {
    if (!accessToken) return

    apiFetch<{ enabled: boolean }>(
      '/feature-flags/inventory',
      undefined,
      accessToken,
    )
      .then((result) => setInventoryEnabled(result.enabled))
      .catch(() => setInventoryEnabled(false))
  }, [accessToken])

  return (
    <RoleLayout
      workspaceLabel="Storekeeper Workspace"
      defaultEmail="storekeeper@example.com"
      navItems={navItems.filter(
        (item) => item.label !== 'Inventory Management' || inventoryEnabled,
      )}
    />
  )
}

export default StorekeeperLayout
