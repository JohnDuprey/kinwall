// Rewards: things a parent sets up ("🍿 Movie night, 100 points") that a member spends chore points
// on (server: routes/rewards.ts). Points are earned on Chores and spent here: the screen shows one
// member's balance, their goal, what they can get now and what they're saving for, requests
// waiting for a grown-up, and a way into the sticker shop. Parents also decide on requests (the
// same queue as Chores' "To approve") and add, edit and archive rewards here.
import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { api, ApiError } from './api.ts'
import { useApp } from './AppContext.tsx'
import { useDialog } from './dialog.tsx'
import { announce, Segmented } from './a11y.tsx'
import Sheet from './Sheet.tsx'
import { AnyEmojiField } from './AnyEmojiField.tsx'
import { isSingleEmoji } from './emoji.ts'
import { ApprovalQueue } from './Chores.tsx'
import type { Member, Redemption, RedemptionStatus, Reward, RewardLimit } from './types.ts'
import { Face, ChipFace } from './Face'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const rewardLabel = (r: { emoji: string | null; title: string }) => (r.emoji ? `${r.emoji} ${r.title}` : r.title)
const periodWord = (l: RewardLimit) => (l.period === 'day' ? 'today' : 'this week')
const usedUp = (r: Reward) => !!r.limit && (r.used ?? 0) >= r.limit.count

const STATUS_TEXT: Record<RedemptionStatus, string> = { pending: 'Waiting for OK', approved: 'Approved! Coming soon', given: 'Given', declined: 'Not this time' }

/** One tap on an empty Rewards screen adds one of these (a parent can edit it after). */
const SUGGESTIONS: Partial<Reward>[] = [
  { emoji: '🍿', title: 'Pick the movie', cost: 30 },
  { emoji: '📺', title: '15 min screen time', cost: 10, limit: { count: 3, period: 'day' } },
  { emoji: '🌙', title: 'Stay up 15 minutes', cost: 20, limit: { count: 1, period: 'day' } },
  { emoji: '🍦', title: 'Ice cream trip', cost: 50 },
]

/** The Rewards screen (#/rewards, #/rewards/<memberId>): whose rewards, then the panel. A device
 * that belongs to one member shows only theirs, whatever the link says. */
export default function Rewards({ memberId: fromUrl }: { memberId?: string }) {
  const { members, selectedMemberId, meMemberId, focusLocked, focusMemberId } = useApp()
  const choices = focusLocked && focusMemberId ? members.filter(m => m.id === focusMemberId) : members
  const memberId = [fromUrl, selectedMemberId, meMemberId].find(id => choices.some(m => m.id === id)) ?? choices[0]?.id
  const member = choices.find(m => m.id === memberId) ?? null
  return (
    <div className="stickers">
      {choices.length > 1 && (
        <div className="stickers-head">
          <div className="chip-row stickers-members" role="group" aria-label="Whose rewards?">
            {choices.map(m => (
              <button key={m.id} className={`chip ${m.id === memberId ? 'active' : ''}`} aria-pressed={m.id === memberId}
                style={{ ['--chip-color' as string]: m.color }} onClick={() => { location.replace(`#/rewards/${m.id}`); announce(`${m.name}'s rewards`) }}>
                <Face m={m} className="stickers-avatar" aria-hidden="true" />{m.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {member ? <RewardsPanel key={member.id} member={member} /> : <div className="stickers-empty"><p>Add a family member in Settings to use rewards.</p></div>}
    </div>
  )
}

/** One member's balance, goal, rewards (ready now / keep saving / used up), requests and history. */
function RewardsPanel({ member }: { member: Member }) {
  const { refreshTick, reloadCore, toast, parentDevice, settings, meMemberId } = useApp()
  const dialog = useDialog()
  const [rewards, setRewards] = useState<Reward[] | null>(null)
  const [history, setHistory] = useState<Redemption[]>([])
  const [balance, setBalance] = useState(member.balance)
  const [managing, setManaging] = useState(false)
  const [adding, setAdding] = useState(false)
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
  const saveFor = async (next: string | null, title: string) => {
    try {
      await api.setRewardGoal(member.id, next)
      announce(next ? `Saving for ${title}` : 'Goal cleared')
      reloadCore()
    } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't change the goal.", true) }
  }
  const setGoal = (r: Reward) => saveFor(goalId === r.id ? null : r.id, r.title)

  const redeem = async (r: Reward) => {
    const waits = r.needsApproval && !parentDevice
    if (!await dialog.confirm({
      title: `Spend ${plural(r.cost, 'point')} on ${rewardLabel(r)}?`,
      body: `${member.name} will have ${balance - r.cost} left.${waits ? ' A grown-up will OK it first.' : ''}`,
      confirmLabel: 'Get it',
    })) return
    try {
      const res = await api.redeemReward(r.id, member.id)
      setBalance(res.balance)
      const msg = res.redemption.status === 'pending' ? `Asked for ${r.title}. Waiting for a grown-up.` : `${r.title}: enjoy!`
      toast(msg)
      announce(msg)
      load()
      reloadCore()
    } catch (e) {
      toast(e instanceof ApiError ? e.message : `Couldn't get ${r.title}.`, true)
      load()
    }
  }

  // A kid's own device cancels a request still waiting for a grown-up; the points come back.
  const ownDevice = !parentDevice && meMemberId === member.id
  const cancelRequest = async (h: Redemption) => {
    if (!await dialog.confirm({
      title: `Cancel the request for ${rewardLabel(h)}?`,
      body: `${member.name} gets the ${plural(h.cost, 'point')} back.`,
      confirmLabel: 'Cancel request',
      cancelLabel: 'Keep it',
    })) return
    try {
      const res = await api.cancelRedemption(h.id)
      setBalance(res.balance)
      const msg = `Canceled: ${h.title}. ${plural(h.cost, 'point')} back.`
      toast(msg)
      announce(msg)
    } catch (e) { toast(e instanceof ApiError ? e.message : `Couldn't cancel ${h.title}.`, true) }
    load()
    reloadCore()
  }

  const addSuggestion = async (s: Partial<Reward>) => {
    try {
      await api.createReward({ memberIds: [], needsApproval: true, limit: null, ...s })
      announce(`Added ${s.title}`)
      load()
    } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't add the reward.", true) }
  }

  const goal = member.rewardGoal ?? null
  const list = rewards ?? []
  const groups = [
    { key: 'ready', title: 'Ready now', items: list.filter(r => !usedUp(r) && r.cost <= balance) },
    { key: 'saving', title: 'Keep saving', items: list.filter(r => !usedUp(r) && r.cost > balance) },
    { key: 'used', title: 'All used up for now', items: list.filter(usedUp) },
  ].filter(g => g.items.length)
  // Parents see every request in the queue above, so theirs isn't repeated.
  const waiting = parentDevice ? [] : history.filter(h => h.status === 'pending' || h.status === 'approved')
  const past = history.filter(h => h.status === 'given' || (h.status === 'declined' && (parentDevice || ownDevice)))

  const card = (r: Reward) => {
    const short = r.cost - balance
    const isGoal = goalId === r.id
    return (
      <li key={r.id} className={`sticker-pack reward-card ${isGoal ? 'goal' : ''}`}>
        <span className="sticker-pack-cover" aria-hidden="true">{r.emoji ?? '🎁'}</span>
        <span className="sticker-pack-name">{r.title}</span>
        <span className="reward-meta">
          {plural(r.cost, 'point')}
          {r.limit && !usedUp(r) && <> · {r.used ?? 0} of {r.limit.count} {periodWord(r.limit)}</>}
        </span>
        {short > 0 && !usedUp(r) && <Meter have={balance} need={r.cost} color={member.color} />}
        <button className={`reward-goal-btn ${isGoal ? 'on' : ''}`} aria-pressed={isGoal} onClick={() => setGoal(r)}>
          <span aria-hidden="true">{isGoal ? '★' : '☆'}</span> {isGoal ? 'Saving for this' : 'Save for this'}
        </button>
        {usedUp(r)
          ? <span className="reward-state">That's all for {periodWord(r.limit!)}</span>
          : short > 0
            ? <span className="reward-state">{plural(short, 'more point')}</span>
            : <button className="btn btn-primary" onClick={() => redeem(r)} aria-label={`Get ${r.title} for ${plural(r.cost, 'point')}`}>Get it</button>}
      </li>
    )
  }

  return (
    <div className="stickers-shop scroll-y rewards">
      <section className="rewards-hero" aria-label={`${member.name}'s points`}>
        <Face m={member} className="rewards-avatar" aria-hidden="true" />
        <div className="rewards-hero-text">
          <p className="rewards-balance"><strong>{member.name}</strong> has <strong className="rewards-points">{plural(balance, 'point')}</strong></p>
          <p className="rewards-how">Earn points by doing <a href="#/chores">chores</a>. Spend them on rewards{settings.stickersEnabled ? ' and sticker packs' : ''}.</p>
        </div>
        {goal && (
          <div className="rewards-goal">
            <span className="rewards-goal-title">Saving for {rewardLabel(goal)}</span>
            <Meter have={balance} need={goal.cost} color={member.color} />
            <span className="rewards-goal-left">{balance >= goal.cost ? 'Ready! Tap Get it below.' : `${balance} of ${goal.cost} · ${plural(goal.cost - balance, 'more point')}`}</span>
            <button type="button" className="link-btn rewards-goal-stop" onClick={() => saveFor(null, '')}>Stop saving</button>
          </div>
        )}
      </section>

      {parentDevice && <ApprovalQueue only="rewards" />}

      {waiting.length > 0 && (
        <section className="reward-history" aria-labelledby="reward-waiting-heading">
          <h3 id="reward-waiting-heading" className="snap-heading">Waiting for a grown-up</h3>
          <ul className="snap-list">{waiting.map(h => <HistoryRow key={h.id} h={h} onCancel={ownDevice && h.status === 'pending' ? () => cancelRequest(h) : undefined} />)}</ul>
        </section>
      )}

      {rewards && list.length === 0 && (
        <div className="empty-card rewards-empty">
          <span className="emoji" aria-hidden="true">🎁</span>
          <p><strong>No rewards for {member.name} yet.</strong></p>
          {parentDevice ? <>
            <p>Rewards are treats your family's points can buy. Tap one to add it, or make your own.</p>
            <div className="chip-row rewards-suggestions">
              {SUGGESTIONS.map(s => (
                <button key={s.title} className="chip" onClick={() => addSuggestion(s)} aria-label={`Add ${s.title}, ${plural(s.cost!, 'point')}`}>
                  {s.emoji} {s.title} · {s.cost} pts
                </button>
              ))}
            </div>
            <button className="btn btn-primary" onClick={() => setAdding(true)}>Add your own</button>
          </> : <p>A grown-up can add some. Keep doing chores to save up points!</p>}
        </div>
      )}

      {groups.map(g => (
        <section key={g.key} className="rewards-group" aria-labelledby={`rewards-${g.key}`}>
          <h3 id={`rewards-${g.key}`} className="snap-heading">{g.title}</h3>
          <ul className="sticker-packs">{g.items.map(card)}</ul>
        </section>
      ))}

      {settings.stickersEnabled && (
        <a className="rewards-stickers" href={`#/activities/stickers?member=${member.id}&tab=shop`}>
          <span className="rewards-stickers-icon" aria-hidden="true">🛍️</span>
          <span><strong>Sticker packs</strong><span className="snap-meta">Spend points on stickers for {member.name}'s sticker book</span></span>
        </a>
      )}

      {past.length > 0 && (
        <section className="reward-history" aria-labelledby="reward-history-heading">
          <h3 id="reward-history-heading" className="snap-heading">Recent</h3>
          <ul className="snap-list">{past.map(h => <HistoryRow key={h.id} h={h} />)}</ul>
        </section>
      )}
      {parentDevice && <button className="btn btn-secondary reward-manage" onClick={() => setManaging(true)}>Manage rewards</button>}
      {managing && <RewardsManageSheet onClose={() => { setManaging(false); load(); reloadCore() }} />}
      {adding && <RewardEditSheet reward={null} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load() }} />}
    </div>
  )
}

function Meter({ have, need, color }: { have: number; need: number; color: string }) {
  return <span className="board-meter reward-meter" aria-hidden="true"><span style={{ width: `${Math.min(100, (Math.max(0, have) / need) * 100)}%`, background: color }} /></span>
}

function HistoryRow({ h, onCancel }: { h: Redemption; onCancel?: () => void }) {
  return (
    <li className="reward-history-row">
      <span className="approve-emoji" aria-hidden="true">{h.emoji ?? '🎁'}</span>
      <span className="snap-main">
        <span className="snap-title">{h.title}</span>
        <span className="snap-meta">{format(new Date(h.requestedAt), 'EEE, MMM d')} · {plural(h.cost, 'point')}</span>
      </span>
      <span className={`reward-status ${h.status}`}>{STATUS_TEXT[h.status]}{h.status === 'declined' && h.note ? `: ${h.note}` : ''}</span>
      {onCancel && <button className="btn btn-secondary reward-cancel" onClick={onCancel} aria-label={`Cancel the request for ${h.title}`}>Cancel request</button>}
    </li>
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
            <button key={m.id} className={`chip ${memberIds.includes(m.id) ? 'active' : ''}`} aria-pressed={memberIds.includes(m.id)} style={{ ['--chip-color' as string]: m.color }} onClick={() => toggleMember(m.id)}><ChipFace m={m} /> {m.name}</button>
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
