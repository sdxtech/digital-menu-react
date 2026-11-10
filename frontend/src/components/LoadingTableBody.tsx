import { useState, type ReactNode } from 'react'
import LoadingIndicator from './LoadingIndicator'

type LoadingTableBodyProps = {
  loading: boolean
  columns: number
  rowCount: number
  pageSize?: number
  label?: string
  error?: string | null
  onRetry?: () => void
  preserveOnRefresh?: boolean
  children: ReactNode
}

// Key this component by the applied page/filters so new queries show skeletons.
const LoadingTableBody = ({
  loading,
  columns,
  rowCount,
  pageSize = 10,
  label = 'Loading data...',
  error,
  onRetry,
  preserveOnRefresh = true,
  children,
}: LoadingTableBodyProps) => {
  const [previousLoading, setPreviousLoading] = useState(loading)
  const [hasLoaded, setHasLoaded] = useState(false)

  if (previousLoading !== loading) {
    setPreviousLoading(loading)
    if (!loading) setHasLoaded(true)
  }

  const refreshing = loading && preserveOnRefresh && hasLoaded && rowCount > 0
  const skeletonRows = rowCount > 0 ? Math.min(rowCount, pageSize) : pageSize

  return (
    <>
      {loading ? (
        <tbody>
          <tr>
            <td colSpan={columns} className="px-4 py-3 text-center">
              <LoadingIndicator label={refreshing ? 'Updating data...' : label} />
            </td>
          </tr>
        </tbody>
      ) : null}
      <tbody aria-busy={loading} inert={loading || undefined}>
        {loading && !refreshing
          ? Array.from({ length: skeletonRows }, (_, rowIndex) => (
              <tr key={rowIndex} aria-hidden="true" className="border-t border-border">
                {Array.from({ length: columns }, (_, columnIndex) => (
                  <td key={columnIndex} className="px-4 py-4">
                    <span
                      className="dm-table-skeleton block h-3 rounded"
                      style={{
                        width: columnIndex === 0 ? '1.25rem' : `${55 + ((rowIndex + columnIndex) % 4) * 10}%`,
                        minWidth: columnIndex === 0 ? '1.25rem' : '2.5rem',
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))
          : children}
      </tbody>
      {!loading && error && onRetry ? (
        <tbody>
          <tr>
            <td colSpan={columns} className="px-4 py-3 text-center">
              <button type="button" onClick={onRetry}
                className="rounded-md border border-border bg-surface px-3 py-2 text-xs font-semibold text-primary hover:bg-background">
                Try again
              </button>
            </td>
          </tr>
        </tbody>
      ) : null}
    </>
  )
}

export default LoadingTableBody
