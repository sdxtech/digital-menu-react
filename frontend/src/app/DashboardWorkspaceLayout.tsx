import RoleLayout from './RoleLayout'
import { rolePathFor, useAuth } from '../lib/auth'
import { useDashboardAccess } from '../lib/dashboard-access'
import { Navigate } from 'react-router-dom'

export default function DashboardWorkspaceLayout() {
  const { user } = useAuth()
  const access = useDashboardAccess()
  if (access.isPending) return <p className="p-6 text-sm text-muted">Loading dashboard access...</p>
  if (access.error) return <div className="space-y-3 p-6">
    <p role="alert" className="text-sm text-red-600">{access.error.message}</p>
    <button type="button" onClick={() => { void access.refetch() }} className="rounded-lg border border-border px-3 py-2 text-sm">Retry</button>
  </div>
  if (!access.data?.dashboard) return <Navigate to={user ? rolePathFor(user.role) : '/login'} replace />
  return <RoleLayout workspaceLabel="Dashboard" defaultEmail="" navItems={[
    { label: 'Back to workspace', to: user ? rolePathFor(user.role) : '/login', icon: (className) => <i className={`bi bi-arrow-left ${className}`} aria-hidden="true" /> },
    { label: 'Dashboard', to: '/dashboard', end: true, icon: (className) => <i className={`bi bi-graph-up-arrow ${className}`} aria-hidden="true" /> },
  ]} />
}
