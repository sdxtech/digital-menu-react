import { useState } from 'react'
import ActionButton from '../components/ActionButton'
import { useAuth } from '../lib/auth'
import { apiFetch } from '../lib/api'

const SecurityView = () => {
  // 🌟 Added accessToken here to authorize our password network request securely
  const { accessToken } = useAuth()

  // Local states for the interactive input fields
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null)

  const handlePasswordUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Preliminary UI layout validation rule checks
    if (!currentPassword || !newPassword || !confirmPassword) {
      setMessage({ text: 'Please fulfill all password parameters.', isError: true })
      return
    }

    if (newPassword.length < 6) {
      setMessage({ text: 'New password must be at least 6 characters long.', isError: true })
      return
    }

    if (newPassword !== confirmPassword) {
      setMessage({ text: 'Confirmation entry does not match your new password.', isError: true })
      return
    }

    setIsLoading(true)
    setMessage(null)

    try {
      // 🌟 FIXED: Replaced the fake placeholder with an authentic backend network link
      await apiFetch(
        '/auth/password',
        {
          method: 'PATCH',
          body: JSON.stringify({
            currentPassword,
            newPassword,
          }),
        },
        accessToken || undefined,
      )

      setMessage({ text: 'Password signature verified and altered successfully!', isError: false })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to save password changes.'
      setMessage({ text: errMsg, isError: true })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-100">
      {/* HEADER SECTION */}
      <div>
        <h1 className="text-2xl font-semibold">Security & Password</h1>
        
        {/* Real-time Validation Message Feedback Box Wrapper */}
        {message && (
          <p className={`mt-2 text-xs font-medium ${message.isError ? 'text-red-600' : 'text-emerald-600'}`}>
            {message.text}
          </p>
        )}
      </div>

      {/* SINGLE CONSOLIDATED MASTER CARD FRAME */}
      <div className="rounded-md border border-border bg-surface p-6 shadow-sm">
        <form onSubmit={handlePasswordUpdate} className="space-y-6 max-w-xl">
          
          <h3 className="text-sm font-semibold text-foreground border-b border-border/60 pb-2">
            Update System Authentication Password
          </h3>

          {/* FIELD 1: CURRENT PASSWORD */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted block">
              Current Password
            </label>
            <input
              type="password"
              value={currentPassword}
              disabled={isLoading}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full h-9 px-3 text-sm rounded-md border border-border/60 bg-background transition focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
              placeholder="••••••••"
            />
          </div>

          {/* FIELD 2: NEW PASSWORD */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted block">
              New Password
            </label>
            <input
              type="password"
              value={newPassword}
              disabled={isLoading}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full h-9 px-3 text-sm rounded-md border border-border/60 bg-background transition focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
              placeholder="Minimum 6 characters"
            />
          </div>

          {/* FIELD 3: CONFIRM NEW PASSWORD */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted block">
              Confirm New Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              disabled={isLoading}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full h-9 px-3 text-sm rounded-md border border-border/60 bg-background transition focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
              placeholder="Retype new password"
            />
          </div>

          <div className="pt-2">
            <ActionButton
              action="update"
              type="submit"
              disabled={isLoading}
              size="sm"
            />
          </div>

        </form>
      </div>
    </div>
  )
}

export default SecurityView
