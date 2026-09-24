// Small inline SVG icon set — no icon library per SPEC.
import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>
const base = (p: P) => ({ width: 26, height: 26, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, ...p })

export const CalendarIcon = (p: P) => (
  <svg {...base(p)}><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
)
export const ChoreIcon = (p: P) => (
  <svg {...base(p)}><path d="M9 11.5l2 2 4-4.5" /><rect x="3" y="3" width="18" height="18" rx="4" /></svg>
)
export const SettingsIcon = (p: P) => (
  // gear from Lucide (ISC license, lucide.dev)
  <svg {...base(p)}><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
)
export const PlusIcon = (p: P) => (
  <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>
)
export const XIcon = (p: P) => (
  <svg {...base(p)}><path d="M6 6l12 12M18 6L6 18" /></svg>
)
export const ChevronLeft = (p: P) => (
  <svg {...base(p)}><path d="M15 5l-7 7 7 7" /></svg>
)
export const ChevronRight = (p: P) => (
  <svg {...base(p)}><path d="M9 5l7 7-7 7" /></svg>
)
export const TrashIcon = (p: P) => (
  <svg {...base(p)}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>
)
export const EditIcon = (p: P) => (
  <svg {...base(p)}><path d="M4 20l4-1 11-11-3-3L5 16l-1 4z" /></svg>
)
export const CheckIcon = (p: P) => (
  <svg {...base(p)}><path d="M5 13l4 4L19 7" /></svg>
)
export const KeyIcon = (p: P) => (
  <svg {...base(p)}><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l2 2M14 9l2 2" /></svg>
)
export const WebhookIcon = (p: P) => (
  <svg {...base(p)}><circle cx="6" cy="17" r="2.5" /><circle cx="17" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8 16l7-8M9 18h6.5" /></svg>
)
export const SunIcon = (p: P) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="4.5" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></svg>
)
export const MoonIcon = (p: P) => (
  <svg {...base(p)}><path d="M20 14.5A8.5 8.5 0 1110 3.3a7 7 0 0010 11.2z" /></svg>
)
export const LocationIcon = (p: P) => (
  <svg {...base(p)}><path d="M12 21s7-7.2 7-12a7 7 0 10-14 0c0 4.8 7 12 7 12z" /><circle cx="12" cy="9" r="2.3" /></svg>
)
export const RepeatIcon = (p: P) => (
  <svg {...base(p)}><path d="M17 2l4 4-4 4M3 11V9a4 4 0 014-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 01-4 4H3" /></svg>
)
export const LinkIcon = (p: P) => (
  <svg {...base(p)}><path d="M10 14a4 4 0 006 0l3-3a4 4 0 00-6-6l-1.5 1.5" /><path d="M14 10a4 4 0 00-6 0l-3 3a4 4 0 006 6l1.5-1.5" /></svg>
)
export const LockIcon = (p: P) => (
  <svg {...base(p)}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></svg>
)
export const PaletteIcon = (p: P) => (
  <svg {...base(p)}><path d="M12 3a9 9 0 100 18c1.5 0 2-1 2-2s-.5-1.5-.5-2 .5-1 1.5-1H17a4 4 0 004-4c0-5-4-9-9-9z" /><circle cx="7.5" cy="10.5" r="1.2" fill="currentColor" stroke="none" /><circle cx="10.5" cy="7" r="1.2" fill="currentColor" stroke="none" /><circle cx="15" cy="7.5" r="1.2" fill="currentColor" stroke="none" /></svg>
)
export const MonitorIcon = (p: P) => (
  <svg {...base(p)}><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
)
