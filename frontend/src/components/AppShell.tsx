import type { ReactNode } from 'react'

const AppShell = ({ children }: { children: ReactNode }) => {
  return (
    <div className="relative min-h-screen overflow-hidden bg-primary-soft text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.18),_transparent_45%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_bottom,_rgba(6,182,212,0.14),_transparent_55%)]" />
      <div className="relative">{children}</div>
    </div>
  )
}

export default AppShell
