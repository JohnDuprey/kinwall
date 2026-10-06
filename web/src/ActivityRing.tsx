// A small ring showing how far along an activity chore is (the player's chip, the chore card). It's
// decorative: the text beside it ("3 of 10 min", "done ✓") is what's announced.
import { ringFraction } from './playtime.ts'

export function ActivityRing({ done, need, complete }: { done: number; need: number; complete?: boolean }) {
  const f = complete ? 1 : ringFraction(done, need)
  return (
    <svg className={`activity-ring ${complete ? 'complete' : ''}`} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <circle className="activity-ring-track" cx="10" cy="10" r="8" />
      <circle className="activity-ring-fill" cx="10" cy="10" r="8" pathLength="100" strokeDasharray="100" strokeDashoffset={100 * (1 - f)} transform="rotate(-90 10 10)" />
      {complete && <path className="activity-ring-check" d="M6.2 10.4l2.5 2.5 5-5.2" />}
    </svg>
  )
}
