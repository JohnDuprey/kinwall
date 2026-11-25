import { Choose } from './PickField.tsx'
import { useContext, useState } from 'react'
import { AppContext, useApp } from './AppContext.tsx'
import { api, ApiError } from './api.ts'
import type { Member } from './types.ts'
import { MemberPicker } from './MemberPicker.tsx'
import { t, tc, tn } from './i18n.ts'

/** "Send a message now": pushes to devices following the picked members and lands in everyone's
 * notification feed. Also opened from the header bell's sheet (Notifications.tsx). */
export function SendMessageForm({ onSent }: { onSent?: () => void }) {
  const { members, toast } = useApp()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const send = async () => {
    if (!title.trim() || !body.trim()) return
    setSending(true)
    try {
      const result = await api.sendNotification({ title: title.trim(), body: body.trim(), memberIds: memberIds.length ? memberIds : undefined })
      toast(tn(result.sent, 'Sent to {n} device', 'Sent to {n} devices'))
      setTitle(''); setBody('')
      onSent?.()
    } catch (e) { toast(e instanceof ApiError ? e.message : t('Could not send'), true) } finally { setSending(false) }
  }
  return (
    <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, marginTop: 10 }}>
      <div className="settings-row-label">{t('Send a message')}</div>
      <div className="field" style={{ margin: 0 }}>
        <label>{t('Title')}</label>
        <input type="text" aria-label={t('Title')} value={title} onChange={e => setTitle(e.target.value)} placeholder={t("Dinner's ready")} />
      </div>
      <div className="field" style={{ margin: 0 }}>
        <label>{t('Message')}</label>
        <input type="text" aria-label={t('Message')} value={body} onChange={e => setBody(e.target.value)} placeholder={t('Come to the kitchen 🍝')} />
      </div>
      <MemberPicker members={members} selected={memberIds} onChange={setMemberIds} label={tc('message', 'To')} noneLabel={t('Everyone')} />
      <button className="btn btn-primary" onClick={send} disabled={sending || !title.trim() || !body.trim()}>{t('Send now')}</button>
    </div>
  )
}

/** "Who uses this device?" for a paired device: everyone (a shared screen) or one person, in one
 * list. The value still says kid or grown-up (the server checks it fits): 'wall', kid:memberId or
 * grownup:memberId (wallScreen.ts deviceKindValue); '' (only with `legacy`) for one paired before anyone said. */
export function DeviceKindSelect({ value, onChange, members, id, label, legacy }: { value: string; onChange: (v: string) => void; members?: Member[]; id?: string; label?: string; legacy?: boolean }) {
  const ctx = useContext(AppContext)
  const list = members ?? ctx?.members ?? []
  return (
    <Choose hideLabel label={label ?? t('Who uses this device?')} id={id} value={String(value)} onChange={next => onChange(next)} sheet
      options={[
        ...(legacy ? [{ value: '', label: t('Pick one'), disabled: true }] : []),
        { value: 'wall', label: ["👪 ", t('Everyone (shared screen)')].join('') },
        ...(list.map(m => ({ value: String(`${m.grownUp ? 'grownup' : 'kid'}:${m.id}`), label: [m.avatar, " ", m.name].join('') }))),
      ]} />
  )
}

/** Under "Who uses this device?" once a person is picked: whether their own everyday devices show the
 * whole family. It's their profile's switch (Settings → Family), so it changes all their devices;
 * saved at once, then `onSaved` gets the updated person so the hint above follows it. */
export function SeesFamilySwitch({ member, onSaved, onError }: { member: Member; onSaved: (m: Member) => void; onError: (msg: string) => void }) {
  const [busy, setBusy] = useState(false)
  const on = !!member.seesFamily
  const id = `sees-family-${member.id}`
  const flip = async () => {
    setBusy(true)
    // useAdmin: the sign-in screens' admin key, else this device's
    try { onSaved(await api.updateMember(member.id, { seesFamily: !on }, true)) } catch (e) { onError(e instanceof ApiError ? e.message : t('Could not save member')) } finally { setBusy(false) }
  }
  return (
    <>
      <div className="toggle-row">
        <label id={id}>{t("Show the whole family on {name}'s devices", { name: member.name })}</label>
        <button className={`switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-labelledby={id} disabled={busy} onClick={flip}><span className="knob" /></button>
      </div>
      <p className="settings-row-sub">{t("This changes all of {name}'s devices, not just this one.", { name: member.name })}</p>
    </>
  )
}
