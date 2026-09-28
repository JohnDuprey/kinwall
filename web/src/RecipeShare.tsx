import { useId, useState } from 'react'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import { useDialog } from './dialog.tsx'
import Sheet from './Sheet.tsx'
import { ChevronRight, LinkIcon } from './icons.tsx'
import type { Recipe, RecipeShare as Share } from './meal-types.ts'

/** A parent's "Share recipe" row in the recipe view: makes (or reopens) the recipe's public link and
 * shows it with Copy and Share; Stop sharing turns the link off. */
export default function RecipeShare({ recipe }: { recipe: Recipe }) {
  const { toast } = useApp()
  const dialog = useDialog()
  const id = useId()
  const [share, setShare] = useState<Share | null>(recipe.share ?? null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const start = async () => {
    setBusy(true)
    try { const made = await api.shareRecipe(recipe.id); setShare({ url: made.url, createdAt: made.createdAt }); setOpen(true) }
    catch (e) { toast(e instanceof Error ? e.message : 'Could not make a link.', true) }
    finally { setBusy(false) }
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(share!.url); toast('Link copied') }
    catch { toast('Could not copy. Select the link and copy it.', true) }
  }
  const send = () => navigator.share({ title: recipe.name, url: share!.url }).catch(() => {})
  const stop = async () => {
    if (!await dialog.confirm({ title: 'Stop sharing?', body: 'The link stops working for everyone who has it. Recipes they already saved stay theirs.', confirmLabel: 'Stop sharing', danger: true })) return
    setBusy(true)
    try { await api.unshareRecipe(recipe.id); setShare(null); setOpen(false); toast('Stopped sharing') }
    catch (e) { toast(e instanceof Error ? e.message : 'Could not stop sharing.', true) }
    finally { setBusy(false) }
  }
  const canShare = typeof navigator.share === 'function'
  return <>
    <div className="sheet-links">
      <button type="button" className="sheet-link" disabled={busy} onClick={() => void start()}>
        <LinkIcon /><span>Share recipe<small>{share ? 'Shared: anyone with the link can see it' : 'Make a link anyone can open'}</small></span><ChevronRight />
      </button>
    </div>
    {open && share && <Sheet title="Share recipe" onClose={() => setOpen(false)} dismissable={!busy} actions={<>
      <select className="settings-select actions-select" aria-label="Sharing actions" value="" disabled={busy} onChange={e => { if (e.target.value === 'stop') void stop() }}>
        <option value="" disabled hidden>More…</option>
        <option value="stop">Stop sharing…</option>
      </select>
      <button type="button" className={`btn ${canShare ? 'btn-secondary' : 'btn-primary'}`} onClick={() => void copy()}>Copy link</button>
      {canShare && <button type="button" className="btn btn-primary" onClick={() => void send()}>Share</button>}
    </>}>
      <p>Anyone with this link can see <strong>{recipe.name}</strong>: its photo, ingredients and steps. Not your family's names, ratings, meals or notes.</p>
      <div className="field">
        <label htmlFor={id}>Link</label>
        <input id={id} type="url" readOnly value={share.url} onFocus={e => e.target.select()} />
      </div>
      <p className="field-hint">They can save it to their own Kinwall from the page.</p>
    </Sheet>}
  </>
}
