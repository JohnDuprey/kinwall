import { useEffect, useRef, useState } from 'react'
import Sheet from './Sheet.tsx'
import { PrinterIcon } from './icons.tsx'
import { IngredientList } from './RecipeSheet.tsx'
import RecipePhoto from './RecipePhoto.tsx'
import { recipeReaderContent } from './recipe-reader.ts'
import { recipeTime, servingsLabel, urlHost } from './meal-date.ts'
import type { Recipe } from './meal-types.ts'
import { t } from './i18n.ts'
import './meals.css'

/** A private reader with the public page's layout. Sheet supplies focus, Escape, browser Back
 * and useBackClose for native Back; opening it never makes a public link. */
export default function RecipeReader({ recipe, servings, printOnOpen = false, onClose }: {
  recipe: Recipe; servings: number; printOnOpen?: boolean; onClose: () => void
}) {
  const shown = recipeReaderContent(recipe)
  const [printing, setPrinting] = useState(printOnOpen)
  const root = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    if (!printing) return
    let canceled = false
    const done = () => { setPrinting(false); if (printOnOpen) close.current() }
    window.addEventListener('afterprint', done)
    // Load every step photo before printing, including those below the fold. A missing photo
    // cannot hold the print dialog indefinitely.
    const images = [...(root.current?.querySelectorAll('img') ?? [])]
    let timer: ReturnType<typeof setTimeout>
    const ready = Promise.all([document.fonts.ready, ...images.map(image => image.decode().catch(() => {}))])
    const timeout = new Promise<void>(resolve => { timer = setTimeout(resolve, 5000) })
    void Promise.race([ready, timeout]).then(() => {
      clearTimeout(timer)
      if (!canceled) window.print()
    })
    return () => { canceled = true; clearTimeout(timer); window.removeEventListener('afterprint', done) }
  }, [printing, printOnOpen])
  const time = recipeTime(shown)
  return <Sheet title={t('Recipe')} variant="full" onClose={onClose}>
    <div className="recipe-reader" ref={root}>
      <div className="recipe-reader-actions"><button type="button" className="btn btn-secondary recipe-print-btn" aria-busy={printing} onClick={() => setPrinting(true)}><PrinterIcon width={20} height={20} /> {t('Print')}</button></div>
      <article>
        {shown.imageUrl && <RecipePhoto id={shown.id} className="recipe-reader-hero" alt={shown.name} loading="eager" />}
        <h1>{shown.name}</h1>
        {shown.description && <p className="recipe-reader-description">{shown.description}</p>}
        <p className="recipe-reader-facts">{[shown.kind === 'basic' && shown.makes ? t('Makes {amount}', { amount: shown.makes }) : servingsLabel(servings), time].filter(Boolean).join(' · ')}</p>
        {shown.ingredients.length > 0 && <><h2>{t('Ingredients')}</h2><IngredientList recipe={shown} servings={servings} /></>}
        {shown.steps.length > 0 && <><h2>{t('Steps')}</h2><ol className="recipe-reader-steps" role="list">
          {shown.steps.map((step, i) => <li key={i}>
            {step.title && <h3>{step.title}</h3>}
            {step.imageUrl && <RecipePhoto id={shown.id} step={{ n: i + 1, v: shown.updatedAt }} className="recipe-reader-step-photo" alt={t('Step {n}', { n: i + 1 })} loading="eager" />}
            {step.text && <p>{step.text}</p>}
            {step.bullets.length > 0 && <ul>{step.bullets.map((bullet, j) => <li key={j}>{bullet}</li>)}</ul>}
          </li>)}
        </ol></>}
        {shown.sourceUrl && <p className="recipe-reader-source"><a href={shown.sourceUrl} target="_blank" rel="noopener noreferrer">{t('Source: {source}', { source: urlHost(shown.sourceUrl) })}</a></p>}
      </article>
    </div>
  </Sheet>
}
