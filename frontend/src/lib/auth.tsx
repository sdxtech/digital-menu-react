import {
  createContext,
  useEffect,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { apiFetch } from './api'

export type Role = 'chef' | 'unit-manager' | 'storekeeper' | 'superadmin'

export type User = {
  name: string
  email: string
  role: Role
  siteCode?: string
  siteName?: string
}

type AuthContextValue = {
  user: User | null
  accessToken: string | null
  login: (email: string, password: string) => Promise<User>
  logout: () => void
}

const USER_KEY = 'dm-auth-user'
const ACCESS_TOKEN_KEY = 'dm-auth-token'
const REFRESH_TOKEN_KEY = 'dm-auth-refresh-token'

const rolePaths: Record<Role, string> = {
  chef: '/chef',
  'unit-manager': '/unit-manager',
  storekeeper: '/storekeeper',
  superadmin: '/superadmin',
}

const roleLabels: Record<Role, string> = {
  chef: 'Chef',
  'unit-manager': 'Unit Manager',
  storekeeper: 'Storekeeper',
  superadmin: 'Superadmin',
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

const readSessionStorage = (key: string) => {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

const readLocalStorage = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const removeStoredItem = (key: string) => {
  try {
    sessionStorage.removeItem(key)
    localStorage.removeItem(key)
  } catch {
    // ignore storage cleanup errors
  }
}

const writeSessionStorage = (key: string, value: string) => {
  try {
    sessionStorage.setItem(key, value)
    localStorage.removeItem(key)
  } catch {
    // ignore storage write errors
  }
}

export const readStoredToken = (): string | null => {
  return readSessionStorage(ACCESS_TOKEN_KEY) ?? readLocalStorage(ACCESS_TOKEN_KEY)
}

export const readStoredRefreshToken = (): string | null => {
  return readSessionStorage(REFRESH_TOKEN_KEY)
}

const migrateLegacyUserToSession = () => {
  const legacyUser = readLocalStorage(USER_KEY)
  if (!legacyUser) return null
  if (!readStoredToken()) {
    removeStoredItem(USER_KEY)
    return null
  }

  writeSessionStorage(USER_KEY, legacyUser)
  return legacyUser
}

const readStoredUser = (): User | null => {
  try {
    if (!readStoredToken()) {
      removeStoredItem(USER_KEY)
      return null
    }

    const stored = readSessionStorage(USER_KEY) ?? migrateLegacyUserToSession()
    if (!stored) return null
    const parsed = JSON.parse(stored) as Partial<User> & { site?: string }
    if (!parsed?.role || !(parsed.role in rolePaths)) return null
    const email = parsed.email?.trim()
    if (!email) return null

    return {
      name: parsed.name?.trim() || email,
      email,
      role: parsed.role,
      siteCode: parsed.siteCode?.trim() || parsed.site?.trim() || undefined,
      siteName:
        parsed.siteName?.trim() ||
        parsed.siteCode?.trim() ||
        parsed.site?.trim() ||
        undefined,
    }
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
    const {
      accessToken: nextAccessToken,
      refreshToken: nextRefreshToken,
    } = await apiFetch<{
      accessToken: string
      refreshToken?: string
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })

    let nextRole: Role = 'chef'
    let nextName = email
    let nextSiteCode: string | undefined
    let nextSiteName: string | undefined
    try {
      // FRONTEND AUTH: role is provided by backend (/auth/me).
      const me = await apiFetch<{
        name?: string
        roles?: string[]
        appRole?: Role
        site?: string
        siteName?: string
      }>(
        '/auth/me',
        undefined,
        nextAccessToken,
      )
      if (me?.appRole) nextRole = me.appRole as Role
      else if (me?.roles?.includes('superadmin')) nextRole = 'superadmin'
      if (me?.name?.trim()) nextName = me.name.trim()
      if (me?.site?.trim()) nextSiteCode = me.site.trim()
      if (me?.siteName?.trim()) nextSiteName = me.siteName.trim()
    } catch {
      // ignore auth/me failures and use default role
    }

    const nextUser: User = {
      name: nextName,
      email,
      role: nextRole,
      siteCode: nextSiteCode,
      siteName: nextSiteName ?? nextSiteCode,
    }
    setUser(nextUser)
    writeSessionStorage(USER_KEY, JSON.stringify(nextUser))
    setAccessToken(nextAccessToken)
    writeSessionStorage(ACCESS_TOKEN_KEY, nextAccessToken)
    if (nextRefreshToken) {
      writeSessionStorage(REFRESH_TOKEN_KEY, nextRefreshToken)
    } else {
      removeStoredItem(REFRESH_TOKEN_KEY)
    }
    return nextUser
  }

  useEffect(() => {
    const token = readStoredToken()
    if (!token) return

    apiFetch<{
      name?: string
      email?: string
      roles?: string[]
      appRole?: Role
      site?: string
      siteName?: string
    }>('/auth/me', undefined, token)
      .then((me) => {
        setUser((current) => {
          const nextRole =
            me?.appRole ??
            (me?.roles?.includes('superadmin') ? 'superadmin' : current?.role)
          if (!nextRole) return current

          const nextUser: User = {
            name: me?.name?.trim() || current?.name || me?.email?.trim() || '',
            email: me?.email?.trim() || current?.email || '',
            role: nextRole,
            siteCode: me?.site?.trim() || current?.siteCode,
            siteName:
              me?.siteName?.trim() ||
              me?.site?.trim() ||
              current?.siteName ||
              current?.siteCode,
          }

          writeSessionStorage(USER_KEY, JSON.stringify(nextUser))
          return nextUser
        })
      })
      .catch(() => null)
  }, [accessToken])

  const logout = useCallback(() => {
    const token = accessToken ?? readStoredToken()
    if (token) {
      apiFetch('/auth/logout', { method: 'POST' }, token).catch(() => null)
    }
    setUser(null)
    removeStoredItem(USER_KEY)
    setAccessToken(null)
    removeStoredItem(ACCESS_TOKEN_KEY)
    removeStoredItem(REFRESH_TOKEN_KEY)
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

export const roleLabelFor = (role: Role) => roleLabels[role]
