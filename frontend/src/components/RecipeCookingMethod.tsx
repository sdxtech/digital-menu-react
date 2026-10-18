const RecipeCookingMethod = ({ steps, showHeading = true }: {
  steps?: string[]
  showHeading?: boolean
}) => {
  if (!steps?.length) return null
  return (
    <div className={showHeading ? 'mt-4' : undefined}>
      {showHeading ? <p className="text-sm font-semibold text-foreground">Cooking Method</p> : null}
      <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-foreground">
        {steps.map((step, index) => <li key={index} className="whitespace-pre-wrap">{step}</li>)}
      </ol>
    </div>
  )
}

export default RecipeCookingMethod
