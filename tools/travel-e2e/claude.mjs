// Claude's half of the Docker E2E: away days, standalone and from a trip, against a real Kinwall
// production build (no mocks) in its own container with demo-only data. Chores, handoffs, credit,
// approval, undo, return, Board/leaderboard/counts/routine, feature switches and responsive visuals.
import { choose, chromium, assert, api, test, context, go, shot, finish, base, key, output } from './common.mjs';

/** Close a role or viewport context once done, keeping its trace (few browsers pages at once). */
const done = async (c, name) => { await c.ctx.tracing.stop({ path: `${output}/trace-${name}.zip` }).catch(() => {}); await c.ctx.close() }

const browser = await chromium.launch({ headless: true });
const only = process.env.ONLY
const run = (name, fn) => (!only || name.includes(only) ? test(name, fn) : null)
const TZ = 'America/New_York';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const addDay = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const members = await api('GET', '/api/members'), id = Object.fromEntries(members.map(m => [m.name, m.id]));
const chores = await api('GET', '/api/chores'), chore = (title, who) => chores.find(c => c.title === title && c.memberId === id[who]);
const settings = await api('GET', '/api/settings');
const day = (date, auth = key) => api('GET', `/api/chores/day?date=${date}`, undefined, auth);
const dialog = page => page.getByRole('dialog').last();

/** A display key for one person's own device, made only in this throwaway instance. */
async function deviceKey(name, owner) {
  const k = await api('POST', '/api/keys', { name, scope: 'display' });
  await api('PATCH', `/api/keys/${k.id}`, { owner });
  return k.key;
}
/** Preview then save, as the editor does (the token binds the review to what's saved). */
async function saveAway(draft, auth = key) {
  const review = await api('POST', '/api/away/preview', draft, auth);
  return { review, period: await api('POST', '/api/away', { ...draft, token: review.token }, auth, 201) };
}
const person = (memberId, startDate, endDate, leave = true, back = true) => ({ memberId, startDate, endDate, leaveDayAway: leave, returnDayAway: back });

const { ctx, page } = await context(browser);
page.setDefaultTimeout(12000);
let campId;

await run('Trips off: away days are still reachable from Chores and Settings', async () => {
  assert.equal(settings.features.trips, false, 'Trips starts off');
  await go(page, '#/chores');
  await page.getByRole('link', { name: /Away days/ }).first().click();
  await page.locator('.meals-heading h1', { hasText: 'Away days' }).waitFor();
  await go(page, '#/settings?tab=family');
  await page.getByRole('link', { name: /Open away days/ }).waitFor();
});

await run('Standalone away: Maya away today and tomorrow, with Pause, Keep due and a handoff to Leo', async () => {
  await go(page, '#/away');
  await page.getByRole('button', { name: 'Add away days' }).click();
  const d = dialog(page);
  await d.getByLabel('Name', { exact: true }).fill('Band camp');
  await choose(d, 'Add someone who’s away', 'Maya');
  await d.getByLabel('Leaves').fill(today);
  await d.getByLabel('Back', { exact: true }).fill(addDay(today, 1));
  await d.getByText(/^Away .* to .*/).waitFor();
  await shot(page, '01-away-who-when-tablet');
  await d.getByRole('button', { name: 'Next: chores' }).click();
  await d.getByLabel('Feed Biscuit').waitFor();
  // Leo is home, so he's offered; Make bed stays due; the rest pause.
  await choose(d, 'Feed Biscuit', 'Give to Leo while away');
  await choose(d, 'Make bed', 'Keep due (they can do it away)');
  await d.getByText('Leo does it and gets the points. Back to Maya afterward.').waitFor();
  await shot(page, '02-away-chores-tablet');
  await d.getByRole('button', { name: 'Next: review' }).click();
  await d.getByText('Here’s what changes. Nothing is saved until you tap Save.').waitFor();
  const text = await d.innerText();
  assert.match(text, /Paused while away[\s\S]*Homework/);
  assert.match(text, /Handed over, then back[\s\S]*Feed Biscuit · Maya · 2 days · to Leo/);
  assert.match(text, /Kept due[\s\S]*Make bed/);
  assert.match(text, /Medicines and health records keep their usual schedules/);
  await shot(page, '03-away-review-tablet');
  await d.getByRole('button', { name: 'Save away days' }).click();
  await d.waitFor({ state: 'hidden' });
  // The dialog closes only after save; assert the persisted period rather than a transient toast
  // duplicated by the accessible live region.
  const camp = (await api('GET', '/api/away')).find(p => p.label === 'Band camp');
  campId = camp.id;
  assert.equal(camp.people[0].effectiveFrom, today);
  assert.equal(camp.people[0].effectiveTo, addDay(today, 1));
  assert.equal(camp.handoffs[0].toMemberId, id.Leo);
  assert.deepEqual(camp.keepDue, [{ choreId: chore('Make bed', 'Maya').id, memberId: id.Maya }]);
  await shot(page, '04-away-saved-tablet');
});

await run('Due consumers: Maya’s paused chores leave the day, Make bed stays, Feed Biscuit is Leo’s', async () => {
  const list = await day(today);
  const maya = list.filter(c => c.memberId === id.Maya).map(c => c.title).sort();
  assert.deepEqual(maya, ['Make bed'], `Maya today: ${maya}`);
  const fed = list.find(c => c.id === chore('Feed Biscuit', 'Maya').id);
  assert.equal(fed.memberId, id.Leo);
  assert.deepEqual(fed.handoff, { fromMemberId: id.Maya, until: addDay(today, 1) });
  const counts = await api('GET', `/api/chores/counts?from=${today}&to=${addDay(today, 2)}`);
  const mayaToday = counts.find(c => c.date === today && c.memberId === id.Maya);
  assert.equal(mayaToday?.total, 1, `Maya's count today is only the kept chore: ${JSON.stringify(mayaToday)}`);
  const back = counts.find(c => c.date === addDay(today, 2) && c.memberId === id.Maya);
  assert.ok(back && back.total >= 2, 'Her chores come back after the away days');
  // Routine mode on for Maya (all her chores required): paused ones aren't required, the kept one is.
  await api('PUT', `/api/routine-mode/${id.Maya}`, { enabled: true, cutoff: '23:59', start: '00:00', requiredChoreIds: null, requiredOneTimeChoreNames: [], allowedWebsitesOnly: false, allowedWebDomains: [], schoolLinkDomains: [] });
  const routine = await api('GET', `/api/routine-mode/${id.Maya}`);
  assert.ok(Array.isArray(routine.remaining) && Array.isArray(routine.availableChores), `routine shape: ${Object.keys(routine)}`);
  const avail = routine.availableChores.map(c => c.title), left = routine.remaining.map(c => c.title);
  assert.ok(avail.includes('Make bed'), `Kept-due Make bed is in routine: ${avail}`);
  for (const paused of ['Homework', 'Feed Biscuit']) {
    assert.ok(!avail.includes(paused) && !left.includes(paused), `${paused} isn't required while away: available ${avail}, remaining ${left}`);
  }
  assert.equal(routine.total, routine.availableChores.length, `total is the required chores (done ones included): ${routine.total}`);
  assert.ok(routine.remaining.every(c => avail.includes(c.title)), 'remaining is a subset of what’s required');
  const midnight = new Date(`${addDay(today, 1)}T05:00:00Z`); // next local midnight, EST
  assert.ok(new Date(routine.validUntil) <= new Date(midnight.getTime() + 3600000), `decision expires by the next midnight: ${routine.validUntil}`);
  await api('PUT', `/api/routine-mode/${id.Maya}`, { enabled: false, cutoff: '19:30', start: '00:00', requiredChoreIds: null, requiredOneTimeChoreNames: [], allowedWebsitesOnly: false, allowedWebDomains: [], schoolLinkDomains: [] });
});

await run('Chores screen, leaderboard and Board show who is away', async () => {
  await go(page, '#/chores');
  await page.getByText(/Maya is away until .*Their chores wait until they’re back/).waitFor();
  await page.locator('.lb-away').first().waitFor();
  await page.getByText(/From Maya until/).waitFor();
  await shot(page, '05-chores-away-handoff-tablet');
  await go(page, '#/home');
  // The line can sit behind the strip's "+N more" on a busy day: its link is there either way.
  await page.locator('a[aria-label^="Maya away, back"]').first().waitFor({ state: 'attached' });
  await shot(page, '06-board-away-line-tablet');
});

await run('Handoff credit: Leo’s device ticks it, gets the points; Maya’s device can’t; approval and undo work', async () => {
  const leoKey = await deviceKey('Leo test tablet', id.Leo), mayaKey = await deviceKey('Maya test tablet', id.Maya);
  await api('PATCH', `/api/members/${id.Leo}`, { needsApproval: true });
  // Tomorrow: the demo seed already ticked today's Feed Biscuit for Maya, before any away days (earned
  // work stays hers; a later tick is a no-op). Tomorrow is still Band camp, and devices may tick a day ahead.
  const tomorrow = addDay(today, 1);
  const seeded = (await day(today)).find(c => c.id === chore('Feed Biscuit', 'Maya').id);
  assert.equal(seeded.completedBy, id.Maya, 'Today’s seeded tick stays Maya’s under the handoff');
  const fed = chore('Feed Biscuit', 'Maya').id;
  const beforeTick = (await day(tomorrow)).find(c => c.id === fed)
  assert.equal(beforeTick.memberId, id.Leo, `Handed to Leo before anyone ticks it: ${JSON.stringify(beforeTick)}`)
  assert.equal(beforeTick.completed, false, `Nobody has ticked it yet: ${JSON.stringify(beforeTick)}`)
  await api('POST', `/api/chores/${fed}/complete`, { date: tomorrow, memberId: id.Maya }, mayaKey, 403);
  await api('POST', `/api/chores/${fed}/complete`, { date: tomorrow, memberId: id.Leo }, leoKey);
  let item = (await day(tomorrow)).find(c => c.id === fed);
  assert.equal(item.pending, true, 'Leo needs an OK, so it waits');
  // Undo by the recipient, then tick again and approve.
  await api('DELETE', `/api/chores/${fed}/complete?date=${tomorrow}`, undefined, leoKey);
  item = (await day(tomorrow)).find(c => c.id === fed);
  assert.equal(item.pending ?? false, false, 'Leo can take back his own tick');
  await api('POST', `/api/chores/${fed}/complete`, { date: tomorrow, memberId: id.Leo }, leoKey);
  const before = (await api('GET', '/api/members')).find(m => m.id === id.Leo).balance;
  await api('POST', `/api/chores/${fed}/approve`, { date: tomorrow });
  item = (await day(tomorrow)).find(c => c.id === fed);
  assert.equal(item.completed, true);
  assert.equal(item.completedBy, id.Leo, 'The person at home gets the credit');
  const after = (await api('GET', '/api/members')).find(m => m.id === id.Leo).balance;
  assert.ok(after > before, `Leo earned the points (${before} → ${after})`);
  await api('PATCH', `/api/members/${id.Leo}`, { needsApproval: false });

  // Maya's own device: a friendly note, nothing scary.
  const kid = await context(browser, mayaKey, { width: 390, height: 844 });
  await go(kid.page, '#/away');
  await kid.page.getByText(/Enjoy your trip! Your usual chores wait until you’re back, except the ones a grown-up kept due/).waitFor();
  assert.equal(await kid.page.getByRole('button', { name: 'Add away days' }).count(), 0, 'Kids can’t set up away days');
  await shot(kid.page, '07-kid-away-phone');
  await done(kid, 'kid-away');
});

await run('Boundaries: zero away days, leave day off, and the editor saying so', async () => {
  const zero = await api('POST', '/api/away/preview', { label: 'Day trip', tripId: null, people: [person(id.Sam, addDay(today, 5), addDay(today, 5), true, false)], keepDue: [], handoffs: [] });
  assert.equal(zero.paused.length, 0, 'Same day with the back day unticked: no away days');
  const late = await api('POST', '/api/away/preview', { label: 'Evening flight', tripId: null, people: [person(id.Sam, addDay(today, 5), addDay(today, 7), false, true)], keepDue: [], handoffs: [] });
  const samDaily = late.paused.find(l => l.title === 'Fold laundry');
  assert.ok(samDaily && samDaily.dates.length === 2, `Sam's daily chore is paused on the 2 counted days: ${JSON.stringify(samDaily)}`);
  assert.ok(late.paused.every(l => l.dates.every(d => d > addDay(today, 5))), 'Leave day unticked: it isn’t paused');
  await go(page, '#/away');
  await page.getByRole('button', { name: 'Add away days' }).click();
  const d = dialog(page);
  await d.getByLabel('Name', { exact: true }).fill('Day trip');
  await choose(d, 'Add someone who’s away', 'Sam');
  await d.getByLabel('Leaves').fill(addDay(today, 5));
  await d.getByLabel('Back', { exact: true }).fill(addDay(today, 5));
  await d.getByLabel('Away on the day they’re back').uncheck();
  await d.getByText('No away days: both boundary days are unticked.').waitFor();
  await shot(page, '08-away-zero-days-tablet');
  await d.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Discard' }).click().catch(() => {});
});

await run('Overlaps combine: a back-to-back period extends Maya’s return on the Board', async () => {
  await saveAway({ label: 'Weekend at Grandma’s', tripId: null, people: [person(id.Maya, addDay(today, 2), addDay(today, 3))], keepDue: [], handoffs: [] });
  await go(page, '#/home');
  const back = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${addDay(today, 4)}T12:00:00Z`));
  await page.getByText(new RegExp(`Maya away, back ${back}`)).first().waitFor();
  const all = await api('GET', '/api/away');
  assert.equal(all.filter(p => p.people.some(x => x.memberId === id.Maya)).length, 2);
});

await run('Conflicts: a handoff to someone away is refused, and two people can’t share one chore day', async () => {
  // Maya must be away today (Band camp, or her own period when this test runs alone).
  if (!(await api('GET', '/api/away')).some(p => p.people.some(x => x.memberId === id.Maya && x.effectiveFrom <= today && today <= x.effectiveTo)))
    await saveAway({ label: 'Maya day out', tripId: null, people: [person(id.Maya, today, today)], keepDue: [], handoffs: [] });
  const draft = { label: 'Leo sleepover', tripId: null, people: [person(id.Leo, today, today)], keepDue: [], handoffs: [{ choreId: chore('Tidy toys', 'Leo').id, fromMemberId: id.Leo, toMemberId: id.Maya, startDate: today, endDate: today }] };
  const review = await api('POST', '/api/away/preview', draft);
  assert.ok(review.conflicts.some(c => c.kind === 'recipient-away' && c.blocking), JSON.stringify(review.conflicts));
  await api('POST', '/api/away', { ...draft, token: review.token }, key, 409);
  // The editor never offers someone who's away: Maya isn't in Leo's Give to list today.
  await go(page, '#/away');
  await page.getByRole('button', { name: 'Add away days' }).click();
  const d = dialog(page);
  await d.getByLabel('Name', { exact: true }).fill('Leo sleepover');
  await choose(d, 'Add someone who’s away', 'Leo');
  await d.getByLabel('Leaves').fill(today);
  await d.getByLabel('Back', { exact: true }).fill(today);
  await d.getByRole('button', { name: 'Next: chores' }).click();
  await d.getByText('Leo’s chores').waitFor();
  await shot(page, '09a-leo-chores-step-tablet');
  await d.getByRole('button', { name: /Tidy toys: / }).click();
  const pick = page.getByRole('dialog').last();
  await pick.getByRole('button', { name: /^Give to/ }).first().waitFor();
  const options = await pick.locator('.sheet-link').allInnerTexts();
  assert.ok(!options.some(o => o.includes('Maya')), `Maya (away) isn't offered: ${options}`);
  assert.ok(options.some(o => o.includes('Sam')), `Sam (home) is offered: ${options}`);
  await pick.getByRole('button', { name: 'Done', exact: true }).click();
  await shot(page, '09-away-recipients-at-home-tablet');
  await d.getByRole('button', { name: 'Back' }).click();
  await d.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Discard' }).click().catch(() => {});
});

await run('Return early: ending Band camp brings today’s chores back to Maya, keeps elapsed days', async () => {
  // Ending away days needs the period's current revision (a stale one is refused).
  const current = await api('GET', `/api/away/${campId}`);
  await api('DELETE', `/api/away/${campId}?revision=${current.revision}`);
  const list = await day(today);
  const maya = list.filter(c => c.memberId === id.Maya).map(c => c.title).sort();
  assert.ok(maya.includes('Homework') || maya.includes('Feed Biscuit'), `Maya’s chores are due again today: ${maya}`);
  const fed = list.find(c => c.id === chore('Feed Biscuit', 'Maya').id);
  assert.equal(fed.handoff ?? null, null, 'The handoff ended with the away days');
  const next = (await day(addDay(today, 1))).find(c => c.id === fed.id);
  assert.equal(next.handoff ?? null, null, 'Tomorrow is Maya’s again');
  assert.equal(next.completedBy, id.Leo, 'Leo’s finished work and points stay');
});

await run('Trip-linked away days and Trips switched off again', async () => {
  await api('PATCH', '/api/settings', { features: { ...settings.features, trips: true } });
  const trip = await api('POST', '/api/trips', { title: 'Lake weekend', startDate: addDay(today, 20), endDate: addDay(today, 22), memberIds: [id.Alex, id.Leo], status: 'ready' }, key, 201);
  await go(page, '#/home');
  await page.reload(); // API-seeded feature change: read it before opening a trip-linked editor.
  await go(page, `#/away?trip=${trip.id}`);
  const d = dialog(page);
  await d.getByText('Filled in from the trip. Each person can have their own dates.').waitFor({ timeout: 25000 }).catch(async e => { await shot(page, 'fail-trip-linked'); throw e });
  assert.equal(await d.getByLabel('Name', { exact: true }).inputValue(), 'Lake weekend');
  await d.getByRole('button', { name: 'Next: chores' }).click();
  await d.getByRole('button', { name: 'Next: review' }).click();
  await d.getByRole('button', { name: 'Save away days' }).click();
  await d.waitFor({ state: 'hidden' });
  const linked = (await api('GET', '/api/away')).find(p => p.tripId === trip.id);
  assert.ok(linked, 'Saved with the trip');
  await api('PATCH', '/api/settings', { features: { ...settings.features, trips: false } });
  await api('GET', `/api/trips/${trip.id}`, undefined, key, 404);
  const still = (await api('GET', '/api/away')).find(p => p.id === linked.id);
  assert.ok(still && still.people.length === 2, 'Trips off never turns off its away days');
  await go(page, '#/away');
  await page.getByText('Lake weekend').first().waitFor();
});

// Responsive and theme checks of the away screens (the shared shot() also fails on sideways overflow).
const views = [
  ['phone-light', { width: 390, height: 844 }, 'light'], ['phone-dark', { width: 390, height: 844 }, 'dark'],
  ['tablet-dark', { width: 1024, height: 768 }, 'dark'], ['portrait-light', { width: 768, height: 1024 }, 'light'],
  ['wall-light', { width: 1366, height: 1024 }, 'light'], ['wall-dark', { width: 1366, height: 1024 }, 'dark'],
  ['landscape-phone-light', { width: 844, height: 390 }, 'light'],
];
for (const [name, viewport, scheme] of views) {
  await run(`Away screens at ${name}`, async () => {
    const v = await context(browser, key, viewport, scheme);
    await go(v.page, '#/away');
    await v.page.locator('.meals-heading h1', { hasText: 'Away days' }).waitFor();
    await shot(v.page, `10-away-list-${name}`);
    await v.page.getByRole('button', { name: 'Add away days' }).click();
    await shot(v.page, `11-away-editor-${name}`);
    await v.page.getByRole('dialog').last().getByRole('button', { name: 'Cancel' }).click();
    await go(v.page, '#/chores');
    await shot(v.page, `12-chores-${name}`);
    await done(v, name);
  });
}

await run('Landscape phone with the keyboard up: the editor stays usable', async () => {
  const v = await context(browser, key, { width: 844, height: 230 }, 'dark');
  await go(v.page, '#/away');
  await v.page.getByRole('button', { name: 'Add away days' }).click();
  const name = v.page.getByRole('dialog').last().getByLabel('Name', { exact: true });
  await name.focus();
  await name.fill('Keyboard check');
  assert.ok(await name.isVisible(), 'The focused field is on screen');
  const save = v.page.getByRole('dialog').last().getByRole('button', { name: 'Next: chores' });
  assert.ok(await save.isVisible(), 'The step button stays reachable');
  await shot(v.page, '13-away-editor-keyboard-landscape-dark');
  await done(v, 'keyboard');
});

console.log(`Ran against ${base}`);

await finish(browser);
