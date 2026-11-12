type Approval = 'pending' | 'approved' | 'rejected'

type MenuStatus = {
  approvalStatus: Approval
  salesInputBy?: string
  financeApprovalRequired?: boolean
  financeCostStatus?: Approval
  financeSalesStatus?: Approval
}

export function getUmBatchStatus(items: MenuStatus[]): Approval | null {
  if (items.some((item) => item.approvalStatus === 'rejected')) return 'rejected'
  if (items.length > 0 && items.every((item) => item.approvalStatus === 'approved')) return 'approved'
  return items.some((item) => item.approvalStatus === 'pending' && item.salesInputBy?.trim())
    ? 'pending'
    : null
}

export function getFinanceBatchStatus(items: MenuStatus[]): Approval | null {
  const required = items.filter((item) => item.financeApprovalRequired)
  if (!required.length) return null
  const hasRejectedDecision = required.some((item) => item.financeCostStatus === 'rejected' || item.financeSalesStatus === 'rejected')
  if (hasRejectedDecision) return 'rejected'
  const hasApprovedDecision = required.some((item) => item.financeCostStatus === 'approved' || item.financeSalesStatus === 'approved')
  if (!hasApprovedDecision && !items.every((item) => item.approvalStatus === 'approved')) return null
  if (required.every((item) => item.financeCostStatus === 'approved' && item.financeSalesStatus === 'approved')) return 'approved'
  return 'pending'
}
