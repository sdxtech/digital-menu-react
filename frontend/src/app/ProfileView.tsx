import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { apiFetch } from '../lib/api'

const roleLabels: Record<string, string> = {
  chef: 'Chef',
  'unit-manager': 'Unit Manager',
  storekeeper: 'Storekeeper',
  superadmin: 'Superadmin',
}

const ProfileView = () => {
  const { user, accessToken } = useAuth()

  // State management to allow real-time name input modifications
  const [nameInput, setNameInput] = useState(user?.name?.trim() || 'User Name')
  const [isEditing, setIsEditing] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null)

  const emailAddress = user?.email || 'user@example.com'
  const siteLabel = user?.siteName || user?.site || 'No site assigned'
  
  const userRolesArray = user?.roles || (user?.role ? [user.role] : [])
  const primaryRole = userRolesArray[0] || 'unknown'
  const userId = user?.id || ''

  const handleSave = async () => {
    if (!accessToken || !userId) {
      setMessage({ text: 'Unable to update profile. Missing authentication parameters.', isError: true })
      return
    }

    setIsLoading(true)
    setMessage(null)

    try {
      // 🌟 FIXED: Everyone now uses the official shared /auth/profile endpoint
      await apiFetch(
        '/auth/profile',
        {
          method: 'PATCH',
          body: JSON.stringify({
            name: nameInput.trim(),
          }),
        },
        accessToken,
      )

      // Live state sync (Runs for ALL roles: Chef, Storekeeper, Superadmin, etc.)
      if (user) {
        user.name = nameInput.trim()
      }

      // Persist within the local browser storage cache session instance
      const cacheKey = 'dm-auth-user'
      const activeSessionData = sessionStorage.getItem(cacheKey)
      if (activeSessionData) {
        const parsedData = JSON.parse(activeSessionData)
        parsedData.name = nameInput.trim()
        sessionStorage.setItem(cacheKey, JSON.stringify(parsedData))
      }

      setMessage({ text: 'Profile name updated successfully!', isError: false })
      setIsEditing(false)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to save changes.'
      setMessage({ text: errMsg, isError: true })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-100">
      <div>
        <h1 className="text-2xl font-semibold">My Profile</h1>
        {message && (
          <p className={`mt-2 text-xs font-medium ${message.isError ? 'text-red-600' : 'text-emerald-600'}`}>
            {message.text}
          </p>
        )}
      </div>

      <div className="rounded-md border border-border bg-surface p-6 shadow-sm">
        <div className="grid gap-6 md:grid-cols-2">
          
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted block">
              Account Name
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={nameInput}
                disabled={!isEditing || isLoading}
                onChange={(e) => setNameInput(e.target.value)}
                className={`w-full h-9 px-3 text-sm rounded-md border bg-background transition focus:outline-none focus:ring-1 focus:ring-primary ${
                  isEditing 
                    ? 'border-primary shadow-sm text-foreground' 
                    : 'border-border/60 text-foreground/80 cursor-not-allowed bg-muted/20'
                }`}
                placeholder="Enter profile name..."
              />
              {isEditing ? (
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={handleSave}
                  className="h-9 px-4 rounded-md bg-primary text-white text-xs font-semibold shadow-sm hover:bg-primary/90 transition shrink-0 disabled:opacity-50"
                >
                  {isLoading ? 'Saving...' : 'Save'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="h-9 px-3 rounded-md border border-border bg-background text-foreground hover:bg-primary-soft hover:text-primary text-xs font-semibold transition shrink-0"
                >
                  Edit
                </button>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted block">
              Corporate Email Address
            </label>
            <div className="flex items-center h-9 px-3 bg-muted/20 rounded-md border border-border/60 text-sm font-mono text-foreground/70 select-all truncate">
              {emailAddress}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted block">
              Primary Role
            </label>
            <div className="flex items-center h-9 px-3 bg-muted/20 rounded-md border border-border/60 text-sm font-medium text-foreground/70 capitalize">
              {roleLabels[primaryRole] || primaryRole}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted block">
              Assigned Location
            </label>
            <div className="flex items-center h-9 px-3 bg-muted/20 rounded-md border border-border/60 text-sm font-medium text-foreground/70 truncate">
              <i className="bi bi-geo-alt-fill text-primary/60 mr-2 text-xs" />
              {siteLabel}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

export default ProfileView