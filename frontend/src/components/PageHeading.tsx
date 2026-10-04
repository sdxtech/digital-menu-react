import type { HTMLAttributes } from 'react'
import { useNavigate } from 'react-router-dom'
import { rolePathFor, useAuth } from '../lib/auth'

type PageHeadingProps = HTMLAttributes<HTMLHeadingElement> & {
  as?: 'h1' | 'h2'
  backTo?: string
  showBack?: boolean
}

const PageHeading = ({ as: Heading = 'h1', backTo, showBack = true, children, ...props }: PageHeadingProps) => {
  const navigate = useNavigate()
  const { user } = useAuth()

  const handleBack = () => {
    if (backTo) {
      navigate(backTo, { replace: true })
      return
    }
    const historyState = window.history.state as { idx?: number } | null
    if (typeof historyState?.idx === 'number' && historyState.idx > 0) {
      navigate(-1)
      return
    }
    navigate(user ? rolePathFor(user.role) : '/login', { replace: true })
  }

  return (
    <div>
      <Heading {...props}>{children}</Heading>
      {showBack ? (
        <button
          type="button"
          onClick={handleBack}
          className="mt-3 inline-flex items-center gap-2 rounded-md border border-border bg-white px-4 py-2 text-xs font-semibold text-foreground hover:bg-background"
        >
          <i className="bi bi-arrow-left" aria-hidden="true" />
          Back
        </button>
      ) : null}
    </div>
  )
}

export default PageHeading
