// Medicine refills (routes/medication-refills.ts on the server):
// - RefillsCard: the medicines page's "Refills" card: Request refill per medicine, and the open
//   "Request refill" to-dos with How to ask and Done, requested;
// - RefillSheet: the refill card: where to ask (app, website, phone with the phone menu and a Call link
//   that dials it), and what to say on the message, read-aloud size, with Copy;
// - RefillFields: the medicine sheet's Refills part (parent devices): where to ask, pharmacy, date of
//   birth, callback number and a reminder day; RefillPlaceSheet adds or changes a refill place, with
//   PhoneMenuEditor for its phone menu (steps, never typed commas).
import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { api, ApiError } from './api.ts'
import { useApp } from './AppContext.tsx'
import { useDialog } from './dialog.tsx'
import { announce } from './a11y.tsx'
import Sheet from './Sheet.tsx'
import { stepsToDial, stepsToWords, telUri, type DialStep } from './dialSteps.ts'
import type { Contact } from './contact-types.ts'
import type { Medication, MedicationRefill, Member, RefillCard, RefillContact, RefillContactInput } from './types.ts'

const medLabel = (m: Medication) => (m.dose ? `${m.name} · ${m.dose}` : m.name)
const since = (at: string) => format(new Date(at), 'EEE, MMM d')

/** Ask for a refill: opens the to-do (one per medicine) and says so. */
async function startRefill(m: Medication, memberName: string, toast: (s: string, error?: boolean) => void): Promise<boolean> {
  try {
    const r = await api.refillRequest(m.id, 'open')
    const said = r.created ? `Added to do: Request refill: ${m.name} for ${memberName}` : 'This refill is already on the to-do list.'
    toast(said); announce(said)
    return true
  } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't save that", true); return false }
}

/** `openId`/`setOpenId`: the medicine whose refill card is open, kept by the page (this card moves to
 *  the top once a to-do opens, which mounts it anew). */
export function RefillsCard({ meds, member, onChanged, openId, setOpenId }: { meds: Medication[]; member: Member; onChanged: () => void; openId: string | null; setOpenId: (id: string | null) => void }) {
  const { toast } = useApp()
  const open = meds.find(m => m.id === openId) ?? null
  const setOpen = (m: Medication | null) => setOpenId(m?.id ?? null)
  const [busy, setBusy] = useState<string | null>(null)
  const request = async (m: Medication) => {
    setBusy(m.id)
    if (await startRefill(m, member.name, toast)) { setOpen(m); onChanged() }
    setBusy(null)
  }
  const done = async (m: Medication) => {
    setBusy(m.id)
    try { await api.refillRequest(m.id, 'done'); toast('Marked requested ✓'); announce('Marked requested'); onChanged() } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't save that", true) }
    setBusy(null)
  }
  const sorted = [...meds].sort((a, b) => Number(!!b.refillRequest) - Number(!!a.refillRequest))
  return (
    <section className="board-card" aria-labelledby="meds-refills">
      <h3 id="meds-refills" className="snap-heading">Refills</h3>
      <ul className="meds-today">
        {sorted.map(m => (
          <li key={m.id} className="meds-today-row refill-row">
            <span className="meds-today-what">
              {m.refillRequest ? <>📝 Request refill: {m.name} for {member.name}<span className="refill-since">To do since {since(m.refillRequest.at)}</span></> : medLabel(m)}
            </span>
            <div className="meds-now-actions meds-catch-up" role="group" aria-label={m.name}>
              {m.refillRequest
                ? <>
                    <button className="btn btn-secondary" disabled={busy === m.id} onClick={() => setOpen(m)}>How to ask</button>
                    <button className="btn btn-primary" disabled={busy === m.id} onClick={() => done(m)}>Done, requested</button>
                  </>
                : <button className="btn btn-secondary" disabled={busy === m.id} onClick={() => request(m)}>Request refill</button>}
            </div>
          </li>
        ))}
      </ul>
      {open && <RefillSheet med={open} member={member} onClose={() => setOpen(null)} onDone={() => { setOpen(null); onChanged() }} />}
    </section>
  )
}

export function RefillSheet({ med, member, onClose, onDone }: { med: Medication; member: Member; onClose: () => void; onDone: () => void }) {
  const { toast, parentDevice } = useApp()
  const [card, setCard] = useState<RefillCard | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api.getRefillCard(med.id).then(setCard).catch(e => setError(e instanceof ApiError ? e.message : "Couldn't open the refill card."))
  }, [med.id])
  const copy = async () => {
    try { await navigator.clipboard.writeText(card!.script); toast('Message copied') } catch { toast("Couldn't copy the message.", true) }
  }
  const done = async () => {
    try { await api.refillRequest(med.id, 'done'); toast('Marked requested ✓'); onDone() } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't save that", true) }
  }
  const c = card?.contact
  return (
    <Sheet title={`Refill: ${med.name}`} onClose={onClose}
      actions={card?.request ? <button className="btn btn-primary" onClick={done}>Done, requested</button> : undefined}>
      {error && <p className="snap-empty" role="alert">{error}</p>}
      {!card && !error && <p className="snap-empty">Loading…</p>}
      {card && <>
        {card.request && <p className="refill-todo">📝 To do: Request refill: {med.name} for {member.name}. Tap <strong>Done, requested</strong> once you've asked.</p>}
        {!c && <p className="snap-dim">No place to ask for refills yet.{parentDevice ? ' Add one under Refills when you edit this medicine (Trackers → Health).' : ' A grown-up can add one.'}</p>}
        {c && <>
          <h4 className="refill-place">{c.name}</h4>
          {(c.appName || c.appLink) && <div className="refill-way">
            <span className="refill-way-label">📱 {c.appName ? `Ask in ${c.appName}` : 'Ask in the app'}</span>
            {c.appLink && <a className="btn btn-secondary refill-btn" href={c.appLink} target="_blank" rel="noreferrer">Open app</a>}
          </div>}
          {c.website && <div className="refill-way">
            <span className="refill-way-label">🌐 Ask on the website</span>
            <a className="btn btn-secondary refill-btn" href={c.website} target="_blank" rel="noreferrer">Open website</a>
          </div>}
          {card.call && <div className="refill-way refill-call">
            <span className="refill-way-label">📞 Call <strong>{card.call.number}</strong></span>
            <a className="btn btn-primary refill-btn" href={card.call.telUri}>Call</a>
            {card.call.steps && <p className="refill-steps">Phone menu: {card.call.steps}</p>}
            {c.dialDigits && <p className="field-hint">Call presses the menu for you on most phones. If yours doesn't, press the steps yourself.</p>}
          </div>}
        </>}
        {card.pharmacy && <div className="refill-way">
          <span className="refill-way-label">💊 Pharmacy: <strong>{card.pharmacy.name}</strong>{card.pharmacy.address && <span className="refill-since">{card.pharmacy.address}</span>}</span>
          {card.pharmacy.telUri && <a className="btn btn-secondary refill-btn" href={card.pharmacy.telUri} aria-label={`Call ${card.pharmacy.name}`}>Call</a>}
          {card.pharmacy.address && <a className="btn btn-secondary refill-btn" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(card.pharmacy.address)}`} aria-label={`Map to ${card.pharmacy.name}`}>Map</a>}
        </div>}
        <div className="refill-script-head">
          <h4 className="refill-place">What to say</h4>
          <button className="btn btn-secondary refill-btn" onClick={copy}>Copy</button>
        </div>
        <p className="refill-script">{card.script}</p>
        {card.script.includes('[') && <p className="field-hint">Anything in [brackets] isn't saved yet. Say it yourself, or add it when you edit the medicine.</p>}
      </>}
    </Sheet>
  )
}

/** The medicine sheet's Refills part. `siblings`: the person's other medicines, to start a new one's details from. */
export function RefillFields({ refill, onChange, siblings }: { refill: MedicationRefill; onChange: (r: MedicationRefill) => void; siblings: Medication[] }) {
  const [places, setPlaces] = useState<RefillContact[]>([])
  const [editing, setEditing] = useState<RefillContact | 'new' | null>(null)
  const [contacts, setContacts] = useState<Contact[]>([])
  useEffect(() => {
    api.getRefillContacts().then(setPlaces).catch(() => setPlaces([]))
    api.getContacts().then(setContacts).catch(() => setContacts([]))
  }, [])
  const { pharmacies, services } = pharmacyChoices(contacts)
  const picked = contacts.find(x => x.id === refill.pharmacyContactId)
  const set = (p: Partial<MedicationRefill>) => onChange({ ...refill, ...p })
  const from = siblings.find(s => s.refill.dateOfBirth || s.refill.pharmacy || s.refill.callback)
  const blank = !refill.contactId && !refill.pharmacy && !refill.dateOfBirth && !refill.callback
  const place = places.find(p => p.id === refill.contactId)
  return (
    <fieldset className="field meds-times refill-fields">
      <legend>Refills <span className="settings-row-sub">(optional)</span></legend>
      {blank && from && <button type="button" className="btn btn-secondary" onClick={() => set({ contactId: from.refill.contactId, pharmacyContactId: from.refill.pharmacyContactId, pharmacy: from.refill.pharmacy, dateOfBirth: from.refill.dateOfBirth, callback: from.refill.callback })}>Same as {from.name}</button>}
      <label className="refill-label" htmlFor="refill-place">Ask for refills at</label>
      <div className="meds-time-row">
        <select id="refill-place" className="settings-select" value={refill.contactId ?? ''} onChange={e => (e.target.value === 'new' ? setEditing('new') : set({ contactId: e.target.value || null }))}>
          <option value="">Not set</option>
          {places.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value="new">Add a place…</option>
        </select>
        {place && <button type="button" className="btn btn-secondary" onClick={() => setEditing(place)}>Edit place</button>}
      </div>
      <label className="refill-label" htmlFor="refill-pharmacy">Pharmacy</label>
      <select id="refill-pharmacy" className="settings-select" value={refill.pharmacyContactId ?? ''}
        onChange={e => { const c = contacts.find(x => x.id === e.target.value); set(c ? { pharmacyContactId: c.id, pharmacy: c.name } : { pharmacyContactId: null }) }}>
        <option value="">Not in contacts: type its name</option>
        {pharmacies.length > 0 && <optgroup label="Pharmacies">{pharmacies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>}
        {services.length > 0 && <optgroup label="Other places in contacts">{services.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>}
        {refill.pharmacyContactId && !picked && <option value={refill.pharmacyContactId}>{refill.pharmacy || 'A contact'}</option>}
      </select>
      {!refill.pharmacyContactId && <input aria-label="Pharmacy name" type="text" maxLength={120} value={refill.pharmacy} onChange={e => set({ pharmacy: e.target.value })} placeholder="The pharmacy on Main Street" autoComplete="off" className="refill-second" />}
      <label className="refill-label" htmlFor="refill-dob">Date of birth</label>
      <input id="refill-dob" type="date" value={refill.dateOfBirth ?? ''} onChange={e => set({ dateOfBirth: e.target.value || null })} />
      <label className="refill-label" htmlFor="refill-callback">Callback number</label>
      <input id="refill-callback" type="tel" maxLength={30} value={refill.callback} onChange={e => set({ callback: e.target.value })} placeholder="555-010-4400" autoComplete="off" />
      <label className="refill-label" htmlFor="refill-remind">Remind me to ask on <span className="settings-row-sub">(optional)</span></label>
      <input id="refill-remind" type="date" value={refill.remindOn ?? ''} onChange={e => set({ remindOn: e.target.value || null })} />
      <p className="field-hint">Used for the refill message. Kept encrypted, like the rest of this medicine.</p>
      {editing && <RefillPlaceSheet place={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
        onSaved={p => { setPlaces(ps => [...ps.filter(x => x.id !== p.id), p]); set({ contactId: p.id }); setEditing(null) }}
        onDeleted={id => { setPlaces(ps => ps.filter(x => x.id !== id)); if (refill.contactId === id) set({ contactId: null }); setEditing(null) }} />}
    </fieldset>
  )
}

/** Pharmacies first (named like one, or made from the Pharmacy template: relationship "Medical"), then other services and organizations. */
function pharmacyChoices(contacts: Contact[]) {
  const isPharmacy = (c: Contact) => /pharm|drug|apothec/i.test([c.name, c.organization, c.relationship, ...(c.tags ?? [])].join(' ')) || c.relationship === 'Medical'
  const pharmacies = contacts.filter(isPharmacy)
  return { pharmacies, services: contacts.filter(c => !isPharmacy(c) && (c.kind === 'service' || c.kind === 'organization')) }
}

// A new place's phone menu starts as "Wait 2 seconds, then press …"; a press with no keys is dropped on save.
const STARTER: DialStep[] = [{ kind: 'wait', seconds: 2 }, { kind: 'press', digits: '' }]
const usable = (steps: DialStep[]) => steps.filter(s => s.kind !== 'press' || s.digits).map(s => ({ ...s, label: s.label?.trim() || undefined }))
const KIND_NAMES: Record<DialStep['kind'], string> = { wait: 'Wait', press: 'Press', confirm: 'Wait for me' }

/** The phone menu, step by step (no typing commas): wait, press keys, or wait for me; each with an
 *  optional label, moved up and down. Under it, the steps in words, the dial string and Try it. */
function PhoneMenuEditor({ steps, onChange, phone }: { steps: DialStep[]; onChange: (s: DialStep[]) => void; phone: string }) {
  const put = (i: number, s: DialStep) => onChange(steps.map((x, j) => (j === i ? s : x)))
  const move = (i: number, by: number) => { const next = [...steps]; [next[i], next[i + by]] = [next[i + by], next[i]]; onChange(next) }
  const kindOf = (k: DialStep['kind'], label?: string): DialStep => (k === 'wait' ? { kind: k, seconds: 2, label } : k === 'press' ? { kind: k, digits: '', label } : { kind: k, label })
  const ready = usable(steps)
  const dial = stepsToDial(ready)
  const tel = telUri(phone, dial)
  return (
    <fieldset className="field meds-times dial-editor">
      <legend>Phone menu <span className="settings-row-sub">(optional)</span></legend>
      <ol className="dial-steps">
        {steps.map((s, i) => (
          <li key={i} className="dial-step">
            <div className="meds-time-row">
              <span className="dial-step-n" aria-hidden="true">{i + 1}</span>
              <select className="settings-select" aria-label={`Step ${i + 1}`} value={s.kind} onChange={e => put(i, kindOf(e.target.value as DialStep['kind'], s.label))}>
                {(['wait', 'press', 'confirm'] as const).map(k => <option key={k} value={k}>{KIND_NAMES[k]}</option>)}
              </select>
              {s.kind === 'wait' && <div className="dial-stepper" role="group" aria-label={`Step ${i + 1}: seconds`}>
                <button type="button" className="btn btn-secondary" aria-label="1 second less" disabled={s.seconds <= 1} onClick={() => put(i, { ...s, seconds: s.seconds - 1 })}>−</button>
                <span className="dial-seconds" aria-live="polite">{s.seconds} s</span>
                <button type="button" className="btn btn-secondary" aria-label="1 second more" disabled={s.seconds >= 60} onClick={() => put(i, { ...s, seconds: s.seconds + 1 })}>+</button>
              </div>}
              {s.kind === 'press' && <input type="text" inputMode="tel" maxLength={20} aria-label={`Step ${i + 1}: keys to press`} placeholder="2" value={s.digits}
                onChange={e => put(i, { ...s, digits: e.target.value.replace(/[^0-9*#]/g, '') })} className="dial-keys" />}
              {s.kind === 'confirm' && <span className="field-hint dial-confirm">Your phone asks before going on.</span>}
            </div>
            <div className="meds-time-row">
              <input type="text" maxLength={40} aria-label={`Step ${i + 1}: label`} placeholder="Label, like Prescriptions" value={s.label ?? ''} onChange={e => put(i, { ...s, label: e.target.value })} className="dial-label" />
              <button type="button" className="btn btn-secondary" aria-label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button type="button" className="btn btn-secondary" aria-label={`Move step ${i + 1} down`} disabled={i === steps.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button type="button" className="btn btn-secondary" aria-label={`Remove step ${i + 1}`} onClick={() => onChange(steps.filter((_, j) => j !== i))}>✕</button>
            </div>
          </li>
        ))}
      </ol>
      {steps.length < 20 && <div className="settings-inline-btns">
        <button type="button" className="btn btn-secondary" onClick={() => onChange([...steps, kindOf('wait')])}>+ Wait</button>
        <button type="button" className="btn btn-secondary" onClick={() => onChange([...steps, kindOf('press')])}>+ Press</button>
        <button type="button" className="btn btn-secondary" onClick={() => onChange([...steps, kindOf('confirm')])}>+ Wait for me</button>
      </div>}
      {ready.length > 0 && <div className="dial-preview">
        <p className="refill-steps">{stepsToWords(ready)}</p>
        <div className="refill-way">
          <code className="dial-string">{tel ? decodeURIComponent(tel.slice(4)) : dial}</code>
          {tel && <a className="btn btn-secondary refill-btn" href={tel}>Try it</a>}
        </div>
        {!tel && <p className="field-hint">Add the phone number above to try it.</p>}
      </div>}
    </fieldset>
  )
}

function RefillPlaceSheet({ place, onClose, onSaved, onDeleted }: { place: RefillContact | null; onClose: () => void; onSaved: (p: RefillContact) => void; onDeleted: (id: string) => void }) {
  const { toast } = useApp()
  const dialog = useDialog()
  const [f, setF] = useState<RefillContactInput>({ name: place?.name ?? '', appName: place?.appName ?? '', appLink: place?.appLink ?? '', website: place?.website ?? '', phone: place?.phone ?? '', menu: place?.menu.length ? place.menu : STARTER, script: place?.script ?? '' })
  const set = (p: Partial<RefillContactInput>) => setF(x => ({ ...x, ...p }))
  const save = async () => {
    try {
      const body: RefillContactInput = { ...f, name: f.name.trim(), appName: f.appName.trim(), appLink: f.appLink.trim(), website: f.website.trim(), phone: f.phone.trim(), script: f.script.trim(), menu: usable(f.menu) }
      const saved = place ? await api.updateRefillContact(place.id, body) : await api.addRefillContact(body)
      toast(`Saved: ${saved.name}`); onSaved(saved)
    } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't save that", true) }
  }
  const more = async (action: string) => {
    if (action !== 'delete' || !place) return
    if (!await dialog.confirm({ title: `Delete ${place.name}?`, body: 'Medicines that use it keep their pharmacy and other refill details.', confirmLabel: 'Delete', danger: true })) return
    try { await api.deleteRefillContact(place.id); toast(`Deleted: ${place.name}`); onDeleted(place.id) } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't delete that", true) }
  }
  return (
    <Sheet title={place ? `Edit ${place.name}` : 'New place for refills'} onClose={onClose}
      actions={<>
        {place && <select className="settings-select" aria-label="More" value="" onChange={e => more(e.target.value)}><option value="">More…</option><option value="delete">Delete place</option></select>}
        <button className="btn btn-primary" onClick={save} disabled={!f.name.trim()}>Save</button>
      </>}>
      <div className="field">
        <label htmlFor="rp-name">Name</label>
        <input id="rp-name" type="text" maxLength={80} value={f.name} onChange={e => set({ name: e.target.value })} placeholder="Doctor's office or pharmacy" autoComplete="off" />
        <p className="field-hint">Several medicines can use the same place.</p>
      </div>
      <div className="field">
        <label htmlFor="rp-app">App <span className="settings-row-sub">(optional)</span></label>
        <input id="rp-app" type="text" maxLength={60} value={f.appName} onChange={e => set({ appName: e.target.value })} placeholder="The patient portal app" autoComplete="off" />
        <input aria-label="Link to the app's refill page" type="url" maxLength={500} value={f.appLink} onChange={e => set({ appLink: e.target.value })} placeholder="https://… (link to the refill page)" autoComplete="off" className="refill-second" />
      </div>
      <div className="field">
        <label htmlFor="rp-web">Website <span className="settings-row-sub">(optional)</span></label>
        <input id="rp-web" type="url" maxLength={500} value={f.website} onChange={e => set({ website: e.target.value })} placeholder="https://…" autoComplete="off" />
      </div>
      <div className="field">
        <label htmlFor="rp-phone">Phone number <span className="settings-row-sub">(optional)</span></label>
        <input id="rp-phone" type="tel" maxLength={30} value={f.phone} onChange={e => set({ phone: e.target.value })} placeholder="555-010-3300" autoComplete="off" />
      </div>
      <PhoneMenuEditor steps={f.menu} onChange={menu => set({ menu })} phone={f.phone} />
      <div className="field">
        <label htmlFor="rp-script">What to say <span className="settings-row-sub">(optional)</span></label>
        <textarea id="rp-script" rows={5} maxLength={1000} value={f.script} onChange={e => set({ script: e.target.value })} placeholder="Leave empty for the usual message: name, date of birth, medicine, dose, how often, pharmacy and callback number." />
        <p className="field-hint">Fills in: {'{name} {dateOfBirth} {medicine} {dose} {howOften} {pharmacy} {callback}'}</p>
      </div>
    </Sheet>
  )
}
