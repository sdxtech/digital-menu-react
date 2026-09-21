import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'

const ResetPasswordPage = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') // Extracts the secure key from the email link parameters

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState<{
    text: string
    isError: boolean
  } | null>(null)

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!token) {
      setMessage({
        text: 'Invalid or expired recovery session token.',
        isError: true,
      })
      return
    }

    if (newPassword !== confirmPassword) {
      setMessage({
        text: 'Your password entries do not match.',
        isError: true,
      })
      return
    }

    if (newPassword.length < 6) {
      setMessage({
        text: 'Password must contain at least 6 characters.',
        isError: true,
      })
      return
    }

    setIsLoading(true)
    setMessage(null)

    try {
      // Connects to our companion backend reset processing route
      await apiFetch('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, newPassword }),
      })

      setMessage({
        text: 'Password modified successfully! Redirecting to login...',
        isError: false,
      })
      setTimeout(() => navigate('/login'), 3000)
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : 'Failed to reset password.'
      setMessage({ text: errMsg, isError: true })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#dce4fd] to-[#f4f6fe] flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-3xl p-8 shadow-xl border border-white/40 max-w-md w-full animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="mb-6 flex justify-center">
            <img
              src="/SPICES_LOGO_2.png"
              alt="SPICES"
              className="h-14 w-auto object-contain"
            />
          </div>
          <div className="mb-6">
            <h2 className="text-lg font-bold text-slate-900 leading-tight">
              Create New Password
            </h2>
            <p className="text-xs text-slate-500 mt-1 leading-normal">
              Please choose a strong password to re-secure your access profile.
            </p>
          </div>

          {message && (
            <div
              className={`p-3 rounded-lg mb-4 text-xs font-medium border ${
                message.isError
                  ? 'bg-rose-50 text-rose-600 border-rose-100'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-100'
              }`}
            >
              {message.text}
            </div>
          )}

          <form onSubmit={handleResetSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 block">
                New Password
              </label>
              <input
                type="password"
                minLength={6}
                required
                disabled={isLoading || !token}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full h-10 px-3 text-sm rounded-xl border border-slate-200 bg-[#ebf0fe]/40 transition focus:outline-none focus:ring-2 focus:ring-[#112d60]/20 focus:border-[#112d60] text-slate-900 disabled:opacity-60"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 block">
                Confirm New Password
              </label>
              <input
                type="password"
                minLength={6}
                required
                disabled={isLoading || !token}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full h-10 px-3 text-sm rounded-xl border border-slate-200 bg-[#ebf0fe]/40 transition focus:outline-none focus:ring-2 focus:ring-[#112d60]/20 focus:border-[#112d60] text-slate-900 disabled:opacity-60"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading || !token}
              className="w-full h-10 mt-2 rounded-xl bg-[#112d60] hover:bg-[#193d7c] text-white text-xs font-semibold shadow-md shadow-blue-900/10 transition active:scale-[0.99] disabled:opacity-50 flex items-center justify-center"
            >
              {isLoading ? 'Updating Password...' : 'Reset Password'}
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-slate-100 text-center">
            <button
              type="button"
              onClick={() => navigate('/login')}
              className="text-xs font-semibold text-[#112d60] hover:underline bg-transparent border-none p-0 cursor-pointer"
            >
              <i className="bi bi-arrow-left mr-1.5" />
              Back to Sign In
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ResetPasswordPage
