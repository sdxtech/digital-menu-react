import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  apiFetch,
  AUTH_TOKEN_REFRESHED_EVENT,
} from './api' /* Fungsi untuk melakukan fetch API dengan penanganan token dan error yang sesuai. */

export type Role = 'chef' | 'unit-manager' | 'storekeeper' | 'superadmin'/* Tipe data untuk peran pengguna dalam aplikasi. */

export type User = {
  id?: string
  name?: string
  email: string
  role: Role
  roles?: string[]
  site?: string
  siteId?: string
  siteName?: string
}/* Tipe data untuk informasi pengguna yang disimpan dalam konteks autentikasi. */

type AuthContextValue = {
  user: User | null
  accessToken: string | null
  login: (email: string, password: string) => Promise<User>
  logout: () => void
  updateUser: (updates: Partial<User>) => void
}/* Tipe data untuk nilai yang disediakan oleh konteks autentikasi, termasuk informasi pengguna, token akses, dan fungsi login/logout. */

const USER_KEY = 'dm-auth-user'/* Kunci untuk menyimpan informasi pengguna dalam storage. */
const ACCESS_TOKEN_KEY = 'dm-auth-token'/* Kunci untuk menyimpan token akses dalam storage. */
const REFRESH_TOKEN_KEY = 'dm-auth-refresh-token'/* Kunci untuk menyimpan token refresh dalam storage. */

const rolePaths: Record<Role, string> = {
  chef: '/chef',
  'unit-manager': '/unit-manager',
  storekeeper: '/storekeeper',
  superadmin: '/superadmin',
}/* Pemetaan peran pengguna ke path dashboard yang sesuai. */

const rolePriority: Role[] = ['superadmin', 'unit-manager', 'storekeeper', 'chef']

const isRole = (value?: string): value is Role => {
  return Boolean(value && value in rolePaths)
}/* Fungsi untuk memastikan nilai role yang diterima dari backend termasuk role yang dikenali frontend. */

const resolveRole = (appRole?: string, roles?: string[]): Role | null => {
  if (isRole(appRole)) return appRole
  return rolePriority.find((role) => roles?.includes(role)) ?? null
}/* Fungsi untuk menentukan role utama user berdasarkan data dari backend, tanpa fallback otomatis ke chef. */

const AuthContext = createContext<AuthContextValue | undefined>(undefined)/* Membuat konteks autentikasi dengan tipe AuthContextValue. */

const readSessionStorage = (key: string) => {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}/* Fungsi untuk membaca nilai dari sessionStorage dengan penanganan error. */

const readLocalStorage = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}/* Fungsi untuk membaca nilai dari localStorage dengan penanganan error. */

const removeStoredItem = (key: string) => {
  try {
    sessionStorage.removeItem(key)
    localStorage.removeItem(key)
  } catch {
    // ignore storage cleanup errors
  }
}/* Fungsi untuk menghapus item dari kedua storage (sessionStorage dan localStorage) dengan penanganan error. */

const writeSessionStorage = (key: string, value: string) => {
  try {
    sessionStorage.setItem(key, value)
    localStorage.removeItem(key)
  } catch {
    // ignore storage write errors
  }
}/* Fungsi untuk menulis nilai ke sessionStorage dan menghapus nilai yang sama dari localStorage, dengan penanganan error. */

export const readStoredToken = (): string | null => {
  return readSessionStorage(ACCESS_TOKEN_KEY) ?? readLocalStorage(ACCESS_TOKEN_KEY)
}/* Fungsi untuk membaca token akses yang disimpan, pertama mencoba dari sessionStorage, jika tidak ada baru mencoba dari localStorage (untuk mendukung migrasi dari penyimpanan lama). */

export const readStoredRefreshToken = (): string | null => {
  return readSessionStorage(REFRESH_TOKEN_KEY)
}/* Fungsi untuk membaca token refresh yang disimpan dari sessionStorage. */

const getJwtExpirationTime = (token: string) => {
  try {
    const encodedPayload = token.split('.')[1]
    if (!encodedPayload) return null

    const normalizedPayload = encodedPayload
      .replace(/-/g, '+')
      .replace(/_/g, '/')
    const paddingLength = (4 - (normalizedPayload.length % 4)) % 4
    const payload = JSON.parse(
      window.atob(
        normalizedPayload.padEnd(
          normalizedPayload.length + paddingLength,
          '=',
        ),
      ),
    ) as { exp?: number }
    return Number.isFinite(payload.exp) ? Number(payload.exp) * 1000 : null
  } catch {
    return null
  }
}

const migrateLegacyUserToSession = () => {
  const legacyUser = readLocalStorage(USER_KEY)
  if (!legacyUser) return null
  if (!readStoredToken()) {
    removeStoredItem(USER_KEY)
    return null
  }// Jika ada data pengguna di localStorage tetapi tidak ada token, anggap data tersebut tidak valid dan hapus.

  writeSessionStorage(USER_KEY, legacyUser)
  return legacyUser
}/* Fungsi untuk memigrasi data pengguna yang disimpan di localStorage ke sessionStorage jika token akses masih valid, dan menghapus data lama jika token tidak ditemukan. */

const readStoredUser = (): User | null => {
  try {
    if (!readStoredToken()) {
      removeStoredItem(USER_KEY)
      return null
    }// Jika tidak ada token akses yang valid, anggap data pengguna tidak valid dan hapus.

    const stored = readSessionStorage(USER_KEY) ?? migrateLegacyUserToSession()
    if (!stored) return null
    const parsed = JSON.parse(stored) as User
    if (!parsed?.role || !(parsed.role in rolePaths)) return null
    if (parsed.role !== 'superadmin' && !parsed.site?.trim()) return null
    return parsed
  } catch {
    return null
  }// Fungsi untuk membaca data pengguna yang disimpan, memvalidasi keberadaan token akses, dan memastikan data pengguna memiliki peran dan informasi situs yang valid. Jika valid, kembalikan objek User, jika tidak, kembalikan null.
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(() => readStoredUser())
  const [accessToken, setAccessToken] = useState<string | null>(() =>
    readStoredToken(),
  )/* State untuk menyimpan informasi pengguna dan token akses, dengan nilai awal yang dibaca dari storage. */

  useEffect(() => {
    const syncRefreshedAccessToken = (event: Event) => {
      const nextAccessToken = (event as CustomEvent<string>).detail
      if (nextAccessToken) {
        setAccessToken(nextAccessToken)
      }
    }

    window.addEventListener(
      AUTH_TOKEN_REFRESHED_EVENT,
      syncRefreshedAccessToken,
    )
    return () => {
      window.removeEventListener(
        AUTH_TOKEN_REFRESHED_EVENT,
        syncRefreshedAccessToken,
      )
    }
  }, [])

  const login = async (email: string, password: string) => {
    const {
      accessToken: nextAccessToken,/* Token akses yang diterima dari respons login. */
      refreshToken: nextRefreshToken,/* Token refresh yang diterima dari respons login, jika ada. */
    } = await apiFetch<{
      accessToken: string
      refreshToken?: string
    }>('/auth/login',/* Endpoint untuk login, dengan method POST dan body yang berisi email dan password. Respons diharapkan mengandung token akses dan opsional token refresh. */
      {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })/* Fungsi untuk melakukan login dengan mengirimkan email dan password ke endpoint /auth/login, dan menerima token akses dan refresh token dari respons. */

    let nextRole: Role | null = null/* Peran pengguna hasil validasi dari endpoint /auth/me; jika tidak ada role valid, login akan ditolak. */
    let me: {
      id?: string
      name?: string
      email?: string
      roles?: string[]
      appRole?: Role
      site?: string
      siteId?: string
      siteName?: string
    } | null = null
    // FRONTEND AUTH: role and site scope are verified by backend (/auth/me).
    me = await apiFetch<{
      id?: string
      name?: string
      email?: string
      roles?: string[]
      appRole?: Role
      site?: string
      siteId?: string
      siteName?: string
    }>('/auth/me', undefined, nextAccessToken)
    nextRole = resolveRole(me?.appRole, me?.roles)

    if (!nextRole) {
      throw new Error('Your account does not have an assigned role.')
    }

    if (nextRole !== 'superadmin' && !me?.site?.trim()) {
      throw new Error('Your account does not have an assigned site.')
    }// Setelah login berhasil, ambil informasi pengguna dari endpoint /auth/me uwaitntuk mendapatkan peran dan informasi situs. Validasi bahwa pengguna non-superadmin memiliki situs yang valid.

    const nextUser: User = {
      id: me?.id,
      name: me?.name,
      email: me?.email ?? email,
      role: nextRole,
      roles: me?.roles,
      site: me?.site,
      siteId: me?.siteId,
      siteName: me?.siteName,
    }/* Buat objek User berdasarkan informasi yang diterima dari endpoint /auth/me dan hasil validasi peran. */
    setUser(nextUser)/* Simpan informasi pengguna ke state. */
    writeSessionStorage(USER_KEY, JSON.stringify(nextUser))/* Simpan informasi pengguna ke sessionStorage. */
    setAccessToken(nextAccessToken)/* Simpan token akses ke state. */
    writeSessionStorage(ACCESS_TOKEN_KEY, nextAccessToken)/* Simpan token akses ke sessionStorage. */
    if (nextRefreshToken) {
      writeSessionStorage(REFRESH_TOKEN_KEY, nextRefreshToken)/* Jika refresh token diterima, simpan ke sessionStorage. */
    } else {
      removeStoredItem(REFRESH_TOKEN_KEY)/* Jika tidak ada refresh token, pastikan untuk menghapus token refresh yang mungkin tersisa dari penyimpanan sebelumnya. */
    }
    return nextUser/* Simpan informasi pengguna dan token akses ke state dan storage, dan kembalikan objek User yang baru. */
  }

  const clearAuthentication = useCallback(() => {
    setUser(null)
    removeStoredItem(USER_KEY)
    setAccessToken(null)
    removeStoredItem(ACCESS_TOKEN_KEY)
    removeStoredItem(REFRESH_TOKEN_KEY)
  }, [])

  const logout = useCallback(() => {
    const token = accessToken ?? readStoredToken()
    if (token) {
      apiFetch('/auth/logout', { method: 'POST' }, token).catch(() => null)/* Fungsi untuk melakukan logout, yang mengirimkan permintaan ke endpoint /auth/logout dengan token akses. Jika terjadi error saat logout, error tersebut diabaikan. */
    }
    clearAuthentication()
  }, [accessToken, clearAuthentication])/* Fungsi untuk melakukan logout, yang mengirimkan permintaan ke endpoint /auth/logout, membersihkan state pengguna dan token, serta menghapus data terkait dari storage. */

  useEffect(() => {
    if (!accessToken) return

    const expiresAt = getJwtExpirationTime(accessToken)
    if (!expiresAt) return

    const remainingMs = expiresAt - Date.now()
    if (remainingMs <= 0) {
      clearAuthentication()
      return
    }

    const timeoutId = window.setTimeout(clearAuthentication, remainingMs)
    return () => window.clearTimeout(timeoutId)
  }, [accessToken, clearAuthentication])

  const updateUser = useCallback((updates: Partial<User>) => {
    setUser((current) => {
      if (!current) return current
      const nextUser = { ...current, ...updates }
      writeSessionStorage(USER_KEY, JSON.stringify(nextUser))
      return nextUser
    })
  }, [])

  const value = useMemo(
    () => ({
      user,
      login,
      logout,
      accessToken,
      updateUser,
    }),/* Nilai yang disediakan oleh konteks autentikasi, yang mencakup informasi pengguna, token akses, dan fungsi login/logout. Nilai ini di-memoize untuk menghindari re-render yang tidak perlu pada komponen yang menggunakan konteks ini. */
    [user, accessToken, logout, updateUser],/* Nilai akan di-update jika terjadi perubahan pada informasi pengguna, token akses, atau fungsi logout. */
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>/* Komponen provider untuk konteks autentikasi, yang membungkus anak-anaknya dengan AuthContext.Provider dan menyediakan nilai autentikasi. */
}

export const useAuth = () => {
  const context = useContext(AuthContext)/* Hook untuk mengakses nilai autentikasi dari konteks. Jika hook ini digunakan di luar AuthProvider, akan melempar error. */
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }// Validasi bahwa hook useAuth digunakan di dalam komponen yang dibungkus oleh AuthProvider, jika tidak, lempar error untuk membantu pengembang menemukan kesalahan penggunaan konteks.
  return context
}

export const rolePathFor = (role: Role) => rolePaths[role]/* Fungsi untuk mendapatkan path dashboard yang sesuai berdasarkan peran pengguna. */
