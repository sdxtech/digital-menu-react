import type { ButtonHTMLAttributes } from 'react'

type ActionButtonAction = 'import' | 'cancel' | 'update' | 'save' | 'submit'
type ActionButtonSize = 'sm' | 'md'

type ActionButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children'
> & {
  action: ActionButtonAction
  fullWidth?: boolean
  iconClassName?: string
  size?: ActionButtonSize
}

const actionLabels: Record<ActionButtonAction, string> = {
  import: 'Import',
  cancel: 'Cancel',
  update: 'Update',
  save: 'Save',
  submit: 'Submit',
}

const actionStyles: Record<ActionButtonAction, string> = {
  import: 'border-primary bg-primary text-white shadow-sm hover:bg-primary/90',
  cancel: 'border-red-600 bg-red-600 text-white shadow-sm hover:bg-red-700',
  update:
    'border-emerald-600 bg-emerald-600 text-white shadow-sm hover:bg-emerald-700',
  save: 'border-primary bg-primary text-white shadow-sm hover:bg-primary/90',
  submit: 'border-primary bg-primary text-white shadow-sm hover:bg-primary/90',
}

const sizeStyles: Record<ActionButtonSize, string> = {
  sm: 'px-4 py-2 text-xs',
  md: 'px-4 py-3 text-sm',
}

const ActionButton = ({
  action,
  className = '',
  fullWidth = false,
  iconClassName,
  size = 'md',
  type = 'button',
  ...props
}: ActionButtonProps) => (
  <button
    type={type}
    className={[
      'inline-flex items-center justify-center gap-2 rounded-md border font-semibold disabled:cursor-not-allowed disabled:opacity-60',
      actionStyles[action],
      sizeStyles[size],
      fullWidth ? 'w-full' : '',
      className,
    ]
      .filter(Boolean)
      .join(' ')}
    {...props}
  >
    {iconClassName ? <i className={iconClassName} aria-hidden="true" /> : null}
    <span>{actionLabels[action]}</span>
  </button>
)

export default ActionButton
