import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { rolePathFor, type Role, useAuth } from './lib/auth'
import LoginPage from './app/LoginPage'
import ForgotPasswordPage from './app/ForgotPasswordPage' // 🌟 Added unauthenticated page import
import ResetPasswordPage from './app/ResetPasswordPage'
import ChefLayout from './app/ChefLayout'
import ChefCreateMenu from './app/ChefCreateMenu'
import ChefAddRawMaterial from './app/ChefAddRawMaterial'
import ChefDashboard from './app/ChefDashboard'
import ChefMenuBank from './app/ChefMenuBank'
import ChefMenuCycle from './app/ChefMenuCycle'
import ChefRawMaterial from './app/ChefRawMaterial'
import ChefStoreRequest from './app/ChefStoreRequest'
import StorekeeperLayout from './app/StorekeeperLayout'
import StorekeeperPage from './app/StorekeeperPage'
import StorekeeperHistoryPage from './app/StorekeeperHistoryPage'
import UnitManagerLayout from './app/UnitManagerLayout'
import UnitManagerMenuProductionRecordsPage from './app/UnitManagerMenuProductionRecordsPage'
import UnitManagerPage from './app/UnitManagerPage'
import UnitManagerRecipeDataPage from './app/UnitManagerRecipeDataPage'
import SuperadminLayout from './app/SuperadminLayout'
import SuperadminApprovalCentersPage from './app/SuperadminApprovalCentersPage'
import SuperadminDashboardPage from './app/SuperadminDashboardPage'
import SuperadminMenuManagementPage, {
  RecipeCalculator,
} from './app/SuperadminMenuManagementPage'
import SuperadminSitesPage from './app/SuperadminSitesPage'
import SuperadminUsersPage from './app/SuperadminUsersPage'
import SuperadminStoreRequestExportPage from './app/SuperadminStoreRequestExportPage'
import SuperadminStoreRequestPage from './app/SuperadminStoreRequestPage'
import { useRouteDocumentTitle } from './lib/document-title'
import ProfileView from './app/ProfileView'

// ➕ Safely import your new Security & Password View component
import SecurityView from './app/SecurityView'
import SuperadminUnitOfMeasuresPage from './app/SuperadminUnitOfMeasuresPage'

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
      <p className="text-xs text-muted">
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
  useRouteDocumentTitle()

  return (
    <Routes>
      <Route path="/" element={<RoleLanding />} />
      <Route path="/login" element={<LoginPage />} />
      
      {/* 🌟 OPEN PATHWAY ROUTE VIEWS (Unauthenticated access maps) */}
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      
      {/* AUTHENTICATED CONTAINER BOUNDARY */}
      <Route element={<RequireAuth />}>

        {/* CHEF SPACE SUB-ROUTES MAP */}
        <Route element={<RequireRole role="chef" />}>
          <Route path="/chef" element={<ChefLayout />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<ChefDashboard />} />
            <Route path="profile" element={<ProfileView />} />
            
            {/* ➕ Added security tracking sub-path route */}
            <Route path="security" element={<SecurityView />} />
            
            <Route
              path="menu-cycle"
              element={
                <ChefMenuCycle
                  showEstimatedCostColumns
                  showIngredientCostColumns
                  showIngredientVendorColumn
                />
              }
            />
            <Route path="recipe-calculator" element={<RecipeCalculator />} />
            <Route path="menu-bank" element={<ChefMenuBank />} />
            <Route
              path="menu-create"
              element={<ChefCreateMenu enableIngredientUomConversion />}
            />
            <Route
              path="raw-material"
              element={<Navigate to="/chef/raw-material/data" replace />}
            />
            <Route path="raw-material/add" element={<ChefAddRawMaterial />} />
            <Route path="raw-material/data" element={<ChefRawMaterial />} />
            <Route path="store-request" element={<ChefStoreRequest />} />
          </Route>
        </Route>

        {/* UNIT MANAGER SPACE SUB-ROUTES MAP */}
        <Route element={<RequireRole role="unit-manager" />}>
          <Route path="/unit-manager" element={<UnitManagerLayout />}>
            <Route index element={<UnitManagerPage />} />
            <Route path="profile" element={<ProfileView />} />
            
            {/* ➕ Added security tracking sub-path route */}
            <Route path="security" element={<SecurityView />} />
            
            <Route
              path="menu-production-records"
              element={<UnitManagerMenuProductionRecordsPage />}
            />
            <Route path="recipe-data" element={<UnitManagerRecipeDataPage />} />
          </Route>
        </Route>

        {/* STOREKEEPER SPACE SUB-ROUTES MAP */}
        <Route element={<RequireRole role="storekeeper" />}>
          <Route path="/storekeeper" element={<StorekeeperLayout />}>
            <Route index element={<StorekeeperPage />} />
            <Route path="profile" element={<ProfileView />} />
            
            {/* ➕ Added security tracking sub-path route */}
            <Route path="security" element={<SecurityView />} />
            
            <Route path="history" element={<StorekeeperHistoryPage />} />
          </Route>
        </Route>

        {/* SUPERADMIN SPACE SUB-ROUTES MAP */}
        <Route element={<RequireRole role="superadmin" />}>
          <Route path="/superadmin" element={<SuperadminLayout />}>
            <Route index element={<SuperadminDashboardPage />} />
            <Route path="profile" element={<ProfileView />} />
            
            {/* ➕ Added security tracking sub-path route */}
            <Route path="security" element={<SecurityView />} />
            
            <Route path="users" element={<SuperadminUsersPage />} />
            <Route path="sites" element={<SuperadminSitesPage />} />
            <Route path="unit-of-measures" element={<SuperadminUnitOfMeasuresPage />} />
            <Route path="menu-management" element={<SuperadminMenuManagementPage />} />
            <Route
              path="approval-centers"
              element={<SuperadminApprovalCentersPage />}
            />
            <Route path="store-request" element={<SuperadminStoreRequestPage />} />
            <Route
              path="store-request-export"
              element={<SuperadminStoreRequestExportPage />}
            />
          </Route>
        </Route>

      </Route>
      
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

export default App
