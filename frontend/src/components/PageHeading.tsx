import { useContext, type HTMLAttributes } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { rolePathFor, useAuth } from '../lib/auth'
import { PageBreadcrumbContext } from '../lib/page-breadcrumb'

type PageHeadingProps = HTMLAttributes<HTMLHeadingElement> & {
  as?: 'h1' | 'h2'
  backTo?: string
  showBack?: boolean
  showBreadcrumb?: boolean
}

const PageHeading = ({ as: Heading = 'h1', backTo, showBack = true, showBreadcrumb = true, children, ...props }: PageHeadingProps) => {
  const navigate = useNavigate()
  const { user } = useAuth()
  const breadcrumb = useContext(PageBreadcrumbContext)

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

  if (showBreadcrumb) {
    return (
      <nav aria-label="Breadcrumb" className="max-w-full min-w-0">
        <ol className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm leading-6">
          {breadcrumb ? (
            <li className="min-w-0">
              <Link
                to={breadcrumb.parent.to}
                className="break-words rounded-sm font-medium text-muted transition hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {breadcrumb.parent.label}
              </Link>
            </li>
          ) : null}
          <li aria-current="page" className="flex min-w-0 items-baseline gap-2">
            {breadcrumb ? <span aria-hidden="true" className="select-none text-muted">/</span> : null}
            <Heading {...props} className="break-words text-sm font-semibold leading-6 text-foreground">
              {breadcrumb && children === breadcrumb.parent.label ? breadcrumb.current.label : children}
            </Heading>
          </li>
        </ol>
      </nav>
    )
  }

  return (
    <div className="flex flex-col items-start">
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
