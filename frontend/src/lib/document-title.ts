import { useEffect } from 'react'
import { matchPath, useLocation } from 'react-router-dom'

const APP_NAME = 'Food Recipe System'

type TitleMatcher = {
  path: string
  getPageTitle: (state: unknown) => string
}

type MenuCreateLocationState = {
  baseRecipe?: {
    id?: string
    name?: string
  }
}

const titleMatchers: TitleMatcher[] = [
  {
    path: '/login',
    getPageTitle: () => 'Login',
  },
  {
    path: '/maintenance',
    getPageTitle: () => 'Maintenance',
  },
  {
    path: '/forgot-password',
    getPageTitle: () => 'Forgot Password',
  },
  {
    path: '/reset-password',
    getPageTitle: () => 'Reset Password',
  },
  {
    path: '/chef',
    getPageTitle: () => 'Chef Workspace',
  },
  {
    path: '/chef/dashboard',
    getPageTitle: () => 'Quick View',
  },
  
  // ➕ Added Profile Tab Title configuration mapping for Chef Workspace
  {
    path: '/chef/profile',
    getPageTitle: () => 'My Profile',
  },
  {
    path: '/chef/security',
    getPageTitle: () => 'Security & Password',
  },

  {
    path: '/chef/menu-cycle',
    getPageTitle: () => 'Menu Production',
  },
  {
    path: '/chef/recipe-calculator',
    getPageTitle: () => 'Calculator Recipe',
  },
  {
    path: '/chef/menu-bank',
    getPageTitle: () => 'Recipe Data',
  },
  {
    path: '/chef/menu-create',
    getPageTitle: (state) => {
      const baseRecipe = (state as MenuCreateLocationState | null)?.baseRecipe
      const recipeName = baseRecipe?.name?.trim()

      if (baseRecipe?.id) {
        return recipeName ? `Edit Recipe: ${recipeName}` : 'Edit Recipe'
      }

      return 'Create New Recipe'
    },
  },
  {
    path: '/chef/raw-material',
    getPageTitle: () => 'Raw Material Data',
  },
  {
    path: '/chef/raw-material/add',
    getPageTitle: () => 'Add Raw Material',
  },
  {
    path: '/chef/raw-material/data',
    getPageTitle: () => 'Raw Material Data',
  },
  {
    path: '/chef/store-request',
    getPageTitle: () => 'Store Request',
  },
  {
    path: '/unit-manager',
    getPageTitle: () => 'Approval Center',
  },
  {
    path: '/corporate-chef',
    getPageTitle: () => 'Recipe Approval',
  },
  {
    path: '/corporate-chef/recipe-data',
    getPageTitle: () => 'Recipe Data',
  },
  {
    path: '/corporate-chef/profile',
    getPageTitle: () => 'My Profile',
  },
  {
    path: '/corporate-chef/security',
    getPageTitle: () => 'Security & Password',
  },
  {
    path: '/corporate-chef/menu-create',
    getPageTitle: () => 'Create New Recipe',
  },

  // ➕ Added Profile Tab Title configuration mapping for Unit Manager Workspace
  {
    path: '/unit-manager/profile',
    getPageTitle: () => 'My Profile',
  },
  {
    path: '/unit-manager/security',
    getPageTitle: () => 'Security & Password',
  },

  {
    path: '/unit-manager/menu-production-records',
    getPageTitle: () => 'Menu Production Records',
  },
  {
    path: '/unit-manager/recipe-data',
    getPageTitle: () => 'Recipe Data',
  },
  {
    path: '/storekeeper',
    getPageTitle: () => 'Quick View',
  },

  // ➕ Added Profile Tab Title configuration mapping for Storekeeper Workspace
  {
    path: '/storekeeper/profile',
    getPageTitle: () => 'My Profile',
  },
  {
    path: '/storekeeper/security',
    getPageTitle: () => 'Security & Password',
  },

  {
    path: '/storekeeper/history',
    getPageTitle: () => 'Issuance History',
  },
  {
    path: '/admin-site/menu-production-history',
    getPageTitle: () => 'Menu Production History',
  },
  {
    path: '/admin-site',
    getPageTitle: () => 'Admin Site Workspace',
  },
  {
    path: '/admin-site/menu-productions',
    getPageTitle: () => 'Menu Production Sales Input',
  },
  {
    path: '/admin-site/profile',
    getPageTitle: () => 'My Profile',
  },
  {
    path: '/admin-site/security',
    getPageTitle: () => 'Security & Password',
  },
  {
    path: '/superadmin',
    getPageTitle: () => 'Quick View',
  },

  // ➕ Added Profile Tab Title configuration mapping for Global Superadmin Workspace
  {
    path: '/superadmin/profile',
    getPageTitle: () => 'My Profile',
  },
  {
    path: '/superadmin/security',
    getPageTitle: () => 'Security & Password',
  },

  {
    path: '/superadmin/users',
    getPageTitle: () => 'User Management',
  },
  {
    path: '/superadmin/sites',
    getPageTitle: () => 'Site Management',
  },
  {
    path: '/superadmin/clients',
    getPageTitle: () => 'Client Management',
  },
  {
    path: '/superadmin/unit-of-measures',
    getPageTitle: () => 'UOM Management',
  },
  {
    path: '/superadmin/menu-management',
    getPageTitle: () => 'Menu Management',
  },
  {
    path: '/superadmin/approval-centers',
    getPageTitle: () => 'Approval Centers',
  },
  {
    path: '/superadmin/store-request',
    getPageTitle: () => 'Store Request',
  },
  {
    path: '/superadmin/store-request-export',
    getPageTitle: () => 'Store Request Export',
  },
]

const formatDocumentTitle = (pageTitle?: string) =>
  pageTitle ? `${pageTitle} | ${APP_NAME}` : APP_NAME

const resolveDocumentTitle = (pathname: string, state: unknown) => {
  if (pathname === '/') {
    return formatDocumentTitle()
  }

  const matchedRoute = titleMatchers.find(({ path }) =>
    matchPath({ path, end: true }, pathname),
  )

  if (!matchedRoute) {
    return formatDocumentTitle('Page Not Found')
  }

  return formatDocumentTitle(matchedRoute.getPageTitle(state))
}

export const useRouteDocumentTitle = () => {
  const location = useLocation()

  useEffect(() => {
    document.title = resolveDocumentTitle(location.pathname, location.state)
  }, [location.pathname, location.state])
}
