const RecipeCookingMethod = ({ steps }: { steps?: string[] }) => {
  if (!steps?.length) return null
  return (
    <div className="mt-4">
      <p className="text-sm font-semibold text-foreground">Cooking Method</p>
      <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-foreground">
        {steps.map((step, index) => <li key={index} className="whitespace-pre-wrap">{step}</li>)}
      </ol>
    </div>
  )
}

export default RecipeCookingMethod
