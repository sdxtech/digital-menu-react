import RecipeCookingMethod from './RecipeCookingMethod'
import { getRecipeSalesRecommendation } from './RecipeSalesRecommendation'
import { RecipeApprovalStatusBadge, RecipeStatusBadge } from './RecipeStatusBadge'
import { formatRecipeVersion } from '../lib/recipe-version'

type RecipeDetail = {
  recipeCode?: string
  name: string
  version?: number
  category: string
  site?: string
  siteName?: string
  portionSize: number
  status: 'draft' | 'active'
  isActive?: boolean
  approvalStatus: 'pending' | 'approved' | 'rejected'
  targetFoodCostPercentage?: number
  foodCostRecipe?: number
  ingredients?: Array<{ qty?: number; priceUom?: number; foodCost?: number }>
  cookingMethod?: string[]
  description?: string
}

export const formatRecipeDetailPrice = (value?: number, fallback = 'Rp. 0') =>
  value === undefined || value === null || !Number.isFinite(Number(value))
    ? fallback
    : new Intl.NumberFormat('id-ID', {
        style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
      }).format(Number(value))

const RecipeDetailOverview = ({ recipe, siteLabel }: { recipe: RecipeDetail; siteLabel?: string }) => {
  const sales = getRecipeSalesRecommendation(recipe)
  const fields = [
    { label: 'Recipe code', value: recipe.recipeCode || '-' },
    { label: 'Recipe status', value: <RecipeStatusBadge status={recipe.status} isActive={recipe.isActive} /> },
    { label: 'Recipe name', value: recipe.name },
    { label: 'Approval status', value: <RecipeApprovalStatusBadge status={recipe.approvalStatus} /> },
    { label: 'Version', value: formatRecipeVersion(recipe.version) },
    { label: 'Base pax', value: recipe.portionSize },
    { label: 'Category', value: recipe.category || '-' },
    { label: 'Target food cost (%)', value: `${sales.targetFoodCostPercentage}%` },
    { label: 'Created from site', value: siteLabel ?? recipe.siteName?.trim() ?? recipe.site?.trim() ?? 'All sites' },
    { label: 'Sales price/pax (recommendation)', value: formatRecipeDetailPrice(sales.salesPricePerPax) },
  ]

  return (
    <>
      <dl className="mt-4 grid gap-px overflow-hidden rounded-md border border-border bg-border lg:grid-cols-2">
        {fields.map(({ label, value }, index) => (
          <div key={label} className={`grid min-h-6 grid-cols-2 ${index % 2 === 1 ? 'order-1 lg:order-none' : ''}`}>
            <dt className="flex items-center justify-between gap-3 bg-primary px-3 py-1 text-xs font-semibold uppercase text-white">
              <span>{label}</span><span aria-hidden="true">:</span>
            </dt>
            <dd
              className={`flex min-w-0 items-center bg-surface px-3 py-1 text-xs font-normal [&>span]:text-xs [&>span]:font-normal ${label === 'Recipe name' ? 'overflow-x-auto whitespace-nowrap' : 'break-words [overflow-wrap:anywhere]'}`}
              title={label === 'Recipe name' ? recipe.name : undefined}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="min-w-0 overflow-hidden rounded-md border border-border">
          <h3 className="border-b border-border bg-background px-4 py-3 text-center font-semibold">COOKING METHOD</h3>
          <div className="p-2 [overflow-wrap:anywhere] [&_ol]:mt-0 [&_ol]:list-inside [&_ol]:pl-0 [&_ol]:text-xs [&_ol]:font-normal">
            {recipe.cookingMethod?.length ? (
              <RecipeCookingMethod steps={recipe.cookingMethod} showHeading={false} />
            ) : (
              <p className="!text-xs font-normal text-muted">No cooking method.</p>
            )}
          </div>
        </section>
        <section className="min-w-0 overflow-hidden rounded-md border border-border">
          <h3 className="border-b border-border bg-background px-4 py-3 text-center font-semibold">DESCRIPTION</h3>
          <p className="whitespace-pre-wrap p-2 !text-xs font-normal text-foreground [overflow-wrap:anywhere]">
            {recipe.description?.trim() || 'No description.'}
          </p>
        </section>
      </div>
    </>
  )
}

export default RecipeDetailOverview
