import { useState } from 'react'
import { api } from './api.ts'

/** A recipe's photo through the server's image proxy (the CSP keeps <img> on this origin). Renders
 * nothing in the demo or when the image is missing or fails, so there is never an empty box. */
export default function RecipePhoto({ kind = 'recipes', id, className, alt = '' }: { kind?: 'recipes' | 'meals'; id: string; className: string; alt?: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  const src = api.recipeImageUrl(kind, id)
  if (!src || failed === src) return null
  return <img className={className} src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(src)} />
}
