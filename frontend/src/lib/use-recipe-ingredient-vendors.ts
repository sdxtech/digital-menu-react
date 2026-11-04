import { useEffect, useState } from 'react'
import { apiFetch } from './api'

type RecipeForVendors = {
  site?: string
  siteName?: string
  ingredients?: Array<{ productCode?: string }>
}

export const useRecipeIngredientVendors = (recipe: RecipeForVendors | null, accessToken?: string | null) => {
  const [vendorsByCode, setVendorsByCode] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!recipe || !accessToken) return
    const codes = Array.from(new Set((recipe.ingredients ?? [])
      .map((ingredient) => ingredient.productCode?.trim())
      .filter((code): code is string => Boolean(code))))
    const site = recipe.site?.trim() || recipe.siteName?.trim()
    let active = true
    setVendorsByCode({})
    setError('')
    setLoading(codes.length > 0)

    Promise.all(codes.map(async (code) => {
      const query = site ? `?site=${encodeURIComponent(site)}` : ''
      const prices = await apiFetch<Array<{ vendor?: string }>>(
        `/raw-materials/${encodeURIComponent(code)}/vendor-prices${query}`,
        undefined,
        accessToken,
      )
      return [code, Array.from(new Set(prices.map((price) => price.vendor?.trim()).filter(Boolean))).join(', ')] as const
    }))
      .then((entries) => {
        if (active) setVendorsByCode(Object.fromEntries(entries))
      })
      .catch(() => {
        if (active) setError('Failed to load ingredient vendors.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => { active = false }
  }, [recipe, accessToken])

  return { vendorsByCode, loading, error }
}
