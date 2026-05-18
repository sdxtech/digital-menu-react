export type ApprovalStatusLabelValue = 'pending' | 'approved' | 'rejected'

export type StoreRequestStatusLabelValue =
  | 'not-requested'
  | 'requested'
  | 'fulfilled'
  | 'cancelled'

export const getApprovalStatusLabel = (status: ApprovalStatusLabelValue) => {
  if (status === 'approved') return 'Approved'
  if (status === 'rejected') return 'Rejected'
  return 'Submitted'
}

export const getStoreRequestStatusLabel = (
  status: StoreRequestStatusLabelValue,
) => {
  if (status === 'fulfilled') return 'Completed'
  if (status === 'cancelled') return 'Cancelled'
  if (status === 'requested') return 'Requested'
  return 'Pending approval'
}
