import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMenuText } from '../src/menu-text.ts';

const brief = (text: string) => parseMenuText(text).map((i) => [i.section, i.name, i.priceCents]);

test('menu text: priced lines are items, an unpriced line over priced ones is a section', () => {
  assert.deepEqual(brief(`Pizza
Large cheese pizza ... 14.99
Pepperoni $16
Sides:
• Garlic knots - 5.50
Fries $3.25`), [
    ['Pizza', 'Large cheese pizza', 1499], ['Pizza', 'Pepperoni', 1600],
    ['Sides', 'Garlic knots', 550], ['Sides', 'Fries', 325],
  ]);
});

test('menu text: a price on its own line belongs to the item above (Live Text columns)', () => {
  assert.deepEqual(brief('Noodles\nPad thai\n$12.95\nDrunken noodles\n13,50'), [['Noodles', 'Pad thai', 1295], ['Noodles', 'Drunken noodles', 1350]]);
});

test('menu text: unpriced lines not over priced ones are items without a price', () => {
  assert.deepEqual(brief('Drinks:\nLemonade\nIced tea\n\n'), [['Drinks', 'Lemonade', null], ['Drinks', 'Iced tea', null]]);
  assert.deepEqual(brief('Kids meal'), [[null, 'Kids meal', null]]);
});

test('menu text: numbers inside a name stay in the name, blank and junk lines are skipped', () => {
  assert.deepEqual(brief('10 piece wings $11\n#2 Combo 9.99\n...\n$4'), [[null, '10 piece wings', 1100], [null, '#2 Combo', 999]]);
  assert.deepEqual(parseMenuText(''), []);
});

test('menu text: long input is capped', () => {
  assert.equal(parseMenuText(Array.from({ length: 900 }, (_, i) => `Item ${i} $1`).join('\n')).length, 500);
});
