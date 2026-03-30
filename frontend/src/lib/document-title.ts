import { useEffect } from 'react'
import { matchPath, useLocation } from 'react-router-dom'

const APP_NAME = 'Digital Menu Engineering'

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
    path: '/chef',
    getPageTitle: () => 'Chef Workspace',
  },
  {
    path: '/chef/dashboard',
    getPageTitle: () => 'Dashboard',
  },
  {
    path: '/chef/menu-cycle',
    getPageTitle: () => 'Menu Production',
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
    path: '/unit-manager/menu-production-records',
    getPageTitle: () => 'Menu Production Records',
  },
  {
    path: '/unit-manager/recipe-data',
    getPageTitle: () => 'Recipe Data',
  },
  {
    path: '/storekeeper',
    getPageTitle: () => 'Storekeeper Dashboard',
  },
  {
    path: '/storekeeper/history',
    getPageTitle: () => 'Issuance History',
  },
  {
    path: '/superadmin',
    getPageTitle: () => 'User Management',
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
