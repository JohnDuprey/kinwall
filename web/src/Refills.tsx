// Medicine refills (routes/medication-refills.ts on the server):
// - RefillsCard: the medicines page's "Refills" card: Request refill per medicine, and the open
//   "Request refill" to-dos with How to ask and Done, requested;
// - RefillSheet: the refill card: where to ask (the contact's phones, each with its phone menu and a Call
//   link that dials it, and its websites and apps), and what to say on the message, read-aloud size, with Copy;
// - RefillFields: the medicine sheet's Refills part (parent devices): which contact to ask (the contact
//   form adds or changes one, with its phone menus), pharmacy, date of birth, callback number and a reminder day.
import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { api, ApiError } from './api.ts'
import { useApp } from './AppContext.tsx'
import { announce } from './a11y.tsx'
import Sheet from './Sheet.tsx'
import { ContactForm } from './Contacts.tsx'
import { contactLabel, type Contact, type ContactCategory } from './contact-types.ts'
import type { Medication, MedicationRefill, Member, RefillCard } from './types.ts'

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
        {!c && <p className="snap-dim">No contact to ask for refills yet.{parentDevice ? ' Pick one under Refills when you edit this medicine (Trackers → Health).' : ' A grown-up can add one.'}</p>}
        {c && <>
          <h4 className="refill-place">{c.name}</h4>
          {c.websites.map((w, i) => <div className="refill-way" key={`w${i}`}>
            <span className="refill-way-label">{/^https?:/i.test(w.url) ? '🌐' : '📱'} {contactLabel(w.label) || 'Website'}</span>
            <a className="btn btn-secondary refill-btn" href={w.url} target="_blank" rel="noreferrer" aria-label={`Open ${contactLabel(w.label) || 'website'}`}>Open</a>
          </div>)}
          {c.phones.map((p, i) => <div className="refill-way refill-call" key={`p${i}`}>
            <span className="refill-way-label">📞 {contactLabel(p.label) ? `${contactLabel(p.label)}: ` : ''}<strong>{p.number}</strong></span>
            {p.telUri && <a className={`btn ${i === 0 ? 'btn-primary' : 'btn-secondary'} refill-btn`} href={p.telUri} aria-label={`Call ${c.name}, ${p.label}`}>Call</a>}
            {p.steps && <p className="refill-steps">Phone menu: {p.steps}</p>}
            {p.steps && <p className="field-hint">Call presses the menu for you on most phones. If yours doesn't, press the steps yourself.</p>}
          </div>)}
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
/** The medicine sheet's Refills part. `siblings`: the person's other medicines, to start a new one's details from. */
export function RefillFields({ refill, onChange, siblings }: { refill: MedicationRefill; onChange: (r: MedicationRefill) => void; siblings: Medication[] }) {
  const { members } = useApp()
  const [contacts, setContacts] = useState<Contact[]>([])
  const [categories, setCategories] = useState<ContactCategory[]>([])
  const [editing, setEditing] = useState<Contact | 'new' | null>(null)
  useEffect(() => {
    api.getContacts().then(setContacts).catch(() => setContacts([]))
    api.getContactCategories().then(setCategories).catch(() => setCategories([]))
  }, [])
  const { pharmacies, services } = pharmacyChoices(contacts)
  const offices = askChoices(contacts)
  const picked = contacts.find(x => x.id === refill.pharmacyContactId)
  const askAt = contacts.find(x => x.id === refill.contactId)
  const set = (p: Partial<MedicationRefill>) => onChange({ ...refill, ...p })
  const from = siblings.find(s => s.refill.contactId || s.refill.dateOfBirth || s.refill.pharmacy || s.refill.callback)
  const blank = !refill.contactId && !refill.pharmacy && !refill.dateOfBirth && !refill.callback
  return (
    <fieldset className="field meds-times refill-fields">
      <legend>Refills <span className="settings-row-sub">(optional)</span></legend>
      {blank && from && <button type="button" className="btn btn-secondary" onClick={() => set({ contactId: from.refill.contactId, pharmacyContactId: from.refill.pharmacyContactId, pharmacy: from.refill.pharmacy, dateOfBirth: from.refill.dateOfBirth, callback: from.refill.callback })}>Same as {from.name}</button>}
      <label className="refill-label" htmlFor="refill-place">Ask for refills at</label>
      <div className="meds-time-row">
        <select id="refill-place" className="settings-select" value={refill.contactId ?? ''} onChange={e => (e.target.value === 'new' ? setEditing('new') : set({ contactId: e.target.value || null }))}>
          <option value="">Not set</option>
          {offices.map(g => g.list.length > 0 && <optgroup key={g.label} label={g.label}>{g.list.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>)}
          {refill.contactId && !askAt && <option value={refill.contactId}>A contact</option>}
          <option value="new">Add a contact…</option>
        </select>
        {askAt && <button type="button" className="btn btn-secondary" onClick={() => setEditing(askAt)}>Edit contact</button>}
      </div>
      <p className="field-hint">The doctor's office or pharmacy from Contacts. Its phone menu and websites show on the refill card.</p>
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
      {editing && <ContactForm initial={editing === 'new' ? null : editing} categories={categories} members={members} onClose={() => setEditing(null)}
        onSaved={c => { setContacts(cs => [...cs.filter(x => x.id !== c.id), c]); set({ contactId: c.id }); setEditing(null) }} />}
    </fieldset>
  )
}

const MEDICAL = /pharm|drug|apothec|doctor|pediatric|clinic|medical|health|dental|dentist|physician|hospital/i
const medical = (c: Contact) => MEDICAL.test([c.name, c.organization, c.relationship, ...(c.tags ?? [])].join(' '))

/** Pharmacies first (named like one, or made from the Pharmacy template: relationship "Medical"), then other services and organizations. */
function pharmacyChoices(contacts: Contact[]) {
  const isPharmacy = (c: Contact) => /pharm|drug|apothec/i.test([c.name, c.organization, c.relationship, ...(c.tags ?? [])].join(' ')) || c.relationship === 'Medical'
  const pharmacies = contacts.filter(isPharmacy)
  return { pharmacies, services: contacts.filter(c => !isPharmacy(c) && (c.kind === 'service' || c.kind === 'organization')) }
}

/** Where to ask: doctors' offices and pharmacies first, then other places, then people. */
function askChoices(contacts: Contact[]) {
  const byName = [...contacts].sort((a, b) => a.name.localeCompare(b.name))
  const med = byName.filter(medical)
  const places = byName.filter(c => !medical(c) && c.kind !== 'person')
  return [
    { label: 'Doctors and pharmacies', list: med },
    { label: 'Other places in contacts', list: places },
    { label: 'People', list: byName.filter(c => !medical(c) && c.kind === 'person') },
  ]
}
