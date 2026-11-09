import { createContext } from 'react'

type BreadcrumbLink = {
  label: string
  to: string
}

type BreadcrumbNavigationItem = BreadcrumbLink & {
  children?: readonly BreadcrumbNavigationItem[]
  breadcrumbPaths?: readonly string[]
}

export type PageBreadcrumb = {
  parent: BreadcrumbLink
  current: BreadcrumbLink
}

export const PageBreadcrumbContext = createContext<PageBreadcrumb | null>(null)

export const resolvePageBreadcrumb = (
  navItems: readonly BreadcrumbNavigationItem[],
  pathname: string,
  search: string,
): PageBreadcrumb | null => {
  const currentPath = pathname.replace(/\/+$/, '') || '/'
  const searchParams = new URLSearchParams(search)
  let defaultBreadcrumb: PageBreadcrumb | null = null

  for (const parent of navItems) {
    for (const child of parent.children ?? []) {
      const [childPath, childSearch = ''] = child.to.split('?')
      const breadcrumb = {
        parent: { label: parent.label, to: parent.to },
        current: { label: child.label, to: child.to },
      }

      if (child.breadcrumbPaths?.includes(currentPath)) return breadcrumb
      if (childPath !== currentPath) continue

      const requiredParams = new URLSearchParams(childSearch)
      if (Array.from(requiredParams).every(([key, value]) => searchParams.get(key) === value)) {
        return breadcrumb
      }

      // Parent links open their default submenu when no valid tab is selected.
      if (child.to === parent.to) defaultBreadcrumb = breadcrumb
    }
  }

  return defaultBreadcrumb
}
