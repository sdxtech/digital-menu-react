import { useState } from 'react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuth } from './auth'

const SessionQueryProvider = ({ children }: { children: ReactNode }) => {
  const [client] = useState(
    () => new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 60_000,
          gcTime: 5 * 60_000,
          retry: false,
          refetchOnWindowFocus: false,
        },
      },
    }),
  )
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

export const QueryProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth()
  const scope = user ? [
    user.id,
    user.email,
    user.role,
    user.roles,
    user.site,
    user.siteId,
    user.sites,
  ] : null
  // A new session or permission scope gets its own in-memory server-state cache.
  return (
    <SessionQueryProvider key={JSON.stringify(scope)}>
      {children}
    </SessionQueryProvider>
  )
}
