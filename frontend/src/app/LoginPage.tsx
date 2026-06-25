import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { rolePathFor, useAuth } from '../lib/auth'

const LoginPage = () => {
  const { user, login } = useAuth() /* Menyimpan form login */
  const navigate = useNavigate()
  const [formState, setFormState] = useState({
    email: '',
    password: '',
  })
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false) /* Menyimpan status tampilan password */

  useEffect(() => {
    if (user) {
      navigate(rolePathFor(user.role), { replace: true })
    }
  }, [user, navigate]) /* Jika sudah login, langsung arahkan ke dashboard sesuai peran */

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
  } /* Menangani submit form login, memanggil fungsi login dari context auth, dan menangani error jika login gagal */

  return (
    <AppShell>
      <div className="mx-auto flex min-h-screen w-full max-w-6xl items-center px-6 py-14 lg:px-10">
        <div className="grid w-full grid-cols-1 gap-8 lg:grid-cols-12">
          <section className="lg:col-span-7 flex items-center justify-center">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white p-2 shadow-[0_12px_30px_rgba(11,41,87,0.25)] ring-1 ring-border">
                <img
                  src="/Logo.png"
                  alt="Food Recipe System logo"
                  className="h-full w-full object-contain"
                />
              </div>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                  Food Recipe System
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
                  Sign in to continue to Quick View
                </p>
                <p className="mt-3 text-sm text-muted">
                  Use the email and password registered by the superadmin.
                </p>
              </div>

              {/* Form login dengan input email, password, dan tombol submit. Juga menampilkan error jika login gagal dan opsi untuk menampilkan/menyembunyikan password. */}
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
                  /> {/* Input email dengan state formState.email dan onChange untuk memperbarui state saat pengguna mengetik. */}
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
                    />{/* Input password dengan tipe yang berubah berdasarkan state showPassword, dan onChange untuk memperbarui state saat pengguna mengetik. */}
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-muted transition hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      title={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? (
                        <img 
                          src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='currentColor' class='bi bi-eye-slash' viewBox='0 0 16 16'%3E%3Cpath d='M13.359 11.238C15.06 9.72 16 8 16 8s-3-5.5-8-5.5a7 7 0 0 0-2.79.588l.77.771A6 6 0 0 1 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13 13 0 0 1 14.828 8q-.086.13-.195.288c-.335.48-.83 1.12-1.465 1.755q-.247.248-.517.486z'/%3E%3Cpath d='M11.297 9.176a3.5 3.5 0 0 0-4.474-4.474l.823.823a2.5 2.5 0 0 1 2.829 2.829zm-2.943 1.299.822.822a3.5 3.5 0 0 1-4.474-4.474l.823.823a2.5 2.5 0 0 0 2.829 2.829z'/%3E%3Cpath d='M3.35 5.47q-.27.24-.518.487A13 13 0 0 0 1.172 8l.195.288c.335.48.83 1.12 1.465 1.755C4.121 11.332 5.881 12.5 8 12.5c.716 0 1.39-.133 2.02-.36l.77.772A7 7 0 0 1 8 13.5C3 13.5 0 8 0 8s.939-1.721 2.641-3.238l.708.709zm10.296 8.884-12-12 .708-.708 12 12z'/%3E%3Csvg%3E"
                          alt="Hide password"
                          className="h-5 w-5 opacity-60"
                        />
                      ) : (
                        <img 
                          src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='currentColor' class='bi bi-eye' viewBox='0 0 16 16'%3E%3Cpath d='M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8M1.173 8a13 13 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5s3.879 1.168 5.168 2.457A13 13 0 0 1 14.828 8q-.086.13-.195.288c-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5s-3.879-1.168-5.168-2.457A13 13 0 0 1 1.172 8z'/%3E%3Cpath d='M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5M4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0'/%3E%3C/svg%3E" 
                          alt="Show password"
                          className="h-5 w-5 opacity-60"
                        />
                      )}
                    </button> {/* Tombol untuk menampilkan atau menyembunyikan password, dengan ikon mata yang berubah sesuai status showPassword. */}
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
                  
                  {/* 🌟 FIXED ACTION EVENT TRIGER LINK */}
                  <button 
                    type="button" 
                    onClick={() => navigate('/forgot-password')}
                    className="font-medium text-primary hover:underline bg-transparent border-none p-0 cursor-pointer"
                  >
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
