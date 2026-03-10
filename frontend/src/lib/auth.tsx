import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { apiFetch } from './api'

export type Role = 'chef' | 'unit-manager' | 'storekeeper' | 'superadmin'

export type User = {
  email: string
  role: Role
}

type AuthContextValue = {
  user: User | null
  accessToken: string | null
  login: (email: string, password: string) => Promise<User>
  logout: () => void
}

const STORAGE_KEY = 'dm-auth-user'
const TOKEN_KEY = 'dm-auth-token'

const rolePaths: Record<Role, string> = {
  chef: '/chef',
  'unit-manager': '/unit-manager',
  storekeeper: '/storekeeper',
  superadmin: '/superadmin',
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

const readStoredUser = (): User | null => {
  try {
    const token =
      sessionStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(TOKEN_KEY)
    if (!token) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }

    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return null
    const parsed = JSON.parse(stored) as User
    if (!parsed?.role || !(parsed.role in rolePaths)) return null
    return parsed
  } catch {
    return null
  }
}

export const readStoredToken = (): string | null => {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(() => readStoredUser())
  const [accessToken, setAccessToken] = useState<string | null>(() =>
    readStoredToken(),
  )

  const login = async (email: string, password: string) => {
    const { accessToken: nextAccessToken } = await apiFetch<{
      accessToken: string
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })

    let nextRole: Role = 'chef'
    try {
      // FRONTEND AUTH: role is provided by backend (/auth/me).
      const me = await apiFetch<{ roles?: string[]; appRole?: Role }>(
        '/auth/me',
        undefined,
        nextAccessToken,
      )
      if (me?.appRole) nextRole = me.appRole as Role
      else if (me?.roles?.includes('superadmin')) nextRole = 'superadmin'
    } catch {
      // ignore auth/me failures and use default role
    }

    const nextUser: User = {
      email,
      role: nextRole,
    }
    setUser(nextUser)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextUser))
    setAccessToken(nextAccessToken)
    sessionStorage.setItem(TOKEN_KEY, nextAccessToken)
    localStorage.removeItem(TOKEN_KEY)
    return nextUser
  }

  const logout = useCallback(() => {
    const token = accessToken ?? readStoredToken()
    if (token) {
      apiFetch('/auth/logout', { method: 'POST' }, token).catch(() => null)
    }
    setUser(null)
    localStorage.removeItem(STORAGE_KEY)
    setAccessToken(null)
    localStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(TOKEN_KEY)
  }, [accessToken])

  const value = useMemo(
    () => ({
      user,
      login,
      logout,
      accessToken,
    }),
    [user, accessToken, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}

export const rolePathFor = (role: Role) => rolePaths[role]
