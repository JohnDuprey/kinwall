// Rewards: things a parent sets up ("🍿 Movie night, 100 points") that a member spends chore points
// on (server: routes/rewards.ts). The panel shows one member's rewards, a goal to save for and their
// recent requests; parents also add, edit and archive rewards here. Deciding on requests lives in
// the Chores tab's "To approve" section (RewardRequestRow below).
import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { api, ApiError } from './api.ts'
import { useApp } from './AppContext.tsx'
import { useDialog } from './dialog.tsx'
import { announce, Segmented } from './a11y.tsx'
import { inkFor } from './color.ts'
import Sheet from './Sheet.tsx'
import { AnyEmojiField } from './AnyEmojiField.tsx'
import { isSingleEmoji } from './emoji.ts'
import { ChevronLeft } from './icons.tsx'
import type { Member, Redemption, RedemptionStatus, Reward, RewardLimit } from './types.ts'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const rewardLabel = (r: { emoji: string | null; title: string }) => (r.emoji ? `${r.emoji} ${r.title}` : r.title)
const periodWord = (l: RewardLimit) => (l.period === 'day' ? 'today' : 'this week')

const STATUS_TEXT: Record<RedemptionStatus, string> = { pending: 'Waiting for OK', approved: 'Approved', given: 'Given', declined: 'Not this time' }

/** The Rewards activity (#/activities/rewards): whose rewards, then the panel. A device that belongs
 * to one member shows only theirs. */
export default function Rewards() {
  const { members, selectedMemberId, meMemberId, focusLocked, focusMemberId } = useApp()
  const choices = focusLocked && focusMemberId ? members.filter(m => m.id === focusMemberId) : members
  const [memberId, setMemberId] = useState<string | null>(() =>
    (choices.some(m => m.id === selectedMemberId) ? selectedMemberId : choices.find(m => m.id === meMemberId)?.id ?? choices[0]?.id) ?? null)
  const member = choices.find(m => m.id === memberId) ?? null
  return (
    <div className="stickers">
      <div className="stickers-head">
        <a className="paint-btn" href="#/activities" aria-label="Back to activities"><ChevronLeft /></a>
        {choices.length > 1 && (
          <div className="chip-row stickers-members" role="group" aria-label="Whose rewards?">
            {choices.map(m => (
              <button key={m.id} className={`chip ${m.id === memberId ? 'active' : ''}`} aria-pressed={m.id === memberId}
                style={{ ['--chip-color' as string]: m.color }} onClick={() => { setMemberId(m.id); announce(`${m.name}'s rewards`) }}>
                <span className="stickers-avatar" style={{ background: m.color, color: inkFor(m.color) }} aria-hidden="true">{m.avatar || m.name[0]}</span>{m.name}
              </button>
            ))}
          </div>
        )}
      </div>
      {member ? <RewardsPanel member={member} /> : <div className="stickers-empty"><p>Add a family member in Settings to use rewards.</p></div>}
    </div>
  )
}

/** One member's rewards, goal and recent requests. Also the sticker book's Rewards tab. */
export function RewardsPanel({ member }: { member: Member }) {
  const { refreshTick, reloadCore, toast, parentDevice } = useApp()
  const dialog = useDialog()
  const [rewards, setRewards] = useState<Reward[] | null>(null)
  const [history, setHistory] = useState<Redemption[]>([])
  const [balance, setBalance] = useState(member.balance)
  const [managing, setManaging] = useState(false)
  useEffect(() => { setBalance(member.balance) }, [member.balance])

  const load = () => {
    let canceled = false
    Promise.all([api.getRewards({ memberId: member.id }), api.getRedemptions({ memberId: member.id, limit: 8 })])
      .then(([r, h]) => { if (!canceled) { setRewards(r); setHistory(h) } })
      .catch(() => { if (!canceled) toast("Couldn't load rewards.", true) })
    return () => { canceled = true }
  }
  useEffect(load, [member.id, refreshTick]) // eslint-disable-line react-hooks/exhaustive-deps

  const goalId = member.rewardGoal?.rewardId ?? null
  const setGoal = async (r: Reward) => {
    const next = goalId === r.id ? null : r.id
    try {
      await api.setRewardGoal(member.id, next)
      announce(next ? `Saving for ${r.title}` : 'Goal cleared')
      reloadCore()
    } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't change the goal.", true) }
  }

  const redeem = async (r: Reward) => {
    const waits = r.needsApproval && !parentDevice
    if (!await dialog.confirm({
      title: `Spend ${plural(r.cost, 'point')} on ${rewardLabel(r)}?`,
      body: `${member.name} will have ${balance - r.cost} left.${waits ? ' A grown-up will OK it first.' : ''}`,
      confirmLabel: 'Redeem',
    })) return
    try {
      const res = await api.redeemReward(r.id, member.id)
      setBalance(res.balance)
      const msg = res.redemption.status === 'pending' ? `Asked for ${r.title}. Waiting for OK.` : `${r.title}: enjoy!`
      toast(msg)
      announce(msg)
      load()
      reloadCore()
    } catch (e) {
      toast(e instanceof ApiError ? e.message : `Couldn't redeem ${r.title}.`, true)
      load()
    }
  }

  return (
    <div className="stickers-shop scroll-y rewards">
      <p className="stickers-balance"><strong>{member.name}</strong> has <strong>{plural(balance, 'point')}</strong> to spend</p>
      {rewards && rewards.length === 0 && (
        <p className="snap-empty">No rewards yet.{parentDevice ? ' Add some with Manage rewards below.' : ' A grown-up can add some.'}</p>
      )}
      <ul className="sticker-packs" aria-label="Rewards">
        {(rewards ?? []).map(r => {
          const usedUp = !!r.limit && (r.used ?? 0) >= r.limit.count
          const short = r.cost - balance
          const goal = goalId === r.id
          return (
            <li key={r.id} className={`sticker-pack reward-card ${goal ? 'goal' : ''}`}>
              <span className="sticker-pack-cover" aria-hidden="true">{r.emoji ?? '🎁'}</span>
              <span className="sticker-pack-name">{r.title}</span>
              <span className="reward-meta">
                {plural(r.cost, 'point')}
                {r.limit && !usedUp && <> · {r.used ?? 0} of {r.limit.count} {periodWord(r.limit)}</>}
              </span>
              <button className={`reward-goal-btn ${goal ? 'on' : ''}`} aria-pressed={goal} onClick={() => setGoal(r)}>
                <span aria-hidden="true">{goal ? '★' : '☆'}</span> {goal ? 'Saving for this' : 'Save for this'}
              </button>
              {usedUp
                ? <span className="reward-state">That's all for {periodWord(r.limit!)}</span>
                : short > 0
                  ? <span className="reward-state">{plural(short, 'more point')} to go</span>
                  : <button className="btn btn-primary" onClick={() => redeem(r)} aria-label={`Redeem ${r.title} for ${plural(r.cost, 'point')}`}>Redeem</button>}
            </li>
          )
        })}
      </ul>
      {history.length > 0 && (
        <section className="reward-history" aria-labelledby="reward-history-heading">
          <h3 id="reward-history-heading" className="snap-heading">Recent</h3>
          <ul className="snap-list">
            {history.map(h => (
              <li key={h.id} className="reward-history-row">
                <span className="approve-emoji" aria-hidden="true">{h.emoji ?? '🎁'}</span>
                <span className="snap-main">
                  <span className="snap-title">{h.title}</span>
                  <span className="snap-meta">{format(new Date(h.requestedAt), 'EEE, MMM d')} · {plural(h.cost, 'point')}</span>
                </span>
                <span className={`reward-status ${h.status}`}>{STATUS_TEXT[h.status]}{h.status === 'declined' && h.note ? `: ${h.note}` : ''}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {parentDevice && <button className="btn btn-secondary reward-manage" onClick={() => setManaging(true)}>Manage rewards</button>}
      {managing && <RewardsManageSheet onClose={() => { setManaging(false); load(); reloadCore() }} />}
    </div>
  )
}

/** Parents: every reward, archived ones too, to add, edit, archive or restore. */
function RewardsManageSheet({ onClose }: { onClose: () => void }) {
  const { members, toast, refreshTick } = useApp()
  const [all, setAll] = useState<Reward[]>([])
  const [editing, setEditing] = useState<Reward | 'new' | null>(null)
  const load = () => { api.getRewards({ archived: true }).then(setAll).catch(() => toast("Couldn't load rewards.", true)) }
  useEffect(load, [refreshTick]) // eslint-disable-line react-hooks/exhaustive-deps
  const forWho = (r: Reward) => r.memberIds.length ? r.memberIds.map(id => members.find(m => m.id === id)?.name).filter(Boolean).join(', ') : 'Everyone'
  const limitText = (r: Reward) => r.limit ? `up to ${r.limit.count} a ${r.limit.period}` : ''
  return (
    <>
      <Sheet title="Rewards" onClose={onClose} actions={<button className="btn btn-primary" onClick={() => setEditing('new')}>Add reward</button>}>
        {all.length === 0 && <p className="snap-empty">No rewards yet. Add a few things worth saving up for.</p>}
        <ul className="snap-list">
          {all.map(r => (
            <li key={r.id}>
              <button className={`snap-row reward-manage-row ${r.active ? '' : 'archived'}`} onClick={() => setEditing(r)} aria-label={`Edit ${r.title}`}>
                <span className="approve-emoji" aria-hidden="true">{r.emoji ?? '🎁'}</span>
                <span className="snap-main">
                  <span className="snap-title">{r.title}{r.active ? '' : ' (archived)'}</span>
                  <span className="snap-meta">{[plural(r.cost, 'point'), forWho(r), r.needsApproval ? "needs a parent's OK" : 'no OK needed', limitText(r)].filter(Boolean).join(' · ')}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
      {editing && <RewardEditSheet reward={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
    </>
  )
}

const REWARD_EMOJI = ['🍿', '🍦', '📺', '🎮', '🌙', '🍕', '🎨', '🏞️', '🧸', '💵']

function RewardEditSheet({ reward, onClose, onSaved }: { reward: Reward | null; onClose: () => void; onSaved: () => void }) {
  const { members, toast } = useApp()
  const dialog = useDialog()
  const [title, setTitle] = useState(reward?.title ?? '')
  const [emoji, setEmoji] = useState(reward?.emoji ?? REWARD_EMOJI[0])
  const [cost, setCost] = useState(reward?.cost ?? 20)
  const [memberIds, setMemberIds] = useState<string[]>(reward?.memberIds ?? [])
  const [needsApproval, setNeedsApproval] = useState(reward?.needsApproval ?? true)
  const [limited, setLimited] = useState(!!reward?.limit)
  const [count, setCount] = useState(reward?.limit?.count ?? 1)
  const [period, setPeriod] = useState<RewardLimit['period']>(reward?.limit?.period ?? 'week')
  const valid = !!title.trim() && isSingleEmoji(emoji) && cost > 0

  const save = async (extra: Partial<Reward> = {}) => {
    const body: Partial<Reward> = { title: title.trim(), emoji, cost, memberIds, needsApproval, limit: limited ? { count: Math.min(20, Math.max(1, count)), period } : null, ...extra }
    try {
      if (reward) await api.updateReward(reward.id, body)
      else await api.createReward(body)
      onSaved()
    } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't save the reward.", true) }
  }
  const del = async () => {
    if (!reward || !await dialog.confirm({ title: `Delete "${reward.title}"?`, body: 'Past requests stay in history. Archiving keeps it out of sight without deleting.', confirmLabel: 'Delete', danger: true })) return
    try { await api.deleteReward(reward.id); onSaved() } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't delete the reward.", true) }
  }
  const toggleMember = (id: string) => setMemberIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id])

  return (
    <Sheet title={reward ? 'Edit reward' : 'New reward'} onClose={onClose}
      actions={
        <>
          {reward && <button className="btn btn-danger" onClick={del}>Delete</button>}
          {reward && <button className="btn btn-secondary" onClick={() => save({ active: !reward.active })} disabled={!valid}>{reward.active ? 'Archive' : 'Restore'}</button>}
          <button className="btn btn-primary" onClick={() => save()} disabled={!valid}>{reward ? 'Save' : 'Add reward'}</button>
        </>
      }>
      <div className="field">
        <label htmlFor="reward-title">Name</label>
        <input id="reward-title" type="text" maxLength={80} value={title} onChange={e => setTitle(e.target.value)} placeholder="Movie night pick" autoComplete="off" autoFocus={!reward} />
      </div>
      <div className="field">
        <label>Emoji</label>
        <div className="emoji-swatch-row">
          {REWARD_EMOJI.map(e => (
            <button key={e} className={`emoji-swatch ${emoji === e ? 'active' : ''}`} aria-pressed={emoji === e} onClick={() => setEmoji(e)}>{e}</button>
          ))}
        </div>
        <AnyEmojiField value={emoji} onChange={setEmoji} />
      </div>
      <div className="field">
        <label htmlFor="reward-cost">Points</label>
        <input id="reward-cost" type="text" inputMode="numeric" value={cost} onChange={e => setCost(Number(e.target.value.replace(/\D/g, '')) || 0)} />
      </div>
      <div className="field">
        <label id="reward-for-label">For</label>
        <div className="chip-row" role="group" aria-labelledby="reward-for-label">
          <button className={`chip ${memberIds.length === 0 ? 'active' : ''}`} aria-pressed={memberIds.length === 0} onClick={() => setMemberIds([])}>🌟 Everyone</button>
          {members.map(m => (
            <button key={m.id} className={`chip ${memberIds.includes(m.id) ? 'active' : ''}`} aria-pressed={memberIds.includes(m.id)} style={{ ['--chip-color' as string]: m.color }} onClick={() => toggleMember(m.id)}>{m.avatar} {m.name}</button>
          ))}
        </div>
      </div>
      <div className="field">
        <div className="toggle-row">
          <label id="reward-approval-label">Needs a parent's OK</label>
          <button className={`switch ${needsApproval ? 'on' : ''}`} role="switch" aria-checked={needsApproval} aria-labelledby="reward-approval-label" onClick={() => setNeedsApproval(v => !v)}><span className="knob" /></button>
        </div>
        <p className="field-hint">When it's on, redeeming on a wall screen or kid's device waits for a parent to approve. The points are set aside meanwhile and come back if you say not this time.</p>
      </div>
      <div className="field">
        <label id="reward-limit-label">Limit</label>
        <Segmented label="Limit" value={limited ? 'on' : 'off'} onChange={v => setLimited(v === 'on')} options={[{ key: 'off', label: 'No limit' }, { key: 'on', label: 'Up to…' }]} />
        {limited && (
          <div className="reward-limit-row">
            <span>Up to</span>
            <input aria-label="How many" type="number" inputMode="numeric" min={1} max={20} value={count}
              onChange={e => setCount(Math.min(20, Number(e.target.value.replace(/\D/g, '')) || 0))} onBlur={() => setCount(c => Math.max(1, c))} />
            <span>a</span>
            <Segmented label="Per" value={period} onChange={setPeriod} options={[{ key: 'day', label: 'day' }, { key: 'week', label: 'week' }]} />
          </div>
        )}
        <p className="field-hint">For each person. Requests you say not this time to don't count.</p>
      </div>
    </Sheet>
  )
}
