// Sticker packs (defined here, not in the DB - served to clients by GET /api/stickers/packs) and the
// points-ledger sums shared by the members and stickers routes.
import type { KinwallDb } from './db.ts';

export type StickerPack = { id: string; name: string; cover: string; price: number; stickers: string[] };

// price is the base price in points; the household's stickerPriceScale (percent) applies on top.
// A pack with base price 0 is owned by everyone from the start.
export const STICKER_PACKS: StickerPack[] = [
  { id: 'animals', name: 'Animals', cover: '🐾', price: 0, stickers: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔'] },
  { id: 'sweets', name: 'Sweets', cover: '🍩', price: 15, stickers: ['🍩', '🍪', '🧁', '🍰', '🎂', '🍭', '🍬', '🍫', '🍦', '🍨', '🥞', '🍓', '🍒', '🍉'] },
  { id: 'sports', name: 'Sports', cover: '⚽', price: 15, stickers: ['⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🏓', '🏸', '🥅', '🏆', '🥇', '🛹', '⛸️', '🚴'] },
  { id: 'dinosaurs', name: 'Dinosaurs', cover: '🦖', price: 20, stickers: ['🦖', '🦕', '🐊', '🦎', '🐢', '🥚', '🌋', '🌿', '🦴', '🌴', '🪨', '☄️'] },
  { id: 'ocean', name: 'Ocean', cover: '🐙', price: 20, stickers: ['🐙', '🦑', '🐠', '🐟', '🐡', '🦈', '🐬', '🐳', '🦀', '🦞', '🐚', '🪸', '🌊', '🏝️'] },
  { id: 'space', name: 'Space', cover: '🚀', price: 25, stickers: ['🚀', '🌍', '🌙', '⭐', '🌟', '☀️', '🪐', '🌠', '🛸', '👽', '🛰️', '👩‍🚀', '🔭', '🌌'] },
  { id: 'robots', name: 'Robots', cover: '🤖', price: 25, stickers: ['🤖', '👾', '🦾', '🦿', '⚙️', '🔧', '🔩', '🔋', '💡', '🕹️', '💾', '📡', '🧲', '🖥️'] },
  { id: 'unicorns', name: 'Unicorns & Rainbows', cover: '🦄', price: 30, stickers: ['🦄', '🌈', '✨', '💖', '🦋', '🌸', '🌺', '🧚', '👑', '💎', '🎀', '🍄', '🌷', '🪄'] },
];

export function scaledPrice(pack: StickerPack, scalePercent: number): number {
  return Math.max(0, Math.round((pack.price * scalePercent) / 100));
}

// earned = chore points + positive ledger entries; spent = purchases (negative entries). balance = earned - spent.
const POINT_TOTALS_SQL = `SELECT m.id AS member_id,
  (SELECT COALESCE(SUM(points_awarded), 0) FROM chore_completions WHERE member_id = m.id)
    + (SELECT COALESCE(SUM(amount), 0) FROM point_entries WHERE member_id = m.id AND amount > 0) AS earned,
  (SELECT COALESCE(-SUM(amount), 0) FROM point_entries WHERE member_id = m.id AND amount < 0) AS spent
FROM members m`;

// One member's balance as a SQL expression; bind the member id twice.
export const BALANCE_EXPR =
  '((SELECT COALESCE(SUM(points_awarded), 0) FROM chore_completions WHERE member_id = ?) + (SELECT COALESCE(SUM(amount), 0) FROM point_entries WHERE member_id = ?))';

export type PointTotals = { member_id: string; earned: number; spent: number };

export const pointTotalsStmt = (db: KinwallDb, memberId?: string) =>
  memberId ? db.prepare(`${POINT_TOTALS_SQL} WHERE m.id = ?`).bind(memberId) : db.prepare(POINT_TOTALS_SQL);

export async function balanceOf(db: KinwallDb, memberId: string): Promise<number> {
  const row = await pointTotalsStmt(db, memberId).first<PointTotals>();
  return row ? row.earned - row.spent : 0;
}
