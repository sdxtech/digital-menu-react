type TablePaginationProps = {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  loading?: boolean
  summary?: string
  className?: string
}

const TablePagination = ({
  page,
  totalPages,
  onPageChange,
  loading = false,
  summary,
  className = '',
}: TablePaginationProps) => {
  const safeTotalPages = Math.max(1, totalPages)
  const safePage = Math.min(Math.max(1, page), safeTotalPages)

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 text-xs ${className}`.trim()}
    >
      <span className="text-muted">{summary ?? ''}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, safePage - 1))}
          disabled={safePage <= 1 || loading}
          className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          Prev
        </button>
        <span className="text-xs font-semibold text-foreground">
          Page {safePage} / {safeTotalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(safeTotalPages, safePage + 1))}
          disabled={safePage >= safeTotalPages || loading}
          className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          Next
        </button>
      </div>
    </div>
  )
}

export default TablePagination
