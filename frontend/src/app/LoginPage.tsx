import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { rolePathFor, useAuth } from '../lib/auth'

const LoginPage = () => {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const [formState, setFormState] = useState({
    email: '',
    password: '',
  })
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    if (user) {
      navigate(rolePathFor(user.role), { replace: true })
    }
  }, [user, navigate])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const email = formState.email.trim()
    const password = formState.password.trim()
    if (!email || !password) {
      setError('Email and password are required.')
      return
    }
    try {
      const nextUser = await login(email, password)
      setError('')
      navigate(rolePathFor(nextUser.role), { replace: true })
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Login failed. Check your email and password.'
      setError(message)
    }
  }

  return (
    <AppShell>
      <div className="mx-auto flex min-h-screen w-full max-w-6xl items-center px-6 py-14 lg:px-10">
        <div className="grid w-full grid-cols-1 gap-8 lg:grid-cols-12">
          <section className="lg:col-span-7 flex items-center justify-center">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-white shadow-[0_12px_30px_rgba(11,41,87,0.25)]">
                DM
              </div>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                  Digital Menu Engineering
                </h1>
              </div>
            </div>
          </section>

          <section className="lg:col-span-5 lg:pl-4">
            <div className="relative rounded-[32px] border border-border bg-surface p-8 shadow-[0_30px_80px_rgba(15,23,42,0.16)] animate-fade-up [animation-delay:150ms]">
              <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-accent-blue/20 blur-2xl" />
              <div className="absolute -bottom-12 -left-8 h-40 w-40 rounded-full bg-accent-cyan/20 blur-3xl" />

              <div className="relative">
                <h3 className="text-muted">
                  Login
                </h3>
                <p className="mt-2 text-2xl font-semibold">
                  Sign in to your dashboard
                </p>
                <p className="mt-3 text-sm text-muted">
                  Use the email and password registered by the superadmin.
                </p>
              </div>

              <form className="relative mt-8 space-y-5" onSubmit={handleSubmit}>
                <div>
                  <label className="text-sm font-medium text-foreground">
                    Email
                  </label>
                  <input
                    type="email"
                    name="email"
                    placeholder="name@brand.com"
                    value={formState.email}
                    onChange={(event) =>
                      setFormState((prev) => ({
                        ...prev,
                        email: event.target.value,
                      }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm text-foreground shadow-sm outline-none transition focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/20"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">
                    Password
                  </label>
                  <div className="relative mt-2">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      name="password"
                      placeholder="********"
                      value={formState.password}
                      onChange={(event) =>
                        setFormState((prev) => ({
                          ...prev,
                          password: event.target.value,
                        }))
                      }
                      className="w-full rounded-2xl border border-border bg-white px-4 py-3 pr-12 text-sm text-foreground shadow-sm outline-none transition focus:border-accent-indigo focus:ring-4 focus:ring-accent-indigo/20"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-muted transition hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      title={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? (
                        <i
                          className="bi bi-eye-slash text-lg"
                          aria-hidden="true"
                        />
                      ) : (
                        <i className="bi bi-eye text-lg" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>
                {error ? (
                  <p className="text-xs font-medium text-danger">{error}</p>
                ) : null}
                <div className="flex items-center justify-between text-xs text-muted">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-primary/30"
                    />
                    Remember me
                  </label>
                  <button type="button" className="font-medium text-primary">
                    Forgot password?
                  </button>
                </div>
                <button
                  type="submit"
                  className="w-full rounded-md bg-primary px-4 py-3 text-sm font-semibold text-white shadow-[0_16px_35px_rgba(11,41,87,0.35)] transition hover:bg-primary-hover"
                >
                  Sign in
                </button>
              </form>

              <div className="relative mt-8 rounded-md border border-dashed border-border bg-background p-4 text-xs text-muted">
                Need access? Contact your supervisor to activate your account.
              </div>
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  )
}

export default LoginPage
