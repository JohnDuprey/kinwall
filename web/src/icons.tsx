// Small inline SVG icon set — no icon library per SPEC.
import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>
// Decorative by default: every icon sits next to text or inside a control with its own aria-label.
const base = (p: P) => ({ 'aria-hidden': true, width: 26, height: 26, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, ...p })

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
export const ListIcon = (p: P) => (
  <svg {...base(p)}><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4.5 6l.75.75L6.5 5.25" /><path d="M4.5 12l.75.75 1.25-1.5" /><path d="M4.5 18l.75.75 1.25-1.5" /></svg>
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
export const NoteIcon = (p: P) => (
  <svg {...base(p)}><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 13h7M9 17h5" /></svg>
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
export const BellIcon = (p: P) => (
  <svg {...base(p)}><path d="M6 8a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>
)
export const HelpIcon = (p: P) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7" /><path d="M12 17h.01" /></svg>
)
export const FilterIcon = (p: P) => (
  <svg {...base(p)}><path d="M3 5h18l-7 8.5V19l-4 2v-7.5z" /></svg>
)

export const DropperIcon = (p: P) => (
  <svg {...base(p)}><path d="M3 21l1-4 9.5-9.5 3 3L7 20l-4 1zM13.5 7.5l3-3a2.1 2.1 0 0 1 3 3l-3 3" /></svg>
)
export const BrushIcon = (p: P) => (
  <svg {...base(p)}><path d="M18.4 2.6a2 2 0 0 1 2.9 2.9L12 14.8 9.2 12z" /><path d="M9 13c-2.5 0-4 1.6-4 3.8 0 1.6-1 2.7-2.5 3.2C4 21 6 21.5 8 21c2.6-.6 4-2.4 4-5z" /></svg>
)
export const StickerIcon = (p: P) => (
  <svg {...base(p)}><path d="M21 12V6a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h6z" /><path d="M21 12l-9 9v-6a3 3 0 0 1 3-3z" /><path d="M8.5 9.5h.01M13.5 9.5h.01M8.5 14c1 1 2.6 1.3 4 .6" /></svg>
)
export const EraserIcon = (p: P) => (
  <svg {...base(p)}><path d="M7 21l-4-4a2 2 0 0 1 0-2.8L13.2 4a2 2 0 0 1 2.8 0l5 5a2 2 0 0 1 0 2.8L11 21zM21 21H7M8.5 9.5l6 6" /></svg>
)
export const BucketIcon = (p: P) => (
  <svg {...base(p)}><path d="M11 3L3 11l7 7 8-8zM3 11h15" /><path d="M20 14s2 2.4 2 3.7a2 2 0 0 1-4 0c0-1.3 2-3.7 2-3.7z" /></svg>
)
export const UndoIcon = (p: P) => (
  <svg {...base(p)}><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></svg>
)
export const RedoIcon = (p: P) => (
  <svg {...base(p)}><path d="M15 14l5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h3" /></svg>
)
export const PrinterIcon = (p: P) => (
  <svg {...base(p)}><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="7" rx="1" /></svg>
)
export const DownloadIcon = (p: P) => (
  <svg {...base(p)}><path d="M12 3v12M7 10l5 5 5-5M4 21h16" /></svg>
)
export const HeartIcon = (p: P) => (
  <svg {...base(p)}><path d="M12 20.5s-7.5-4.6-9.3-9A5 5 0 0 1 12 6.6a5 5 0 0 1 9.3 4.9c-1.8 4.4-9.3 9-9.3 9z" /></svg>
)
export const ImagesIcon = (p: P) => (
  <svg {...base(p)}><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="2" /><path d="M21 15l-5-5L5 21" /></svg>
)
