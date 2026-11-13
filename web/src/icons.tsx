// Small inline SVG icon set — no runtime icon library.
// Lucide-derived outlines: see icons-LICENSE and docs/contributing/icons.md.
import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>
// Decorative by default: every icon sits next to text or inside a control with its own aria-label.
const base = (p: P) => ({ 'aria-hidden': true, focusable: 'false' as const, width: 26, height: 26, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, ...p })

export const CalendarIcon = (p: P) => (
  <svg {...base(p)}><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
)
// Home: the main screen (the Board and Newscast).
export const HomeIcon = (p: P) => (
  <svg {...base(p)}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9" /><path d="M10 21v-6h4v6" /></svg>
)
export const ChoreIcon = (p: P) => (
  <svg {...base(p)}><path d="M9 11.5l2 2 4-4.5" /><rect x="3" y="3" width="18" height="18" rx="4" /></svg>
)
export const MealIcon = (p: P) => (
  <svg {...base(p)}><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" /><path d="M7 2v20" /><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" /></svg>
)
export const TicketIcon = (p: P) => (
  <svg {...base(p)}><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" /><path d="M13 5v2" /><path d="M13 17v2" /><path d="M13 11v2" /></svg>
)
export const WrenchIcon = (p: P) => (
  <svg {...base(p)}><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z" /></svg>
)
export const SettingsIcon = (p: P) => (
  // gear from Lucide (ISC license, lucide.dev)
  <svg {...base(p)}><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
)
// Info: a circled i (an item's details).
export const InfoIcon = (p: P) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
)
export const MoreIcon = (p: P) => (
  // ellipsis, like Lucide's
  <svg {...base(p)}><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
)
export const ListIcon = (p: P) => (
  <svg {...base(p)}><path d="M13 5h8" /><path d="M13 12h8" /><path d="M13 19h8" /><path d="m3 17 2 2 4-4" /><path d="m3 7 2 2 4-4" /></svg>
)
export const BookIcon = (p: P) => (
  // open book, after Lucide's book-open (ISC license, lucide.dev)
  <svg {...base(p)}><path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2zM22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z" /></svg>
)
export const PersonIcon = (p: P) => (
  // person silhouette, after Lucide's user-round (ISC license, lucide.dev)
  <svg {...base(p)}><circle cx="12" cy="8" r="3.5" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></svg>
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
  <svg {...base(p)}><path d="M10 11v6" /><path d="M14 11v6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
)
export const EditIcon = (p: P) => (
  <svg {...base(p)}><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" /></svg>
)
export const NoteIcon = (p: P) => (
  <svg {...base(p)}><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /><path d="M14 2v5a1 1 0 0 0 1 1h5" /><path d="M10 9H8" /><path d="M16 13H8" /><path d="M16 17H8" /></svg>
)
export const CheckIcon = (p: P) => (
  <svg {...base(p)}><path d="M5 13l4 4L19 7" /></svg>
)
export const KeyIcon = (p: P) => (
  <svg {...base(p)}><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l2 2M14 9l2 2" /></svg>
)
export const WebhookIcon = (p: P) => (
  <svg {...base(p)}><path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2" /><path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06" /><path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8" /></svg>
)
export const SunIcon = (p: P) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" /></svg>
)
export const MoonIcon = (p: P) => (
  <svg {...base(p)}><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" /></svg>
)
export const LocationIcon = (p: P) => (
  <svg {...base(p)}><path d="M12 21s7-7.2 7-12a7 7 0 10-14 0c0 4.8 7 12 7 12z" /><circle cx="12" cy="9" r="2.3" /></svg>
)
export const RepeatIcon = (p: P) => (
  <svg {...base(p)}><path d="m17 2 4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="m7 22-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /></svg>
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
  <svg {...base(p)}><path d="M10.268 21a2 2 0 0 0 3.464 0" /><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" /></svg>
)
// Inbox: the quick-capture inbox (a demo preview, Inbox.tsx).
export const InboxIcon = (p: P) => (
  <svg {...base(p)}><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></svg>
)
export const HelpIcon = (p: P) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7" /><path d="M12 17h.01" /></svg>
)
export const CartIcon = (p: P) => (
  // shopping cart from Lucide (ISC license, lucide.dev)
  <svg {...base(p)}><circle cx="8" cy="21" r="1" /><circle cx="19" cy="21" r="1" /><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" /></svg>
)
export const BasketIcon = (p: P) => (
  // shopping basket from Lucide (ISC license, lucide.dev)
  <svg {...base(p)}><path d="m15 11-1 9" /><path d="m19 11-4-7" /><path d="M2 11h20" /><path d="m3.5 11 1.6 7.4a2 2 0 0 0 2 1.6h9.8a2 2 0 0 0 2-1.6l1.7-7.4" /><path d="M4.5 15.5h15" /><path d="m5 11 4-7" /><path d="m9 11 1 9" /></svg>
)
// A jar with a lid: the Pantry list type.
export const JarIcon = (p: P) => (
  <svg {...base(p)}><rect x="7" y="2.5" width="10" height="3.5" rx="1" /><path d="M8 6v1.5a3 3 0 0 1-2 2.8V19a2.5 2.5 0 0 0 2.5 2.5h7A2.5 2.5 0 0 0 18 19v-8.7a3 3 0 0 1-2-2.8V6" /><path d="M6 13h12" /></svg>
)
export const PillIcon = (p: P) => (
  // pill from Lucide (ISC license, lucide.dev)
  <svg {...base(p)}><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z" /><path d="m8.5 8.5 7 7" /></svg>
)
export const FilterIcon = (p: P) => (
  <svg {...base(p)}><path d="M3 5h18l-7 8.5V19l-4 2v-7.5z" /></svg>
)
export const SlidersIcon = (p: P) => (
  // sliders-horizontal from Lucide (ISC license, lucide.dev): Home's Layout and filter
  <svg {...base(p)}><path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4" /></svg>
)

export const DropperIcon = (p: P) => (
  <svg {...base(p)}><path d="m12 9-8.414 8.414A2 2 0 0 0 3 18.828v1.344a2 2 0 0 1-.586 1.414A2 2 0 0 1 3.828 21h1.344a2 2 0 0 0 1.414-.586L15 12" /><path d="m18 9 .4.4a1 1 0 1 1-3 3l-3.8-3.8a1 1 0 1 1 3-3l.4.4 3.4-3.4a1 1 0 1 1 3 3z" /><path d="m2 22 .414-.414" /></svg>
)
export const BrushIcon = (p: P) => (
  <svg {...base(p)}><path d="m11 10 3 3" /><path d="M6.5 21A3.5 3.5 0 1 0 3 17.5a2.62 2.62 0 0 1-.708 1.792A1 1 0 0 0 3 21z" /><path d="M9.969 17.031 21.378 5.624a1 1 0 0 0-3.002-3.002L6.967 14.031" /></svg>
)
export const StickerIcon = (p: P) => (
  <svg {...base(p)}><path d="M21 9a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z" /><path d="M15 3v5a1 1 0 0 0 1 1h5" /><path d="M8 13h.01" /><path d="M16 13h.01" /><path d="M10 16s.8 1 2 1c1.3 0 2-1 2-1" /></svg>
)
export const GiftIcon = (p: P) => (
  <svg {...base(p)}><path d="M12 7v14" /><path d="M20 11v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8" /><path d="M7.5 7a1 1 0 0 1 0-5A4.8 8 0 0 1 12 7a4.8 8 0 0 1 4.5-5 1 1 0 0 1 0 5" /><rect x="3" y="7" width="18" height="4" rx="1" /></svg>
)
export const EraserIcon = (p: P) => (
  <svg {...base(p)}><path d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21" /><path d="m5.082 11.09 8.828 8.828" /></svg>
)
export const BucketIcon = (p: P) => (
  <svg {...base(p)}><path d="M11 7 6 2" /><path d="M18.992 12H2.041" /><path d="M21.145 18.38A3.34 3.34 0 0 1 20 16.5a3.3 3.3 0 0 1-1.145 1.88c-.575.46-.855 1.02-.855 1.595A2 2 0 0 0 20 22a2 2 0 0 0 2-2.025c0-.58-.285-1.13-.855-1.595" /><path d="m8.5 4.5 2.148-2.148a1.205 1.205 0 0 1 1.704 0l7.296 7.296a1.205 1.205 0 0 1 0 1.704l-7.592 7.592a3.615 3.615 0 0 1-5.112 0l-3.888-3.888a3.615 3.615 0 0 1 0-5.112L5.67 7.33" /></svg>
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
  <svg {...base(p)}><path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5" /></svg>
)
export const ImagesIcon = (p: P) => (
  <svg {...base(p)}><path d="m22 11-1.296-1.296a2.4 2.4 0 0 0-3.408 0L11 16" /><path d="M4 8a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2" /><circle cx="13" cy="7" r="1" fill="currentColor" /><rect x="8" y="2" width="14" height="14" rx="2" /></svg>
)
export const CloudOffIcon = (p: P) => (
  // cloud-off from Lucide (ISC license, lucide.dev)
  <svg {...base(p)}><path d="m2 2 20 20" /><path d="M5.782 5.782A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.307-.193" /><path d="M21.532 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7.008 7.008 0 0 0 10 5.07" /></svg>
)
export const FileIcon = (p: P) => (
  <svg {...base(p)}><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></svg>
)
export const ExternalIcon = (p: P) => (
  <svg {...base(p)}><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" /></svg>
)
export const FitIcon = (p: P) => (
  <svg {...base(p)}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
)
export const MinusIcon = (p: P) => (
  <svg {...base(p)}><path d="M5 12h14" /></svg>
)
export const PlayIcon = (p: P) => (
  <svg {...base(p)}><path d="M7 4.5v15l12-7.5z" fill="currentColor" /></svg>
)
export const PauseIcon = (p: P) => (
  <svg {...base(p)}><path d="M8 5v14M16 5v14" strokeWidth={3} /></svg>
)
export const ResetIcon = (p: P) => (
  <svg {...base(p)}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
)
export const TimerIcon = (p: P) => (
  <svg {...base(p)}><circle cx="12" cy="14" r="8" /><path d="M12 10v4l2.5 2M9.5 2.5h5M12 2.5V6" /></svg>
)
export const EyeIcon = (p: P) => (
  // eye from Lucide (ISC license, lucide.dev)
  <svg {...base(p)}><path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0" /><circle cx="12" cy="12" r="3" /></svg>
)
export const EyeOffIcon = (p: P) => (
  // eye-off from Lucide (ISC license, lucide.dev): a hidden event's mark, never color alone
  <svg {...base(p)}><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c4.97 0 8.5 3.5 9.94 6.65a1 1 0 0 1 0 .7 10.75 10.75 0 0 1-1.44 2.49M14.08 14.16a3 3 0 0 1-4.24-4.24M17.48 17.5A10.75 10.75 0 0 1 2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 4.44-5.15M2 2l20 20" /></svg>
)
// Calendar views, for the phone's view button and sheet at big text (Month is CalendarIcon, Schedule ListIcon).
export const DayViewIcon = (p: P) => (
  <svg {...base(p)}><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M7 8h10M7 12h6M7 16h8" /></svg>
)
export const ThreeDayViewIcon = (p: P) => (
  <svg {...base(p)}><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M9 3v18M15 3v18" /></svg>
)
export const ChevronDown = (p: P) => (
  <svg {...base(p)}><path d="M6 9l6 6 6-6" /></svg>
)
export const SearchIcon = (p: P) => (
  <svg {...base(p)}><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
)
export const PhoneIcon = (p: P) => (
  <svg {...base(p)}><path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384" /></svg>
)
