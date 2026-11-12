type Approval = 'pending' | 'approved' | 'rejected'

type MenuStatus = {
  approvalStatus: Approval
  financeApprovalRequired?: boolean
  financeCostStatus?: Approval
  financeSalesStatus?: Approval
}

export function getUmBatchStatus(items: MenuStatus[]): Approval {
  if (items.some((item) => item.approvalStatus === 'rejected')) return 'rejected'
  if (items.length > 0 && items.every((item) => item.approvalStatus === 'approved')) return 'approved'
  return 'pending'
}

export function getFinanceBatchStatus(items: MenuStatus[]): Approval | null {
  const required = items.filter((item) => item.financeApprovalRequired)
  if (!required.length) return null
  if (required.some((item) => item.financeCostStatus === 'rejected' || item.financeSalesStatus === 'rejected')) return 'rejected'
  if (required.every((item) => item.financeCostStatus === 'approved' && item.financeSalesStatus === 'approved')) return 'approved'
  return 'pending'
}
