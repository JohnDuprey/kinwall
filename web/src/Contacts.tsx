import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useApp } from './AppContext.tsx'
import { api, ApiError } from './api.ts'
import { announce } from './a11y.tsx'
import { useDialog } from './dialog.tsx'
import { FilterIcon, PlusIcon } from './icons.tsx'
import Sheet from './Sheet.tsx'
import PickField, { PickSwatch, type PickOption } from './PickField.tsx'
import { inkFor } from './color.ts'
import type { Member } from './types.ts'
import { activeContactFilters, contactFilterSummary, CONTACT_KIND_LABELS, CONTACT_SHOW_LABELS, CONTACT_SORT_LABELS, DEFAULT_CONTACT_FILTERS, emptyContact, formatAddress, reviewCandidates,
  type Contact, type ContactFilters, type ContactAddress, type ContactInput, type ContactMethod, type ImportCandidate, type ImportDecision } from './contact-types.ts'
import type { ContactCategory } from './contact-types.ts'
import './contacts.css'

// Choices for the category and member pickers: a category's color, a member's avatar.
const categoryOptions = (categories: ContactCategory[]): PickOption[] => categories.map(c => ({ value: c.id, label: c.name, lead: c.color ? <PickSwatch color={c.color} /> : undefined }))
const memberOptions = (members: Member[]): PickOption[] => members.map(m => ({ value: m.id, label: m.name,
  lead: <span className="member-avatar-sm" aria-hidden="true" style={{ background: m.color, color: inkFor(m.color) }}>{m.avatar || m.name[0]}</span> }))

type PickerContact = { name?: string[]; tel?: string[]; email?: string[]; address?: { toString(): string }[] }
type ContactPicker = { select: (properties: string[], options: { multiple: boolean }) => Promise<PickerContact[]>; getProperties?: () => Promise<string[]> }

const TEMPLATES: { label: string; relationship: string; kind: NonNullable<Contact['kind']>; emergency?: boolean }[] = [
  { label: 'Poison Control', relationship: 'Emergency service', kind: 'service', emergency: true },
  { label: 'Animal Control', relationship: 'Emergency service', kind: 'service', emergency: true },
  { label: 'Emergency services', relationship: 'Emergency service', kind: 'service', emergency: true },
  { label: 'Police non-emergency', relationship: 'Public service', kind: 'service' },
  { label: 'Fire department', relationship: 'Emergency service', kind: 'service', emergency: true },
  { label: 'Pediatrician', relationship: 'Doctor', kind: 'service' },
  { label: 'Veterinarian', relationship: 'Veterinarian', kind: 'service' },
  { label: 'Pharmacy', relationship: 'Medical', kind: 'service' },
  { label: 'School office', relationship: 'School', kind: 'organization' },
  { label: 'Utility company', relationship: 'Home service', kind: 'organization' },
  { label: 'Locksmith', relationship: 'Home service', kind: 'service' },
  { label: 'Insurance provider', relationship: 'Insurance', kind: 'organization' },
  { label: 'Babysitter', relationship: 'Childcare', kind: 'person' },
  { label: 'Neighbor', relationship: 'Neighbor', kind: 'person' },
  { label: 'Other service', relationship: 'Service', kind: 'service' },
]
const VISIBILITY_HINTS: Record<NonNullable<ContactInput['visibility']>, string> = {
  household: 'Parent devices and everyone’s own devices. Wall screens too, if it’s on the wall.',
  adults: 'Parent devices and grown-ups’ own devices. Never wall screens or kids’ devices.',
  selected_members: 'Parent devices and the chosen people’s own devices. Never wall screens.',
  private: 'Only parent devices.',
}
const clean = (s: string) => s.trim() || null
const errorText = (error: unknown, fallback: string) => error instanceof ApiError ? error.message : fallback
const callHref = (value: string) => {
  const phone = value.trim().replace(/[\s().-]/g, '')
  return /^\+?[0-9]{7,15}$/.test(phone) ? `tel:${phone}` : null
}
const mailHref = (value: string) => /^[^\s@<>:]+@[^\s@<>:]+\.[^\s@<>:]+$/.test(value.trim()) ? `mailto:${value.trim()}` : null
const webHref = (value: string) => /^https?:\/\//i.test(value.trim()) ? value.trim() : null
const initials = (name: string) => name.split(/\s+/).map(p => p[0]).slice(0, 2).join('').toLocaleUpperCase()

function ContactCard({ contact, categoryNames, onOpen }: { contact: Contact; categoryNames: Map<string, string>; onOpen: () => void }) {
  const subtitle = [contact.relationship, contact.organization].filter(Boolean).join(' · ')
  return <button className="contact-card" onClick={onOpen} aria-label={`Open ${contact.name}`}>
    <span className="contact-avatar" aria-hidden="true">{initials(contact.name)}</span>
    <span className="contact-card-copy">
      <span className="contact-card-title">{contact.name}</span>
      {subtitle && <span className="contact-card-sub">{subtitle}</span>}
      <span className="contact-card-kind">{contact.kind === 'service' ? 'Service' : contact.kind === 'organization' ? 'Organization' : contact.kind === 'place' ? 'Place' : 'Person'}</span>
      {contact.categoryIds?.length ? <span className="contact-card-sub">{contact.categoryIds.map(id => categoryNames.get(id)).filter(Boolean).slice(0, 2).join(' · ')}</span> : null}
      {contact.phones[0] && <span className="contact-card-phone">{contact.phones[0].value}</span>}
    </span>
    <span className="contact-card-flags" aria-label={[contact.favorite && 'Favorite', contact.emergency && 'Emergency', contact.wallVisible && 'On wall'].filter(Boolean).join(', ') || undefined}>
      {contact.favorite && <span title="Favorite">★</span>}
      {contact.emergency && <span title="Emergency">✚</span>}
      {contact.wallVisible && <span title="On wall">▣</span>}
    </span>
  </button>
}

function Methods({ title, methods, onChange }: { title: string; methods: ContactMethod[]; onChange: (methods: ContactMethod[]) => void }) {
  const id = useId()
  const update = (index: number, patch: Partial<ContactMethod>) => onChange(methods.map((m, i) => i === index ? { ...m, ...patch } : m))
  return <fieldset className="contact-methods">
    <legend>{title}</legend>
    {methods.map((method, i) => <div className="contact-method-row" key={`${id}-${i}`}>
      <div className="field"><label htmlFor={`${id}-label-${i}`}>{title === 'Phone numbers' ? 'Phone' : 'Email'} label</label>
        <input id={`${id}-label-${i}`} type="text" value={method.label} onChange={e => update(i, { label: e.target.value })} placeholder="Home, work…" maxLength={40} /></div>
      <div className="field"><label htmlFor={`${id}-value-${i}`}>{title === 'Phone numbers' ? 'Number' : 'Address'}</label>
        <input id={`${id}-value-${i}`} type={title === 'Phone numbers' ? 'tel' : 'email'} value={method.value} onChange={e => update(i, { value: e.target.value })} autoComplete={title === 'Phone numbers' ? 'tel' : 'email'} /></div>
      <button type="button" className="contact-remove-method" onClick={() => onChange(methods.filter((_, n) => n !== i))} aria-label={`Remove ${title === 'Phone numbers' ? 'phone' : 'email'} ${i + 1}`}>Remove</button>
    </div>)}
    <button type="button" className="contact-inline-btn" onClick={() => onChange([...methods, { label: title === 'Phone numbers' ? 'Mobile' : 'Personal', value: '' }])}>+ Add {title === 'Phone numbers' ? 'phone' : 'email'}</button>
  </fieldset>
}

function ContactForm({ initial, categories, members, onClose, onSaved }: { initial: Contact | null; categories: ContactCategory[]; members: Member[]; onClose: () => void; onSaved: (contact: Contact) => void }) {
  const { toast } = useApp()
  const id = useId()
  const [form, setForm] = useState<ContactInput>(() => {
    if (!initial) return emptyContact()
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...draft } = initial
    return draft
  })
  const [saving, setSaving] = useState(false)
  const [validation, setValidation] = useState('')
  const change = <K extends keyof ContactInput>(key: K, value: ContactInput[K]) => setForm(f => ({ ...f, [key]: value }))
  // The form edits the first address; any others (from an import) are kept as they are.
  const address: ContactAddress = form.addresses?.[0] ?? { label: 'Home', street: '', city: '', region: '', postalCode: '', country: '' }
  const changeAddress = (patch: Partial<ContactAddress>) => change('addresses', [{ ...address, ...patch }, ...(form.addresses ?? []).slice(1)])
  const save = async () => {
    const name = form.name.trim()
    if (!name) { setValidation('Add a name.'); return }
    const phones = form.phones.map(m => ({ label: m.label.trim() || 'Phone', value: m.value.trim() })).filter(m => m.value)
    const emails = form.emails.map(m => ({ label: m.label.trim() || 'Email', value: m.value.trim() })).filter(m => m.value)
    if (phones.some(m => !callHref(m.value))) { setValidation('Enter a valid phone number or remove the empty row.'); return }
    if (emails.some(m => !mailHref(m.value))) { setValidation('Enter a valid email address.'); return }
    if (form.visibility === 'selected_members' && !form.selectedMemberIds?.length) { setValidation('Choose who can see it.'); return }
    const addresses = (form.addresses ?? []).map(a => ({ ...a, street: a.street.trim(), city: a.city.trim(), region: a.region.trim(), postalCode: a.postalCode.trim() })).filter(a => formatAddress(a))
    const body: ContactInput = { ...form, name, organization: clean(form.organization ?? ''), relationship: clean(form.relationship ?? ''),
      notes: clean(form.notes ?? ''), phones, emails, addresses }
    setSaving(true); setValidation('')
    try { onSaved(initial ? await api.updateContact(initial.id, body) : await api.createContact(body)) }
    catch (error) { toast(errorText(error, 'Could not save contact.'), true) }
    finally { setSaving(false) }
  }
  return <Sheet title={initial ? 'Edit contact' : 'New contact'} onClose={onClose} dismissable={!saving}
    actions={<><button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save contact'}</button></>}>
    {!initial && <div className="contact-template"><span>Start with a blank service template</span><div className="chip-row">{TEMPLATES.map(t => <button type="button" key={t.label} className="chip" onClick={() => setForm(f => ({ ...f, name: f.name || t.label, kind: t.kind, relationship: t.relationship, emergency: !!t.emergency }))}>{t.label}</button>)}</div></div>}
    <div className="field"><label htmlFor={`${id}-name`}>Name *</label><input id={`${id}-name`} type="text" value={form.name} onChange={e => change('name', e.target.value)} maxLength={160} autoComplete="name" /></div>
    <div className="field"><label htmlFor={`${id}-kind`}>Contact kind</label><select id={`${id}-kind`} value={form.kind ?? 'person'} onChange={e => change('kind', e.target.value as ContactInput['kind'])}><option value="person">Person</option><option value="service">Service</option><option value="organization">Organization</option><option value="place">Place</option></select></div>
    <div className="row-2"><div className="field"><label htmlFor={`${id}-relationship`}>Relationship</label><input id={`${id}-relationship`} type="text" value={form.relationship ?? ''} onChange={e => change('relationship', e.target.value)} placeholder="School, doctor, neighbor…" maxLength={100} /></div>
      <div className="field"><label htmlFor={`${id}-org`}>Organization</label><input id={`${id}-org`} type="text" value={form.organization ?? ''} onChange={e => change('organization', e.target.value)} maxLength={160} autoComplete="organization" /></div></div>
    <Methods title="Phone numbers" methods={form.phones} onChange={v => change('phones', v)} />
    <Methods title="Email addresses" methods={form.emails} onChange={v => change('emails', v)} />
    <fieldset className="contact-methods"><legend>Address</legend>
      <div className="field"><label htmlFor={`${id}-street`}>Street</label><input id={`${id}-street`} type="text" value={address.street} onChange={e => changeAddress({ street: e.target.value })} maxLength={500} autoComplete="street-address" /></div>
      <div className="row-2"><div className="field"><label htmlFor={`${id}-city`}>City</label><input id={`${id}-city`} type="text" value={address.city} onChange={e => changeAddress({ city: e.target.value })} maxLength={200} autoComplete="address-level2" /></div>
        <div className="field"><label htmlFor={`${id}-region`}>State</label><input id={`${id}-region`} type="text" value={address.region} onChange={e => changeAddress({ region: e.target.value })} maxLength={200} autoComplete="address-level1" /></div></div>
      <div className="field"><label htmlFor={`${id}-zip`}>ZIP code</label><input id={`${id}-zip`} type="text" value={address.postalCode} onChange={e => changeAddress({ postalCode: e.target.value })} maxLength={50} autoComplete="postal-code" /></div>
    </fieldset>
    <div className="field"><label htmlFor={`${id}-categories`}>Categories</label><PickField id={`${id}-categories`} label="Categories" multiple options={categoryOptions(categories)} value={form.categoryIds ?? []} onChange={v => change('categoryIds', v)} /></div>
    <div className="field"><label htmlFor={`${id}-members`}>Associated household members</label><PickField id={`${id}-members`} label="Associated household members" title="Household members" multiple options={memberOptions(members)} value={form.memberIds ?? []} onChange={v => change('memberIds', v)} /></div>
    {(form.kind === 'service' || form.kind === 'organization' || form.kind === 'place') && <div className="row-2"><div className="field"><label htmlFor={`${id}-hours`}>Service hours</label><input id={`${id}-hours`} value={form.serviceHours ?? ''} onChange={e => change('serviceHours', clean(e.target.value))} placeholder="Mon–Fri, 8am–5pm" /></div><div className="field"><label htmlFor={`${id}-area`}>Service area</label><input id={`${id}-area`} value={form.serviceArea ?? ''} onChange={e => change('serviceArea', clean(e.target.value))} placeholder="North county" /></div></div>}
    <div className="field"><label htmlFor={`${id}-notes`}>Notes</label><textarea id={`${id}-notes`} value={form.notes ?? ''} onChange={e => change('notes', e.target.value)} maxLength={2000} /></div>
    <fieldset className="contact-options"><legend>Directory options</legend>
      <label><input type="checkbox" checked={form.favorite} onChange={e => change('favorite', e.target.checked)} /> Favorite</label>
      <label><input type="checkbox" checked={form.emergency} onChange={e => change('emergency', e.target.checked)} /> Emergency contact</label>
      <label><input type="checkbox" checked={form.alwaysOpen ?? false} onChange={e => change('alwaysOpen', e.target.checked)} /> Available 24/7</label>
      <label><input type="checkbox" checked={form.wallVisible} onChange={e => change('wallVisible', e.target.checked)} /> Show on wall and shared displays</label>
      {form.wallVisible && <><label><input type="checkbox" checked={form.phoneVisibleOnWall ?? false} onChange={e => change('phoneVisibleOnWall', e.target.checked)} /> Show permitted phone numbers on wall</label><label><input type="checkbox" checked={form.addressVisibleOnWall ?? false} onChange={e => change('addressVisibleOnWall', e.target.checked)} /> Show address on wall</label></>}
      <div className="field"><label htmlFor={`${id}-visibility`}>Who can see it</label><select id={`${id}-visibility`} value={form.visibility ?? 'household'} onChange={e => change('visibility', e.target.value as ContactInput['visibility'])}><option value="household">Everyone in the family</option><option value="adults">Grown-ups only</option><option value="selected_members">Only the people I choose</option><option value="private">Parent devices only</option></select>
        <p className="field-hint">{VISIBILITY_HINTS[form.visibility ?? 'household']}</p></div>
      {form.visibility === 'selected_members' && <div className="field"><label htmlFor={`${id}-selected`}>Who can see it on their own device</label><PickField id={`${id}-selected`} label="Who can see it on their own device" title="Who can see it" multiple none="Nobody yet" options={memberOptions(members)} value={form.selectedMemberIds ?? []} onChange={v => change('selectedMemberIds', v)} /></div>}
    </fieldset>
    {validation && <p className="field-error" role="alert">{validation}</p>}
  </Sheet>
}

function ContactDetail({ contact, categories, members, canEdit, onClose, onEdit, onDelete }: { contact: Contact; categories: ContactCategory[]; members: Member[]; canEdit: boolean; onClose: () => void; onEdit: () => void; onDelete: () => void }) {
  const categoryNames = (contact.categoryIds ?? []).map(id => categories.find(category => category.id === id)?.name).filter(Boolean)
  const memberNames = (contact.memberIds ?? []).map(id => members.find(member => member.id === id)?.name).filter(Boolean)
  return <Sheet title={contact.name} onClose={onClose} actions={canEdit ? <>
    <select className="settings-select actions-select" aria-label="Contact actions" value="" onChange={e => { if (e.target.value === 'delete') onDelete() }}>
      <option value="" disabled hidden>More…</option>
      <option value="delete">Delete contact…</option>
    </select>
    <button className="btn btn-primary" onClick={onEdit}>Edit</button>
  </> : undefined}>
    <div className="contact-detail-head"><span className="contact-avatar contact-avatar-large" aria-hidden="true">{initials(contact.name)}</span>
      <div><h3>{contact.name}</h3><p>{[contact.relationship, contact.organization].filter(Boolean).join(' · ') || 'Household contact'}</p></div></div>
    <div className="contact-badges">{contact.favorite && <span>★ Favorite</span>}{contact.emergency && <span>✚ Emergency</span>}{contact.wallVisible && <span>▣ On wall</span>}</div>
    {(categoryNames.length > 0 || memberNames.length > 0 || contact.serviceHours || contact.serviceArea || contact.alwaysOpen) && <section className="contact-detail-section"><h4>Directory details</h4>{categoryNames.length > 0 && <p>Categories: {categoryNames.join(', ')}</p>}{memberNames.length > 0 && <p>For: {memberNames.join(', ')}</p>}{contact.serviceHours && <p>Hours: {contact.serviceHours}</p>}{contact.alwaysOpen && <p>Available 24/7</p>}{contact.serviceArea && <p>Service area: {contact.serviceArea}</p>}</section>}
    {contact.phones.length > 0 && <section className="contact-detail-section"><h4>Phone</h4>{contact.phones.map((m, i) => <div className="contact-detail-line" key={i}><span>{m.label}</span><strong>{m.value}</strong>{callHref(m.value) && <a className="contact-action" href={callHref(m.value)!} aria-label={`Call ${contact.name}, ${m.label}`}>Call</a>}{callHref(m.value) && <a className="contact-action" href={`sms:${callHref(m.value)!.slice(4)}`} aria-label={`Text ${contact.name}, ${m.label}`}>Text</a>}<button className="contact-action" onClick={() => navigator.clipboard?.writeText(m.value)}>Copy</button></div>)}</section>}
    {contact.emails.length > 0 && <section className="contact-detail-section"><h4>Email</h4>{contact.emails.map((m, i) => <div className="contact-detail-line" key={i}><span>{m.label}</span><strong>{m.value}</strong>{mailHref(m.value) && <a className="contact-action" href={mailHref(m.value)!} aria-label={`Email ${contact.name}, ${m.label}`}>Email</a>}</div>)}</section>}
    {contact.addresses?.length ? <section className="contact-detail-section"><h4>Address</h4>{contact.addresses.map((a, i) => <div className="contact-detail-line" key={i}>{a.label && <span>{a.label}</span>}<strong>{formatAddress(a)}</strong><a className="contact-action" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(formatAddress(a))}`}>Map</a><button className="contact-action" onClick={() => navigator.clipboard?.writeText(formatAddress(a))}>Copy</button></div>)}</section> : null}
    {contact.websites?.length ? <section className="contact-detail-section"><h4>Websites</h4>{contact.websites.map((site, i) => webHref(site.value) ? <p key={i}><a href={webHref(site.value)!} target="_blank" rel="noreferrer">{site.label || site.value}</a></p> : null)}</section> : null}
    {canEdit && contact.notes && <section className="contact-detail-section"><h4>Notes</h4><p>{contact.notes}</p></section>}
  </Sheet>
}

function ImportSheet({ contacts, categories, members, onClose, onImported }: { contacts: Contact[]; categories: ContactCategory[]; members: Member[]; onClose: () => void; onImported: () => void }) {
  const { toast } = useApp()
  const dialog = useDialog()
  const fileInput = useRef<HTMLInputElement>(null)
  const id = useId()
  const [text, setText] = useState('')
  const [review, setReview] = useState<ImportCandidate[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const picker = (navigator as Navigator & { contacts?: ContactPicker }).contacts
  const [pickerAvailable, setPickerAvailable] = useState(!!picker && typeof picker.select === 'function' && window.isSecureContext && window.top === window)
  useEffect(() => {
    if (!picker?.getProperties || !pickerAvailable) return
    picker.getProperties().then(properties => { if (!properties.includes('name')) setPickerAvailable(false) }).catch(() => setPickerAvailable(false))
  }, [pickerAvailable, picker])
  // The server reads vCards and finds duplicates; nothing is saved until Import.
  const stage = async (body: { vcard: string } | { contacts: ContactInput[] }, failed: string) => {
    if ('contacts' in body && !body.contacts.length) { setMessage('No contacts with names were found.'); return }
    setBusy(true)
    try {
      const { entries } = await api.previewContactImport(body)
      if (entries.length > 500) { setMessage('Choose up to 500 contacts at a time.'); return }
      setReview(reviewCandidates(entries)); setMessage('')
    } catch (error) { setMessage(errorText(error, failed)) }
    finally { setBusy(false) }
  }
  const fileChosen = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > 2_000_000) { setMessage('Choose a vCard file smaller than 2 MB.'); return }
    await stage({ vcard: await file.text() }, 'Could not read that vCard file.')
  }
  const pick = async () => {
    if (!picker) return
    try {
      const selected = await picker.select(['name', 'tel', 'email', 'address'], { multiple: true })
      await stage({ contacts: selected.map(c => ({ ...emptyContact(), name: c.name?.[0]?.trim() ?? '',
        phones: (c.tel ?? []).map(value => ({ label: 'Phone', value })),
        emails: (c.email ?? []).map(value => ({ label: 'Email', value })),
        addresses: (c.address ?? []).map(a => ({ label: 'Home', street: a.toString(), city: '', region: '', postalCode: '', country: '' })) })).filter(c => c.name) }, 'Could not read those contacts.')
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') setMessage('Contacts access was unavailable. You can choose a vCard file or paste its text instead.')
    }
  }
  const decide = (key: string, decision: ImportDecision) => setReview(rows => rows?.map(row => row.key === key ? { ...row, decision } : row) ?? null)
  const edit = (key: string, patch: Partial<ContactInput>) => setReview(rows => rows?.map(row => row.key === key ? { ...row, input: { ...row.input, ...patch } } : row) ?? null)
  const commit = async () => {
    if (!review) return
    const merges = review.filter(row => row.decision === 'merge').length
    if (merges && !await dialog.confirm({ title: `Merge ${merges} contact${merges === 1 ? '' : 's'}?`, body: 'Missing details will be added to the matching saved contacts.', confirmLabel: 'Merge and import' })) return
    setBusy(true); setMessage('')
    const creates = review.filter(row => row.decision === 'add' || row.decision === 'keep')
    const mergeRows = review.filter(row => row.decision === 'merge' && row.matchId)
    try {
      if (creates.length) await api.importContacts({ contacts: creates.map(row => row.input), strategy: 'create' })
      if (mergeRows.length) await api.importContacts({ contacts: mergeRows.map(row => row.input), strategy: 'merge', mergeTargets: mergeRows.map(row => row.matchId!), confirmMerge: true })
      onImported()
      const n = creates.length + mergeRows.length
      toast(`${n} contact${n === 1 ? '' : 's'} imported.`)
      onClose()
    } catch (error) {
      onImported()
      setMessage(`Import stopped: ${errorText(error, 'Could not save a contact.')}`)
    } finally { setBusy(false) }
  }
  return <Sheet title={review ? 'Review contacts' : 'Import contacts'} onClose={onClose} dismissable={!busy}
    actions={review ? <><button className="btn btn-secondary" disabled={busy} onClick={() => setReview(null)}>Back</button><button className="btn btn-primary" disabled={busy || !review.some(r => r.decision !== 'skip')} onClick={commit}>{busy ? 'Importing…' : `Import ${review.filter(r => r.decision !== 'skip').length}`}</button></> : undefined}>
    {!review ? <div className="contact-import-options">
      <p>Review every contact before it’s added. Imported contacts are for the whole family and stay off wall screens until you turn that on.</p>
      {pickerAvailable && <button className="contact-import-choice" onClick={pick}>Choose from this device’s contacts<span>Uses your browser’s contact picker</span></button>}
      <button className="contact-import-choice" onClick={() => fileInput.current?.click()}>Choose a vCard file<span>.vcf or .vcard, up to 2 MB</span></button>
      <input ref={fileInput} type="file" accept=".vcf,.vcard,text/vcard,text/x-vcard" onChange={fileChosen} className="sr-only" aria-label="vCard file" />
      <div className="field"><label htmlFor={`${id}-paste`}>Or paste vCard text</label><textarea id={`${id}-paste`} value={text} onChange={e => setText(e.target.value)} placeholder="BEGIN:VCARD…" rows={5} /></div>
      <button className="btn btn-secondary" onClick={() => void stage({ vcard: text }, 'Could not read that vCard text.')} disabled={busy || !text.trim()}>Review pasted contacts</button>
      {!pickerAvailable && <p className="field-hint">To import from a phone, export or share contacts as a vCard (.vcf) file, then choose that file here.</p>}
      <p className="field-hint">Names, phones, emails, organizations, addresses, URLs, categories and notes are read. Photo properties are ignored.</p>
    </div> : <div className="contact-review">
      <p>{review.length} contact{review.length === 1 ? '' : 's'} to review. Contacts with the same phone, email or name as a saved one are marked possible duplicates.</p>
      {review.map(row => {
        const matched = contacts.find(c => c.id === row.matchId)
        return <div className="contact-review-row" key={row.key}>
          <div className="contact-review-heading"><strong>{row.input.name}</strong><span className={`contact-status contact-status-${row.status}`}>{row.status === 'new' ? 'New' : 'Possible duplicate'}</span></div>
          <div className="contact-review-edit"><label>Name<input value={row.input.name} onChange={e => edit(row.key, { name: e.target.value })} /></label><label>Kind<select value={row.input.kind ?? 'person'} onChange={e => edit(row.key, { kind: e.target.value as ContactInput['kind'] })}><option value="person">Person</option><option value="service">Service</option><option value="organization">Organization</option><option value="place">Place</option></select></label><label>Relationship<input value={row.input.relationship ?? ''} onChange={e => edit(row.key, { relationship: e.target.value || null })} /></label></div>
          <div className="contact-review-toggles"><label><input type="checkbox" checked={!!row.input.favorite} onChange={e => edit(row.key, { favorite: e.target.checked })} /> Favorite</label><label><input type="checkbox" checked={!!row.input.emergency} onChange={e => edit(row.key, { emergency: e.target.checked })} /> Emergency</label><label><input type="checkbox" checked={!!row.input.wallVisible} onChange={e => edit(row.key, { wallVisible: e.target.checked })} /> Show on wall</label></div>
          <div className="contact-review-picks">
            <div className="contact-review-category"><label htmlFor={`${id}-${row.key}-categories`}>Categories</label><PickField id={`${id}-${row.key}-categories`} label={`Categories for ${row.input.name}`} title="Categories" multiple options={categoryOptions(categories)} value={row.input.categoryIds ?? []} onChange={v => edit(row.key, { categoryIds: v })} /></div>
            <div className="contact-review-category"><label htmlFor={`${id}-${row.key}-members`}>Household members</label><PickField id={`${id}-${row.key}-members`} label={`Household members for ${row.input.name}`} title="Household members" multiple options={memberOptions(members)} value={row.input.memberIds ?? []} onChange={v => edit(row.key, { memberIds: v })} /></div>
          </div>
          <p>{[row.input.organization, row.input.phones[0]?.value, row.input.emails[0]?.value].filter(Boolean).join(' · ') || 'Name only'}</p>
          {matched && <p className="contact-match">Matches {matched.name}{matched.phones[0] ? ` · ${matched.phones[0].value}` : ''}</p>}
          <label className="contact-review-action">Action<select value={row.decision} onChange={e => decide(row.key, e.target.value as ImportDecision)}>
            {(row.status === 'new' ? [{ value: 'add', label: 'Add' }, { value: 'skip', label: 'Skip' }] : [
              ...(matched ? [{ value: 'merge', label: 'Merge missing details' }] : []), { value: 'skip', label: 'Skip' }, { value: 'keep', label: 'Keep both' }]).map(option =>
              <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        </div>
      })}
    </div>}
    {message && <p className="field-error" role="alert">{message}</p>}
  </Sheet>
}

function FiltersSheet({ filters, categories, onChange, onClose }: { filters: ContactFilters; categories: ContactCategory[]; onChange: (f: ContactFilters) => void; onClose: () => void }) {
  const id = useId()
  const set = <K extends keyof ContactFilters>(key: K, value: ContactFilters[K]) => onChange({ ...filters, [key]: value })
  const options = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)
  return <Sheet title="Filters" onClose={onClose} actions={<>
    <button className="btn btn-secondary" onClick={() => onChange(DEFAULT_CONTACT_FILTERS)} disabled={contactFilterSummary(filters, () => '') === ''}>Clear filters</button>
    <button className="btn btn-primary" onClick={onClose}>Done</button>
  </>}>
    <div className="field"><label htmlFor={`${id}-sort`}>Sort</label><select id={`${id}-sort`} value={filters.sort} onChange={e => set('sort', e.target.value as ContactFilters['sort'])}>{options(CONTACT_SORT_LABELS)}</select></div>
    <div className="field"><label htmlFor={`${id}-show`}>Show</label><select id={`${id}-show`} value={filters.show} onChange={e => set('show', e.target.value as ContactFilters['show'])}>{options(CONTACT_SHOW_LABELS)}</select></div>
    <div className="field"><label htmlFor={`${id}-kind`}>Contact kind</label><select id={`${id}-kind`} value={filters.kind} onChange={e => set('kind', e.target.value as ContactFilters['kind'])}>{options(CONTACT_KIND_LABELS)}</select></div>
    <div className="field"><label htmlFor={`${id}-category`}>Category</label><select id={`${id}-category`} value={filters.category} onChange={e => set('category', e.target.value)}><option value="all">All categories</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
  </Sheet>
}

export default function Contacts() {
  const { parentDevice, refreshTick, toast, members } = useApp()
  const dialog = useDialog()
  const [contacts, setContacts] = useState<Contact[]>([])
  const [categories, setCategories] = useState<ContactCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<ContactFilters>(DEFAULT_CONTACT_FILTERS)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sheet, setSheet] = useState<'detail' | 'edit' | 'create' | 'import' | 'filters' | null>(null)
  const load = async () => {
    try { setContacts(await api.getContacts()); setLoadError('') }
    catch (error) { setLoadError(errorText(error, 'Could not load contacts.')) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load(); void api.getContactCategories().then(setCategories).catch(() => {}) }, [refreshTick])
  const selected = contacts.find(c => c.id === selectedId) ?? null
  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase()
    const { show, kind, category, sort } = filters
    return contacts.filter(c => (show === 'all' || (show === 'favorites' && c.favorite) || (show === 'emergency' && c.emergency) || (show === 'wall' && c.wallVisible)) &&
      (kind === 'all' || c.kind === kind) &&
      (category === 'all' || c.categoryIds?.includes(category)) &&
      (!q || [c.name, c.organization, c.relationship, ...c.phones.map(p => p.value), ...(parentDevice ? c.emails.map(e => e.value) : [])]
        .some(value => value?.toLocaleLowerCase().includes(q))))
      .sort((a, b) => sort === 'recent' ? b.updatedAt.localeCompare(a.updatedAt) : sort === 'organization' ?
        (a.organization || a.name).localeCompare(b.organization || b.name) : a.name.localeCompare(b.name))
  }, [contacts, parentDevice, query, filters])
  const saved = (contact: Contact) => {
    setContacts(all => { const index = all.findIndex(c => c.id === contact.id); return index < 0 ? [...all, contact] : all.map(c => c.id === contact.id ? contact : c) })
    setSelectedId(contact.id); setSheet('detail'); announce(`${contact.name} saved`)
  }
  const remove = async () => {
    if (!selected || !parentDevice) return
    if (!await dialog.confirm({ title: `Delete ${selected.name}?`, body: 'This contact will be removed from the household directory.', confirmLabel: 'Delete contact', danger: true })) return
    try { await api.deleteContact(selected.id); setContacts(all => all.filter(c => c.id !== selected.id)); setSheet(null); setSelectedId(null); announce(`${selected.name} deleted`) }
    catch (error) { toast(errorText(error, 'Could not delete contact.'), true) }
  }
  const count = contacts.length
  const categoryNames = new Map(categories.map(category => [category.id, category.name]))
  const activeFilters = activeContactFilters(filters)
  const summary = contactFilterSummary(filters, id => categoryNames.get(id))
  const addContact = () => { setSelectedId(null); setSheet('create') }
  return <div className="contacts-page scroll-y">
    <div className="contacts-inner">
      <div className="contacts-heading"><div><h2>Contacts</h2><p>{count} household contact{count === 1 ? '' : 's'}{!parentDevice && ' available on this display'}</p></div>
        {parentDevice && <div className="contacts-heading-actions">
          <select className="settings-select actions-select" aria-label="More contact actions" value="" onChange={e => { if (e.target.value === 'import') setSheet('import') }}>
            <option value="" disabled hidden>More…</option>
            <option value="import">Import contacts…</option>
          </select>
          <button className="btn btn-primary" onClick={addContact}><PlusIcon width={18} height={18} /> Add</button></div>}</div>
      {count > 0 && <>
        <div className="contacts-tools">
          <input type="search" aria-label="Search contacts" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search contacts" />
          <button className={`icon-btn filter-btn contacts-filter-btn ${activeFilters ? 'active' : ''}`} onClick={() => setSheet('filters')}
            aria-label={activeFilters ? `Filters, ${activeFilters} on` : 'Filters'}>
            <FilterIcon width={20} height={20} />
            {activeFilters > 0 && <span className="filter-badge" aria-hidden="true">{activeFilters}</span>}
          </button>
        </div>
        {summary && <button className="filter-summary contacts-filter-summary" onClick={() => setSheet('filters')} aria-label={`Filters: ${summary}. Change filters`}>{summary}</button>}
      </>}
      {loadError && <div className="empty-card" role="alert"><p>{loadError}</p><button className="btn btn-secondary" onClick={() => { setLoading(true); void load() }}>Try again</button></div>}
      {!loadError && loading && <div className="state-card">Loading contacts…</div>}
      {!loadError && !loading && count === 0 && <div className="empty-card"><span className="emoji" aria-hidden="true">☎️</span>
        <p>{parentDevice ? 'No contacts yet. Add the people and places your family calls: school, doctor, sitter, neighbors.' : 'No contacts here yet.'}</p>
        {parentDevice && <div className="contacts-empty-actions"><button className="btn btn-secondary" onClick={() => setSheet('import')}>Import</button><button className="btn btn-primary" onClick={addContact}><PlusIcon width={18} height={18} /> Add a contact</button></div>}</div>}
      {!loadError && !loading && count > 0 && visible.length === 0 && <div className="empty-card"><span className="emoji" aria-hidden="true">☎️</span><p>No contacts match{activeFilters ? ' these filters' : ''}.</p>
        {activeFilters > 0 && <button className="btn btn-secondary" onClick={() => setFilters(DEFAULT_CONTACT_FILTERS)}>Clear filters</button>}</div>}
      {!loadError && visible.length > 0 && <div className="contacts-grid" aria-live="polite">{visible.map(c => <ContactCard key={c.id} contact={c} categoryNames={categoryNames} onOpen={() => { setSelectedId(c.id); setSheet('detail') }} />)}</div>}
    </div>
    {sheet === 'detail' && selected && <ContactDetail contact={selected} categories={categories} members={members} canEdit={parentDevice} onClose={() => setSheet(null)} onEdit={() => setSheet('edit')} onDelete={remove} />}
    {sheet === 'edit' && selected && parentDevice && <ContactForm key={selected.id} initial={selected} categories={categories} members={members} onClose={() => setSheet('detail')} onSaved={saved} />}
    {sheet === 'create' && parentDevice && <ContactForm initial={null} categories={categories} members={members} onClose={() => setSheet(null)} onSaved={saved} />}
    {sheet === 'filters' && <FiltersSheet filters={filters} categories={categories} onChange={setFilters} onClose={() => setSheet(null)} />}
    {sheet === 'import' && parentDevice && <ImportSheet contacts={contacts} categories={categories} members={members} onClose={() => setSheet(null)} onImported={() => { void load() }} />}
  </div>
}
