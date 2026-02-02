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
      setError('Email dan password wajib diisi.')
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
          : 'Login gagal. Periksa email dan password.'
      setError(message)
    }
  }

  return (
    <AppShell>
      <div className="mx-auto flex min-h-screen w-full max-w-6xl items-center px-6 py-14 lg:px-10">
        <div className="grid w-full grid-cols-1 gap-8 lg:grid-cols-12">
          <section className="lg:col-span-7">
            <div className="mb-10 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-white shadow-[0_12px_30px_rgba(11,41,87,0.25)]">
                DM
              </div>
              <div>
                <p className="text-sm uppercase tracking-[0.3em] text-muted">
                  Digital Menu
                </p>
                <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                  Bento Grid Admin
                </h1>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div className="group rounded-3xl border border-border bg-surface p-6 shadow-sm animate-fade-up">
                <p className="text-xs uppercase tracking-[0.2em] text-muted">
                  Ringkas
                </p>
                <h2 className="mt-3 text-xl font-semibold">
                  Pantau menu & stok dengan visual bento
                </h2>
                <p className="mt-4 text-sm text-muted">
                  Semua outlet dalam satu tampilan dengan highlight item favorit.
                </p>
              </div>
              <div className="group rounded-3xl border border-border bg-surface p-6 shadow-sm animate-fade-up [animation-delay:120ms]">
                <p className="text-xs uppercase tracking-[0.2em] text-primary">
                  Real-time
                </p>
                <h2 className="mt-3 text-xl font-semibold text-primary">
                  Status pesanan update otomatis
                </h2>
                <p className="mt-4 text-sm text-muted">
                  Tetap sinkron dengan POS tanpa buka banyak tab.
                </p>
              </div>
              <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm sm:col-span-2 animate-fade-up [animation-delay:220ms]">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-muted">
                      Insight cepat
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold">
                      Analitik harian untuk keputusan cepat
                    </h2>
                  </div>
                  <div className="flex items-center gap-3 rounded-2xl border border-border bg-white px-4 py-3 text-sm font-medium text-primary shadow-sm">
                    <span className="h-2 w-2 rounded-full bg-success" />
                    12 Outlet aktif
                  </div>
                </div>
                <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="rounded-2xl bg-background p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-primary">
                      Terlaris
                    </p>
                    <p className="mt-2 text-lg font-semibold">Iced Matcha</p>
                    <p className="text-xs text-muted">+18% minggu ini</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-surface p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-muted">
                      Stok kritis
                    </p>
                    <p className="mt-2 text-lg font-semibold">Oat Milk</p>
                    <p className="text-xs text-muted">Sisa 12 pack</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-surface p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-muted">
                      Rating
                    </p>
                    <p className="mt-2 text-lg font-semibold">4.8/5</p>
                    <p className="text-xs text-muted">2.3k ulasan</p>
                  </div>
                </div>
              </div>
              <div className="rounded-3xl border border-border bg-gradient-to-br from-primary to-accent-indigo p-6 text-white shadow-lg animate-fade-up [animation-delay:320ms]">
                <p className="text-xs uppercase tracking-[0.2em] text-white/70">
                  Kurasi
                </p>
                <h2 className="mt-3 text-xl font-semibold">
                  Tema fleksibel untuk setiap brand
                </h2>
                <p className="mt-4 text-sm text-white/80">
                  Atur warna & layout menu tanpa tim dev tambahan.
                </p>
              </div>
              <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm animate-fade-up [animation-delay:420ms]">
                <p className="text-xs uppercase tracking-[0.2em] text-muted">
                  Aman
                </p>
                <h2 className="mt-3 text-xl font-semibold">
                  Akses berbasis peran
                </h2>
                <p className="mt-4 text-sm text-muted">
                  Operasional, supervisor, hingga owner punya kontrol sesuai peran.
                </p>
              </div>
            </div>
          </section>

          <section className="lg:col-span-5 lg:pl-4">
            <div className="relative rounded-[32px] border border-border bg-surface p-8 shadow-[0_30px_80px_rgba(15,23,42,0.16)] animate-fade-up [animation-delay:150ms]">
              <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-accent-blue/20 blur-2xl" />
              <div className="absolute -bottom-12 -left-8 h-40 w-40 rounded-full bg-accent-cyan/20 blur-3xl" />

              <div className="relative">
                <p className="text-xs uppercase tracking-[0.4em] text-muted">
                  Login
                </p>
                <h2 className="mt-2 text-2xl font-semibold">
                  Masuk ke dashboard Anda
                </h2>
                <p className="mt-3 text-sm text-muted">
                  Gunakan email dan password yang sudah terdaftar oleh admin.
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
                    placeholder="nama@brand.com"
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
                  <input
                    type="password"
                    name="password"
                    placeholder="••••••••"
                    value={formState.password}
                    onChange={(event) =>
                      setFormState((prev) => ({
                        ...prev,
                        password: event.target.value,
                      }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm text-foreground shadow-sm outline-none transition focus:border-accent-indigo focus:ring-4 focus:ring-accent-indigo/20"
                  />
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
                    Ingat saya
                  </label>
                  <button type="button" className="font-medium text-primary">
                    Lupa password?
                  </button>
                </div>
                <button
                  type="submit"
                  className="w-full rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-white shadow-[0_16px_35px_rgba(11,41,87,0.35)] transition hover:bg-primary-hover"
                >
                  Masuk
                </button>
              </form>

              <div className="relative mt-8 rounded-2xl border border-dashed border-border bg-background p-4 text-xs text-muted">
                Butuh akses? Hubungi supervisor untuk aktivasi akun Anda.
              </div>
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  )
}

export default LoginPage
