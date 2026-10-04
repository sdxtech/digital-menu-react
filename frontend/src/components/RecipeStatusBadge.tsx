import {
  getApprovalStatusLabel,
  type ApprovalStatusLabelValue,
} from '../lib/status-labels'

const badgeClass = 'inline-flex rounded-full px-2 py-1 text-xs font-semibold'

export const RecipeStatusBadge = ({
  status,
  isActive,
}: {
  status: 'draft' | 'active'
  isActive?: boolean
}) => {
  const colorClass =
    isActive === false
      ? 'bg-gray-100 text-gray-700'
      : status === 'active'
        ? 'bg-green-100 text-green-800'
        : 'bg-yellow-100 text-yellow-800'

  return (
    <span className={`${badgeClass} ${colorClass}`}>
      {isActive === false ? 'Disabled' : status === 'active' ? 'Active' : 'Draft'}
    </span>
  )
}

export const RecipeApprovalStatusBadge = ({
  status,
}: {
  status: ApprovalStatusLabelValue
}) => {
  const colorClass =
    status === 'approved'
      ? 'bg-green-100 text-green-800'
      : status === 'rejected'
        ? 'bg-red-100 text-red-800'
        : 'bg-gray-100 text-gray-700'

  return (
    <span className={`${badgeClass} ${colorClass}`}>
      {getApprovalStatusLabel(status)}
    </span>
  )
}
