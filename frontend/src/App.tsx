import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { rolePathFor, type Role, useAuth } from './lib/auth'
import LoginPage from './app/LoginPage'
import ChefLayout from './app/ChefLayout'
import ChefCreateMenu from './app/ChefCreateMenu'
import ChefAddRawMaterial from './app/ChefAddRawMaterial'
import ChefDashboard from './app/ChefDashboard'
import ChefMenuBank from './app/ChefMenuBank'
import ChefMenuCycle from './app/ChefMenuCycle'
import ChefRawMaterial from './app/ChefRawMaterial'
import ChefStoreRequest from './app/ChefStoreRequest'
import StorekeeperPage from './app/StorekeeperPage'
import StorekeeperHistoryPage from './app/StorekeeperHistoryPage'
import UnitManagerPage from './app/UnitManagerPage'
import AdminUsersPage from './app/AdminUsersPage'

const RequireAuth = () => {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  return <Outlet />
}

const RequireRole = ({ role }: { role: Role }) => {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== role) return <Navigate to={rolePathFor(user.role)} replace />
  return <Outlet />
}

const RoleLanding = () => {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  return <Navigate to={rolePathFor(user.role)} replace />
}

const NotFound = () => (
  <div className="min-h-screen bg-primary-soft text-foreground">
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-xs uppercase tracking-[0.4em] text-muted">
        404
      </p>
      <h1 className="text-3xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted">
        Check the address or return to your dashboard.
      </p>
    </div>
  </div>
)

function App() {
  return (
    <Routes>
      <Route path="/" element={<RoleLanding />} />
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<RequireRole role="chef" />}>
          <Route path="/chef" element={<ChefLayout />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<ChefDashboard />} />
            <Route path="menu-cycle" element={<ChefMenuCycle />} />
            <Route path="menu-bank" element={<ChefMenuBank />} />
            <Route path="menu-create" element={<ChefCreateMenu />} />
            <Route
              path="raw-material"
              element={<Navigate to="/chef/raw-material/data" replace />}
            />
            <Route path="raw-material/add" element={<ChefAddRawMaterial />} />
            <Route path="raw-material/data" element={<ChefRawMaterial />} />
            <Route path="store-request" element={<ChefStoreRequest />} />
          </Route>
        </Route>
        <Route element={<RequireRole role="unit-manager" />}>
          <Route path="/unit-manager" element={<UnitManagerPage />} />
        </Route>
        <Route element={<RequireRole role="storekeeper" />}>
          <Route path="/storekeeper" element={<StorekeeperPage />} />
          <Route path="/storekeeper/history" element={<StorekeeperHistoryPage />} />
        </Route>
        <Route element={<RequireRole role="admin" />}>
          <Route path="/admin" element={<AdminUsersPage />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

export default App
