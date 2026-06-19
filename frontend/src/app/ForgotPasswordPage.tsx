import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'

const ForgotPasswordPage = () => {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null)

  const handleForgotPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) {
      setMessage({ text: 'Please input your registered email address.', isError: true })
      return
    }

    setIsLoading(true)
    setMessage(null)

    try {
      // Connects to a backend utility endpoint we'll create right after this
      await apiFetch('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      })

      setMessage({ 
        text: 'If that email exists in our system, a password recovery link has been dispatched.', 
        isError: false 
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Something went wrong.'
      setMessage({ text: errMsg, isError: true })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#dce4fd] to-[#f4f6fe] flex items-center justify-center p-4">
      <div className="max-w-4xl w-full flex flex-col md:flex-row items-center justify-between gap-8 md:gap-16">
        
        {/* LEFT BRAND SECTION */}
        <div className="flex items-center gap-3 md:flex-1 justify-center md:justify-start">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white p-2 shadow-sm border border-black/5">
            <img
              src="/Logo.png"
              alt="Food Recipe System logo"
              className="h-full w-full object-contain"
            />
          </div>
          <h1 className="text-2xl font-semibold text-slate-800 tracking-tight">
            Food Recipe System
          </h1>
        </div>

        {/* RIGHT FLOATING COMPACT CARD CONTAINER */}
        <div className="bg-white rounded-3xl p-8 shadow-xl border border-white/40 max-w-md w-full animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="mb-6">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">
              Recovery
            </span>
            <h2 className="text-lg font-bold text-slate-900 leading-tight">
              Forgot Password?
            </h2>
            <p className="text-xs text-slate-500 mt-1 leading-normal">
              Enter your corporate email. We'll verify your credentials and send a link to securely update your password.
            </p>
          </div>

          {/* SYSTEM ALERTS IN-FRAME VIEW */}
          {message && (
            <div className={`p-3 rounded-lg mb-4 text-xs font-medium border ${
              message.isError 
                ? 'bg-rose-50 text-rose-600 border-rose-100' 
                : 'bg-emerald-50 text-emerald-700 border-emerald-100'
            }`}>
              {message.text}
            </div>
          )}

          <form onSubmit={handleForgotPasswordSubmit} className="space-y-4">
            {/* INPUT EMAIL FIELD CONTAINER */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 block">
                Email Address
              </label>
              <input
                type="email"
                required
                disabled={isLoading}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full h-10 px-3 text-sm rounded-xl border border-slate-200 bg-[#ebf0fe]/40 transition focus:outline-none focus:ring-2 focus:ring-[#112d60]/20 focus:border-[#112d60] text-slate-900 disabled:opacity-60"
              />
            </div>

            {/* MASTER CTA SUBMIT BUTTON */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-10 mt-2 rounded-xl bg-[#112d60] hover:bg-[#193d7c] text-white text-xs font-semibold shadow-md shadow-blue-900/10 transition active:scale-[0.99] disabled:opacity-50 flex items-center justify-center"
            >
              {isLoading ? 'Verifying Credentials...' : 'Send Recovery Link'}
            </button>
          </form>

          {/* FOOTER LINK BACK TO ACCESS PANEL */}
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

export default ForgotPasswordPage