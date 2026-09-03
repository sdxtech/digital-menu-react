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
    label: 'Inventory',
    to: '/storekeeper/inventory',
    icon: (className: string) => (
      <i className={`bi bi-boxes ${className}`} aria-hidden="true" />
    ),
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
        (item) => item.to !== '/storekeeper/inventory' || inventoryEnabled,
      )}
    />
  )
}

export default StorekeeperLayout
