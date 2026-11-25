// Real production API/browser integration for home care, destination days and advisory checks.
import { choose, chromium, assert, api, test, context, go, shot, finish, closeContext, base, key, output } from './common.mjs';
import { writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true });
const SECRET = 'FAKE-PRIVATE-CARE-INSTRUCTIONS-4412';
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const day = zone => new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date());
try {
  const members = await api('GET', '/api/members');
  const id = Object.fromEntries(members.map(m => [m.name, m.id]));
  const settings = await api('GET', '/api/settings');
  await api('PATCH', '/api/settings', { features: { ...settings.features, trips: true } });
  const today = day(settings.timezone || 'America/New_York');
  const from = addDays(today, -1), to = addDays(today, 3);
  let trip = await api('POST', '/api/trips', { title: 'Home care and travel checks', status: 'planning', startDate: from, endDate: to, memberIds: [id.Alex, id.Sam, id.Maya, id.Leo] });
  const path = part => `#/trips?trip=${trip.id}${part ? `&part=${part}` : ''}`;
  const fresh = async () => trip = await api('GET', `/api/trips/${trip.id}`);
  const { page, ctx: mainContext } = await context(browser);
  const roleKeys = {};
  async function open(part = '') {
    await go(page, path(part));
    // Several scenarios seed/change data outside this tab; reload to fetch its current revision.
    await page.reload();
  }
  const dialog = () => page.getByRole('dialog').last();
  async function save() {
    const sheet = dialog();
    await sheet.getByRole('button', { name: 'Save', exact: true }).click();
    await sheet.waitFor({ state: 'hidden' });
  }

  await test('Manual pet care creates a private helper arrangement through the real UI', async () => {
    const choresBefore = (await api('GET', '/api/chores')).length;
    await open('care');
    await page.getByRole('button', { name: 'Add care', exact: true }).click();
    await choose(dialog(), 'For', 'Pets');
    await dialog().getByLabel('What', { exact: true }).fill('Feed Biscuit');
    await dialog().getByLabel('Helper (optional)', { exact: true }).fill('Sam');
    await dialog().getByLabel('How to reach them (optional)', { exact: true }).fill('sam@example.test');
    await dialog().getByLabel('First day', { exact: true }).fill(from);
    await dialog().getByLabel('Last day', { exact: true }).fill(to);
    await choose(dialog(), 'Status', '✓ Confirmed');
    await dialog().getByRole('button', { name: 'Add to checklist', exact: true }).click();
    await dialog().getByLabel('Checklist item 1', { exact: true }).fill('Fresh water each morning');
    await dialog().getByLabel('Instructions', { exact: true }).fill(SECRET);
    await dialog().getByLabel('Getting in', { exact: true }).fill('FAKE-ENTRY-DO-NOT-USE');
    await dialog().getByLabel('If something goes wrong', { exact: true }).fill('Demo vet contact');
    await shot(page, '01-care-editor-tablet');
    await save();
    await page.getByText(SECRET, { exact: true }).waitFor();
    await fresh();
    assert.equal(trip.care.length, 1);
    assert.equal(trip.care[0].helperContact, 'sam@example.test');
    assert.equal(trip.care[0].status, 'confirmed');
    assert.equal(trip.care[0].fromDate, from);
    assert.equal(trip.care[0].instructions, SECRET);
    assert.equal((await api('GET', '/api/chores')).length, choresBefore, 'manual care does not create or reassign real chores');
    await shot(page, '02-care-saved');
  });

  await test('Care checklist and edits persist with revision protection', async () => {
    const stale = trip.revision;
    await Promise.all([
      page.waitForResponse(r => r.request().method() === 'PATCH' && r.url().includes('/care/')),
      page.getByRole('checkbox', { name: 'Fresh water each morning', exact: true }).click(),
    ]);
    await page.waitForFunction(() => document.querySelector('.trip-care-tasks input[type="checkbox"]')?.checked === true);
    await fresh();
    assert.equal(trip.care[0].tasks[0].done, true);
    await api('PATCH', `/api/trips/${trip.id}/care/${trip.care[0].id}`, { revision: stale, instructions: 'old edit' }, undefined, 409);
    await page.getByRole('button', { name: 'Edit Feed Biscuit', exact: true }).click();
    await choose(dialog(), 'Status', 'Asked, waiting to hear');
    await save(); await fresh();
    assert.equal(trip.care[0].status, 'asked');
    assert.equal(trip.care[0].tasks[0].done, true);
  });

  await test('Private care is absent on kids and walls in every booking visibility mode; everyday adults read only', async () => {
    const keys = {};
    for (const [label, kind, owner] of [['kid', 'kid', id.Maya], ['wall', 'wall', 'shared'], ['adult', 'grownup', id.Sam]]) {
      const key = await api('POST', '/api/keys', { name: `Demo next ${label}`, scope: 'display' });
      await api('PATCH', `/api/keys/${key.id}`, { kind, owner }); keys[label] = key.key; roleKeys[label] = key.key;
    }
    for (const fields of [{ detailsAudience: 'grownups', detailsOnWall: false }, { detailsAudience: 'everyone', detailsOnWall: false }, { detailsAudience: 'everyone', detailsOnWall: true }]) {
      await fresh(); trip = await api('PATCH', `/api/trips/${trip.id}`, { revision: trip.revision, ...fields });
      for (const label of ['kid', 'wall']) {
        const projected = await api('GET', `/api/trips/${trip.id}`, undefined, keys[label]);
        assert.deepEqual(projected.care, []); assert.equal(projected.canSeeCare, false);
        assert.ok(!JSON.stringify(projected).includes(SECRET));
      }
    }
    for (const label of ['kid', 'wall', 'adult']) {
      const view = await context(browser, keys[label]);
      await go(view.page, path('care'));
      if (label === 'adult') {
        await view.page.getByText(SECRET, { exact: true }).waitFor();
        assert.equal(await view.page.getByRole('button', { name: 'Add care', exact: true }).count(), 0);
        assert.equal(await view.page.getByRole('button', { name: 'Edit Feed Biscuit', exact: true }).count(), 0);
        assert.equal(await view.page.getByRole('checkbox', { name: 'Fresh water each morning' }).isDisabled(), true);
      } else {
        await view.page.getByText('Home and pet care is only on grown-ups’ own devices.', { exact: true }).waitFor();
        assert.ok(!(await view.page.locator('body').innerText()).includes(SECRET));
      }
      await shot(view.page, `03-care-${label}`);
      await closeContext(view.ctx, `care-${label}`);
    }
    await page.bringToFront();
  });

  await test('An old grown-up save response cannot restore private care after a cross-tab switch to a child', async () => {
    await open('care');
    await page.getByRole('button', { name: 'Edit Feed Biscuit', exact: true }).click();
    await choose(dialog(), 'Status', '✓ Confirmed');
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let captured;
    const intercepted = new Promise(resolve => { captured = resolve; });
    const pattern = `**/api/trips/${trip.id}/care/*`;
    await page.route(pattern, async route => {
      if (route.request().method() !== 'PATCH') return route.continue();
      const response = await route.fetch();
      assert.ok((await response.text()).includes(SECRET), 'the delayed response is genuinely a privileged save result');
      captured(); await gate; await route.fulfill({ response });
    });
    const other = await mainContext.newPage();
    try {
      await dialog().getByRole('button', { name: 'Save', exact: true }).click();
      await intercepted;
      await other.goto(base);
      await other.evaluate(k => localStorage.setItem('kinwall.apiKey', k), roleKeys.kid);
      await page.bringToFront();
      await page.getByText('Home and pet care is only on grown-ups’ own devices.', { exact: true }).waitFor();
      const delivered = page.waitForResponse(r => r.request().method() === 'PATCH' && r.url().includes('/care/'));
      release(); await delivered;
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const text = await page.locator('body').innerText();
      assert.ok(!text.includes(SECRET)); assert.ok(!text.includes('Feed Biscuit'));
      assert.equal(await page.getByRole('button', { name: 'Add care', exact: true }).count(), 0);
      await shot(page, '03b-cross-tab-save-privacy');
    } finally {
      release(); await page.unroute(pattern);
      await other.evaluate(k => localStorage.setItem('kinwall.apiKey', k), key);
      await other.close(); await page.bringToFront();
      await open('care'); await page.getByText(SECRET, { exact: true }).waitFor(); await fresh();
    }
  });

  await test('Unreadable-care notice preserves readable arrangements (injected projection)', async () => {
    const pattern = `**/api/trips/${trip.id}`;
    await page.route(pattern, async route => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), careUnavailable: true } });
    });
    try {
      await page.setViewportSize({ width: 390, height: 844 }); await open('care');
      await page.getByRole('alert').filter({ hasText: 'Some home or pet care could not be opened.' }).waitFor();
      await page.getByText(SECRET, { exact: true }).waitFor();
      assert.equal(await page.getByText('Nothing set up yet.', { exact: true }).count(), 0);
      await shot(page, '03c-unreadable-care-notice');
    } finally {
      await page.unroute(pattern); await page.setViewportSize({ width: 1024, height: 768 });
      await open('care'); await page.getByText(SECRET, { exact: true }).waitFor();
      await fresh(); assert.equal(trip.careUnavailable, false);
    }
  });

  await test('Care stays out of ordinary backup and browser offline stores', async () => {
    await open('care'); await page.getByText(SECRET, { exact: true }).waitFor();
    const ordinary = await api('GET', '/api/export');
    assert.ok(!JSON.stringify(ordinary).includes(SECRET));
    const stores = await page.evaluate(async () => {
      const cachesRead = await Promise.all((await caches.keys()).map(async name => ({ name, urls: (await (await caches.open(name)).keys()).map(r => r.url) })));
      const req = indexedDB.open('kinwall-offline');
      const db = await new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
      const values = await Promise.all([...db.objectStoreNames].map(async name => {
        const r = db.transaction(name).objectStore(name).getAll();
        return { name, values: await new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }) };
      })); db.close(); return { cachesRead, values };
    });
    assert.ok(!JSON.stringify(stores).includes(SECRET));
    assert.ok(!JSON.stringify(stores.cachesRead).includes('/api/trips'));
    await writeFile(`${output}/care-browser-storage.json`, JSON.stringify(stores, null, 2));
  });

  await test('Destination-local Today and Tonight follow the chosen travel clock without moving home care dates', async () => {
    const zone = ['Pacific/Kiritimati', 'Pacific/Pago_Pago'].find(z => day(z) !== today);
    assert.ok(zone); const localDay = day(zone);
    await open();
    await page.locator('.trip-clock').getByRole('button', { name: 'Change', exact: true }).click();
    await dialog().getByRole('button', { name: /^Follow the time in:/ }).click();
    await dialog().getByRole('searchbox').fill(zone);
    await dialog().locator('.sheet-links .sheet-link').first().click();
    await dialog().getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await fresh(); assert.equal(trip.viewTimeZone, zone); assert.equal(trip.travelDay.today, localDay);
    assert.equal(trip.care[0].fromDate, from); assert.equal(trip.care[0].toDate, to);
    trip = await api('POST', `/api/trips/${trip.id}/items`, { revision: trip.revision, kind: 'activity', title: 'Destination day activity', date: localDay, time: '23:59', tz: zone });
    trip = await api('POST', `/api/trips/${trip.id}/stay-groups`, { revision: trip.revision, label: 'Destination night', checkIn: localDay, checkOut: addDays(localDay, 1) });
    const group = trip.stayGroups.find(g => g.label === 'Destination night');
    trip = await api('POST', `/api/trips/${trip.id}/stays`, { revision: trip.revision, groupId: group.id, name: 'Family home demo', kind: 'family', booking: 'confirmed_family' });
    const option = trip.stayGroups.find(g => g.id === group.id).options[0];
    trip = await api('POST', `/api/trips/${trip.id}/stay-groups/${group.id}/choose`, { revision: trip.revision, optionId: option.id });
    await page.reload();
    const now = page.locator('.trip-today');
    await now.getByText('Destination day activity', { exact: true }).waitFor();
    await now.getByText('Family home demo', { exact: true }).waitFor();
    await shot(page, '04-destination-today-tonight');
  });

  await test('Plan warnings expose gaps, overlaps and outside dates with useful links and never block edits', async () => {
    await fresh();
    trip = await api('POST', `/api/trips/${trip.id}/stay-groups`, { revision: trip.revision, label: 'Overlapping nights', checkIn: trip.stayGroups[0].checkIn, checkOut: trip.stayGroups[0].checkOut });
    const group = trip.stayGroups.find(g => g.label === 'Overlapping nights');
    trip = await api('POST', `/api/trips/${trip.id}/stays`, { revision: trip.revision, groupId: group.id, name: 'Demo campground', kind: 'camping' });
    const place = trip.stayGroups.find(g => g.id === group.id).options[0];
    trip = await api('POST', `/api/trips/${trip.id}/stay-groups/${group.id}/choose`, { revision: trip.revision, optionId: place.id });
    trip = await api('POST', `/api/trips/${trip.id}/items`, { revision: trip.revision, kind: 'activity', title: 'Outside dates demo', date: addDays(to, 5) });
    for (const code of ['uncovered_nights', 'overlapping_stays', 'outside_trip']) assert.ok(trip.checks.some(c => c.code === code), code);
    await open();
    await page.getByRole('heading', { name: /^Worth a look/ }).waitFor();
    const checks = page.locator('.trip-checks');
    await checks.getByText(/Places to stay overlap:/).waitFor();
    await checks.getByText(/Outside the trip’s dates:/).waitFor();
    await checks.getByRole('link').first().click();
    assert.ok(page.url().includes('part=stays') || page.url().includes('part=plan'));
    await fresh(); const before = trip.checks;
    trip = await api('PATCH', `/api/trips/${trip.id}`, { revision: trip.revision, description: 'Reviewed advisory checks; no scheduling changes.' });
    assert.deepEqual(trip.checks, before);
    await open(); await page.locator('.trip-checks').scrollIntoViewIfNeeded(); await shot(page, '05-advisory-checks');
  });

  await test('Care and advisory screens fit phone, tablet, wall, landscape and shortened keyboard layouts', async () => {
    for (const [name, width, height] of [['phone', 390, 844], ['tablet', 1024, 768], ['portrait', 768, 1024], ['wall', 1366, 1024], ['landscape', 844, 390]]) {
      await page.setViewportSize({ width, height });
      for (const theme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: theme });
        await open('care'); await page.getByText(SECRET, { exact: true }).waitFor();
        await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
        await shot(page, `visual-${name}-${theme}-care`);
        await open(); await page.getByRole('heading', { name: /^Worth a look/ }).waitFor();
        await page.locator('.trip-checks').scrollIntoViewIfNeeded(); await shot(page, `visual-${name}-${theme}-checks`);
      }
    }
    await page.setViewportSize({ width: 844, height: 170 }); await open('care');
    await page.getByRole('button', { name: 'Edit Feed Biscuit', exact: true }).click();
    await dialog().getByLabel('Instructions', { exact: true }).focus(); await shot(page, 'visual-keyboard-short-care');
    await dialog().getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.setViewportSize({ width: 1024, height: 768 });
  });

  await test('Deleting care confirms and removes only that record', async () => {
    await open('care');
    await page.getByRole('button', { name: 'Edit Feed Biscuit', exact: true }).click();
    await dialog().getByRole('button', { name: 'Delete…', exact: true }).click();
    const confirm = page.getByRole('alertdialog');
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByText('Nothing set up yet.', { exact: false }).first().waitFor(); await fresh();
    assert.deepEqual(trip.care, []); assert.ok(trip.stayGroups.length); assert.ok(trip.items.length);
  });

  await test('Trip list and Board refresh destination-day summaries without a data revision change (injected clock)', async () => {
    await fresh();
    const initialDay = trip.travelDay.today;
    const nextDay = addDays(initialDay, 1);
    const expected = `Day ${Math.round((Date.parse(nextDay) - Date.parse(trip.startDate)) / 86400000) + 1} of ${Math.round((Date.parse(trip.endDate) - Date.parse(trip.startDate)) / 86400000) + 1}`;
    let shifted = false;
    const pattern = '**/api/trips?archived=1';
    const boardPattern = '**/api/trips';
    await page.clock.install({ time: new Date() });
    const respond = async route => {
      const response = await route.fetch();
      const summaries = await response.json();
      await route.fulfill({ response, json: summaries.map(t => t.id === trip.id && shifted ? { ...t, travelDay: { ...t.travelDay, today: nextDay } } : t) });
    };
    await page.route(pattern, respond); await page.route(boardPattern, respond);
    try {
      await go(page, '#/trips'); await page.reload();
      await page.locator('.trip-row').filter({ hasText: trip.title }).waitFor();
      await page.waitForLoadState('networkidle');
      // Let initial /api/rev settle, then change only the derived server clock projection.
      await page.clock.fastForward(31_000);
      await page.waitForLoadState('networkidle');
      shifted = true; await page.clock.fastForward(61_000);
      await page.waitForFunction(({ title, expected }) => [...document.querySelectorAll('.trip-row')].some(row => row.textContent.includes(title) && row.textContent.includes(expected)), { title: trip.title, expected }, { timeout: 5000 });
      await shot(page, '06-live-destination-day-list');
      shifted = false;
      await go(page, '#/home'); await page.reload();
      await page.locator(`a[href="#/trips?trip=${trip.id}"]`).first().waitFor({ state: 'attached' });
      await page.waitForLoadState('networkidle');
      await page.clock.fastForward(31_000);
      await page.waitForLoadState('networkidle');
      shifted = true; await page.clock.fastForward(61_000);
      await page.waitForFunction(({ id, expected }) => [...document.querySelectorAll(`a[href="#/trips?trip=${id}"]`)].some(row => (row.getAttribute('aria-label') || row.textContent).includes(expected)), { id: trip.id, expected }, { timeout: 5000 });
      await shot(page, '07-live-destination-day-board');
    } finally { await page.unroute(pattern); await page.unroute(boardPattern); }
  });
} finally { await finish(browser); }
