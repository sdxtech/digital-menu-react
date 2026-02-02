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
): Promise<T> => {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: buildHeaders(options, accessToken),
  })

  if (!response.ok) {
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

