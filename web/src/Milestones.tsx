import { useEffect, useState } from 'react'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import Sheet from './Sheet.tsx'
import { AnyEmojiField } from './AnyEmojiField.tsx'
import { isSingleEmoji } from './emoji.ts'
import { ChipFace } from './Face.tsx'
import type { Milestone, MilestoneInput } from './types.ts'
import { t, tn } from './i18n.ts'

export function MilestonesPanel({ memberId }: { memberId: string }) {
  const { parentDevice, refreshTick, reloadCore, toast } = useApp()
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [adding, setAdding] = useState(false)
  const [archived, setArchived] = useState(false)
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let canceled = false
    api.getMilestones({ memberId, archived: true }).then(rows => { if (!canceled) setMilestones(rows) }).catch(() => { if (!canceled) toast(t("Couldn't load milestones."), true) })
    return () => { canceled = true }
  }, [memberId, refreshTick, revision, toast])
  const change = async (action: () => Promise<unknown>) => {
    setBusy(true)
    try { await action(); setRevision(n => n + 1); reloadCore() }
    catch { toast(t("Couldn't update the milestone."), true) }
    finally { setBusy(false) }
  }
  const visible = milestones.filter(m => m.active || archived || m.members.some(p => p.earnedAt && !p.givenAt))
  if (!parentDevice && !visible.length) return null
  return <section className="milestones" aria-label={t('Reward milestones')}>
    <div className="milestones-heading"><h2>{t('Reward milestones')}</h2>{parentDevice && <button className="btn btn-secondary" onClick={() => setAdding(true)}>{t('Add milestone')}</button>}</div>
    <p className="field-hint">{t('Earn a reward by reaching a target. Your points stay yours to spend.')}</p>
    {!visible.length && <p>{t('Add a points or chore target and a reward to work toward.')}</p>}
    <ul className="milestones-list">{visible.map(m => {
      const p = m.members.find(p => p.memberId === memberId)!
      const progress = m.metric === 'points' ? tn(m.target, '{have} of {n} point earned', '{have} of {n} points earned', { have: p.progress }) : tn(m.target, '{have} of {n} chore completed', '{have} of {n} chores completed', { have: p.progress })
      return <li className="milestone-card" key={m.id}>
        <h3>{m.emoji ?? '🎁'} {m.title}</h3><p>{m.reward}</p>
        {!m.active && <span className="chip-static">{t('Archived')}</span>}
        <label className="milestone-progress">{progress}<progress max={m.target} value={p.progress} /></label>
        {p.givenAt ? <p className="reward-state">{t('Given')}</p> : p.earnedAt ? <>
          <p className="reward-state">{t('Earned! Ask a grown-up to arrange it.')}</p>
          {parentDevice && <button className="btn btn-primary" disabled={busy} onClick={() => change(() => api.giveMilestone(m.id, memberId))}>{t('Mark given')}</button>}
        </> : null}
        {parentDevice && <div className="sheet-danger-zone"><button className="link-btn" disabled={busy} onClick={() => change(() => api.updateMilestone(m.id, !m.active))}>{m.active ? t('Archive milestone') : t('Restore milestone')}</button></div>}
      </li>
    })}</ul>
    {parentDevice && <button className="link-btn" aria-pressed={archived} onClick={() => setArchived(!archived)}>{archived ? t('Hide archived milestones') : t('Show archived milestones')}</button>}
    {adding && <MilestoneEditor memberId={memberId} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); setRevision(n => n + 1); reloadCore() }} />}
  </section>
}

function MilestoneEditor({ memberId, onClose, onSaved }: { memberId: string; onClose: () => void; onSaved: () => void }) {
  const { members, toast } = useApp()
  const [title, setTitle] = useState('')
  const [reward, setReward] = useState('')
  const [emoji, setEmoji] = useState('🎁')
  const [metric, setMetric] = useState<MilestoneInput['metric']>('points')
  const [target, setTarget] = useState('100')
  const [ids, setIds] = useState([memberId])
  const [saving, setSaving] = useState(false)
  const value = Number(target)
  const valid = title.trim() && reward.trim() && isSingleEmoji(emoji) && ids.length > 0 && Number.isInteger(value) && value > 0 && value <= 1000000
  const save = async () => {
    if (!valid || saving) return
    setSaving(true)
    try { await api.createMilestone({ title: title.trim(), emoji, reward: reward.trim(), metric, target: value, memberIds: ids }); onSaved() }
    catch { toast(t("Couldn't save the milestone."), true) }
    finally { setSaving(false) }
  }
  return <Sheet title={t('New reward milestone')} onClose={onClose} dirty="auto" actions={<button className="btn btn-primary" disabled={!valid || saving} onClick={save}>{t('Add milestone')}</button>}>
    <div className="field"><label htmlFor="milestone-name">{t('Name')}</label><input id="milestone-name" maxLength={80} value={title} onChange={e => setTitle(e.target.value)} autoComplete="off" autoFocus /></div>
    <div className="field"><label>{t('Emoji')}</label><AnyEmojiField value={emoji} onChange={setEmoji} /></div>
    <div className="field"><label htmlFor="milestone-reward">{t('Reward')}</label><textarea id="milestone-reward" maxLength={300} value={reward} onChange={e => setReward(e.target.value)} placeholder={t('Pick the family movie')} /></div>
    <div className="field"><label htmlFor="milestone-type">{t('Count toward the target')}</label><select id="milestone-type" value={metric} onChange={e => setMetric(e.target.value as MilestoneInput['metric'])}><option value="points">{t('Points earned')}</option><option value="chores">{t('Approved chores')}</option></select></div>
    <div className="field"><label htmlFor="milestone-target">{t('Target')}</label><input id="milestone-target" type="number" inputMode="numeric" min={1} max={1000000} step={1} value={target} onChange={e => setTarget(e.target.value)} /></div>
    <div className="field"><label id="milestone-for">{t('For')}</label><div className="chip-row" role="group" aria-labelledby="milestone-for">{members.map(m => <button key={m.id} className={`chip ${ids.includes(m.id) ? 'active' : ''}`} aria-pressed={ids.includes(m.id)} onClick={() => setIds(ids.includes(m.id) ? ids.filter(id => id !== m.id) : [...ids, m.id])}><ChipFace m={m} />{m.name}</button>)}</div></div>
    <p className="field-hint">{t('Each person starts at zero now and earns the reward once. Earlier points and chores do not count. The target and people cannot be changed later.')}</p>
  </Sheet>
}
