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

/** "What is this device?" for a paired device: the family's wall screen or a kid's device (which
 * kid), in one picker. Never a grown-up's: whoever approves a code mustn't get a key that opens a
 * grown-up's private journal. Value: 'wall' or kid:memberId (wallScreen.ts deviceKindValue); ''
 * (only with `legacy`) for one paired before anyone said, or as a grown-up's (needs a fix). */
export function DeviceKindSelect({ value, onChange, members, id, label, legacy }: { value: string; onChange: (v: string) => void; members?: Member[]; id?: string; label?: string; legacy?: boolean }) {
  const ctx = useContext(AppContext)
  const list = members ?? ctx?.members ?? []
  const kids = list.filter(m => !m.grownUp)
  return (
    <select className="settings-select" id={id} aria-label={label} value={value} onChange={e => onChange(e.target.value)}>
      {legacy && <option value="" disabled>{t('Pick one')}</option>}
      <option value="wall">🖼️ {t('Shared (whole family)')}</option>
      {kids.length > 0 && <optgroup label={t("A kid's device")}>{kids.map(m => <option key={m.id} value={`kid:${m.id}`}>{m.avatar} {t("{name}'s device", { name: m.name })}</option>)}</optgroup>}
    </select>
  )
}
