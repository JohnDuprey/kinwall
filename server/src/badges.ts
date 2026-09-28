// Milestone badges on a member's profile (GET /api/members/{id}/stats): a fixed set, each earned
// from all-time totals Kinwall already keeps, so a badge once earned stays earned (deleting a chore
// that was done keeps its history; see routes/chores.ts).

export type BadgeTotals = {
  chores: number; // approved chore completions, all time
  bestStreak: number; // longest streak, same rule as the leaderboard
  rewards: number; // rewards approved or given
  packsBought: number; // sticker packs bought (not the free one)
  packsOwned: number; // including free ones
  packsTotal: number;
  books: number; // books finished, all time
};

type Badge = { id: string; emoji: string; title: string; earned: (t: BadgeTotals) => boolean };

export const BADGES: Badge[] = [
  { id: 'first-chore', emoji: '🌱', title: 'First chore', earned: (t) => t.chores >= 1 },
  { id: 'chores-10', emoji: '⭐', title: '10 chores', earned: (t) => t.chores >= 10 },
  { id: 'chores-50', emoji: '🏅', title: '50 chores', earned: (t) => t.chores >= 50 },
  { id: 'chores-100', emoji: '💯', title: '100 chores', earned: (t) => t.chores >= 100 },
  { id: 'chores-500', emoji: '🏆', title: '500 chores', earned: (t) => t.chores >= 500 },
  { id: 'streak-7', emoji: '🔥', title: '7-day streak', earned: (t) => t.bestStreak >= 7 },
  { id: 'streak-30', emoji: '🌟', title: '30-day streak', earned: (t) => t.bestStreak >= 30 },
  { id: 'first-reward', emoji: '🎁', title: 'First reward', earned: (t) => t.rewards >= 1 },
  { id: 'first-pack', emoji: '🎨', title: 'First sticker pack', earned: (t) => t.packsBought >= 1 },
  { id: 'all-packs', emoji: '📒', title: 'Every sticker pack', earned: (t) => t.packsOwned >= t.packsTotal },
  { id: 'first-book', emoji: '📖', title: 'First book', earned: (t) => t.books >= 1 },
  { id: 'books-10', emoji: '📚', title: '10 books', earned: (t) => t.books >= 10 },
];

export function earnedBadges(totals: BadgeTotals) {
  return BADGES.map((b) => ({ id: b.id, emoji: b.emoji, title: b.title, earned: b.earned(totals) }));
}
