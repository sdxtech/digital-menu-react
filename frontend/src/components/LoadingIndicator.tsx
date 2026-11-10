type LoadingIndicatorProps = {
  label?: string
  className?: string
}

const LoadingIndicator = ({
  label = 'Loading data...',
  className = '',
}: LoadingIndicatorProps) => (
  <span role="status" className={`inline-flex items-center gap-2 text-xs text-black ${className}`.trim()}>
    <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded-full border-2 border-current border-r-transparent motion-safe:animate-spin" />
    <span>{label}</span>
  </span>
)

export default LoadingIndicator
