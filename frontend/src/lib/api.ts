export const apiBaseUrl =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  'http://localhost:3000'

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

const AUTH_STORAGE_KEYS = ['dm-auth-user', 'dm-auth-token']
const TOKEN_KEY = 'dm-auth-token'
let hasRedirected = false
let refreshPromise: Promise<string | null> | null = null

const clearAuthStorage = () => {
  AUTH_STORAGE_KEYS.forEach((key) => {
    localStorage.removeItem(key)
    sessionStorage.removeItem(key)
  })
}

const handleUnauthorized = () => {
  if (hasRedirected) return
  hasRedirected = true
  clearAuthStorage()
  if (
    typeof window !== 'undefined' &&
    !window.location.pathname.startsWith('/login')
  ) {
    window.location.replace('/login')
  }
}

const tryRefreshAccessToken = async () => {
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })
      if (!response.ok) return null

      const data = (await response.json()) as { accessToken?: string }
      const nextAccessToken = data?.accessToken
      if (!nextAccessToken) return null

      sessionStorage.setItem(TOKEN_KEY, nextAccessToken)
      localStorage.removeItem(TOKEN_KEY)
      return nextAccessToken
    } catch {
      return null
    } finally {
      refreshPromise = null
    }
  })()

  return refreshPromise
}

const buildHeaders = (options?: RequestInit, accessToken?: string) => {
  const headers = new Headers(options?.headers ?? {})

  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`)
  }

  const hasBody =
    options?.body !== undefined &&
    options?.body !== null &&
    !(options.body instanceof FormData)
  if (hasBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  return headers
}

export const apiFetch = async <T>(
  path: string,
  options?: RequestInit,
  accessToken?: string,
  allowRefresh = true,
): Promise<T> => {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    credentials: options?.credentials ?? 'include',
    headers: buildHeaders(options, accessToken),
  })

  if (!response.ok) {
    if (response.status === 401 && accessToken && allowRefresh) {
      const refreshedToken = await tryRefreshAccessToken()
      if (refreshedToken) {
        return apiFetch<T>(path, options, refreshedToken, false)
      }
      handleUnauthorized()
    }
    let message = response.statusText
    try {
      const data = (await response.json()) as { message?: string }
      if (data?.message) {
        message = Array.isArray(data.message) ? data.message.join(', ') : data.message
      }
    } catch {
      // ignore parse errors
    }
    throw new ApiError(message, response.status)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}
