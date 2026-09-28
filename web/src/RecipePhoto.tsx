import { useState } from 'react'
import { api } from './api.ts'

/** A recipe's photo (or one step's) through the server's image proxy (the CSP keeps <img> on this origin).
 * Renders nothing in the demo or when the image is missing or fails, so there is never an empty box. */
export default function RecipePhoto({ kind = 'recipes', id, step, className, alt = '' }: { kind?: 'recipes' | 'meals'; id: string; step?: { n: number; v: string }; className: string; alt?: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  const src = step ? api.recipeStepImageUrl(id, step.n, step.v) : api.recipeImageUrl(kind, id)
  if (!src || failed === src) return null
  return <img className={className} src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(src)} />
}
