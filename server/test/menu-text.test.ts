import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMenuText } from '../src/menu-text.ts';
import { splitMenuHeader } from '../src/restaurant-import.ts';

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

test('menu text: several photos, one menu (page lines, repeated and "continued" headings, page notes)', () => {
  const pages = `Pizza
Cheese 12.99
Pepperoni 14.99
Continued on back
--- Page 2 ---
Margherita 15.50
PIZZA (continued)
White pizza 15.99
Sides:
Garlic knots 5.50
--- Page 3 of 3 ---
Pizza, cont'd
Veggie 15.99
Sides cont.
Fries 3.25
See other side`;
  assert.deepEqual(brief(pages), [
    ['Pizza', 'Cheese', 1299], ['Pizza', 'Pepperoni', 1499],
    ['Pizza', 'Margherita', 1550], // a page that starts with items keeps the section it was in
    ['Pizza', 'White pizza', 1599], // the same heading again is the same section, spelled as first seen
    ['Sides', 'Garlic knots', 550],
    ['Pizza', 'Veggie', 1599], ['Sides', 'Fries', 325],
  ]);
});

// --- Photos of a printed tri-fold menu (made-up restaurant and dishes, laid out like a real one) ---
const full = (text: string, name?: string) => parseMenuText(text, { name }).map((i) => [i.section, i.name, i.priceCents, i.description]);
const fixture = (f: string) => readFileSync(new URL(`fixtures/${f}`, import.meta.url), 'utf8');
const ADDONS = 'Add-ons';

test('menu text: descriptions attach to the item above, never become items or sections', () => {
  assert.deepEqual(full(`Specialty Pizza
Garden Party
Onions, green peppers,
mushrooms, olives
Fig & Goat
Fig jam base, roasted garlic,
goat cheese, topped with balsamic glaze
Burgers
The Barn Burner $13.50
Double smash patties, jalapeños,
chipotle mayo
Plain Cheese
Cheese or one topping`), [
    ['Specialty Pizza', 'Garden Party', null, 'Onions, green peppers, mushrooms, olives'],
    ['Specialty Pizza', 'Fig & Goat', null, 'Fig jam base, roasted garlic, goat cheese, topped with balsamic glaze'],
    ['Burgers', 'The Barn Burner', 1350, 'Double smash patties, jalapeños, chipotle mayo'],
    ['Burgers', 'Plain Cheese', null, 'Cheese or one topping'],
  ]);
});

test('menu text: several prices keep the first as the price and all of them in the description', () => {
  assert.deepEqual(full(`Garlic Knots (6) $5.10 | (12) $9.20
Classic Smash $9.35 (Single) | $12.45 (Double)
Pizza 10": $10.40 | 14": $13.50
Veggie | Chicken Caprese $11.45 | $13.50
Classic Smash Two $9.35 Single | $12.45 Double — American cheese, lettuce
Wings 6.25 | 11.50`), [
    [null, 'Garlic Knots', 510, '(6) $5.10 · (12) $9.20'],
    [null, 'Classic Smash', 935, 'Single $9.35 · Double $12.45'],
    [null, 'Pizza', 1040, '10" $10.40 · 14" $13.50'],
    [null, 'Veggie or Chicken Caprese', 1145, 'Veggie $11.45 · Chicken Caprese $13.50'],
    [null, 'Classic Smash Two', 935, 'Single $9.35 · Double $12.45 — American cheese, lettuce'],
    [null, 'Wings', 625, '$6.25 · $11.50'],
  ]);
});

test('menu text: a heading with prices prices its items', () => {
  assert.deepEqual(full('Section: Specialty Pizza 10" $14.55 | 14" $19.70\nGarden Party — Onions, olives\nWhite Pie\nSection: Sides\nFries $3'), [
    ['Specialty Pizza', 'Garden Party', 1455, '10" $14.55 · 14" $19.70 — Onions, olives'],
    ['Specialty Pizza', 'White Pie', 1455, '10" $14.55 · 14" $19.70'],
    ['Sides', 'Fries', 300, null],
  ]);
  // Read off a photo: the heading and its prices on two lines, items with no prices under it.
  assert.deepEqual(full('Specialty Pizza\n$10": $14.55 | 14": $19.70\nGarden Party\nOnions, olives\nWhite Pie\nRicotta, garlic').map((i) => i.slice(0, 3)), [
    ['Specialty Pizza', 'Garden Party', 1455], ['Specialty Pizza', 'White Pie', 1455],
  ]);
});

test('menu text: add-ons and sides to swap go together in an Add-ons group, saying what they go with', () => {
  assert.deepEqual(full(`Burgers
All burgers come with homemade chips
Sub French Fries $1.75 | Sweet Fries $2.00
Add Ons: Bacon $2.00
Fried Egg $1.50
Classic Smash $9.35
American cheese, pickles
Hoagies
Sub French Fries $1.75 | Sweet Fries $2.00
Steak Hoagie $13.50
Shaved steak on a toasted roll
Add mushrooms, peppers or onions +1.00 each`), [
    ['Burgers', 'Classic Smash', 935, 'American cheese, pickles'],
    ['Hoagies', 'Steak Hoagie', 1350, 'Shaved steak on a toasted roll'],
    [ADDONS, 'Sub French Fries', 175, 'For Burgers and Hoagies'],
    [ADDONS, 'Sweet Fries', 200, 'For Burgers and Hoagies'],
    [ADDONS, 'Bacon', 200, 'For Burgers'],
    [ADDONS, 'Fried Egg', 150, 'For Burgers'],
    [ADDONS, 'Add mushrooms, peppers or onions', 100, '+$1.00 each — For Hoagies'],
  ]);
});

test('menu text: coupons, promotions, hours, phone numbers, links and mailing labels are skipped', () => {
  assert.deepEqual(full(`Pastas
Baked Ziti $14.50
20% OFF
Any Order
*Limit 1 coupon per customer. Cannot be combined with
other offers. Must present to redeem.
Family Night Package $30
1 Large Cheese Pizza, 12 Wings & a 2L Soda
Scan To Order Online!
Hours
Tue-Sun: 11:00am-9:00pm
555-0100
cornerslice.example
PRSRT STD
PRST STD
0555-019-+8t SPRINGFIELD, ZZ
US POSTAGE PAID
RESIDENT
1 MAIN ST
SPRINGFIELD ZZ 00000-0000
--- Page 2 ---
Desserts
Brownie $4`), [['Pastas', 'Baked Ziti', 1450, null], ['Desserts', 'Brownie', 400, null]]);
});

test("menu text: the restaurant's own name and tagline over a page aren't items", () => {
  assert.deepEqual(full('Corner Slice\n- PIZZA & GRILL -\nStarters\nPretzel Bites $7.25', 'Corner Slice'), [['Starters', 'Pretzel Bites', 725, null]]);
});

test('menu text: names and prices read as two columns pair up in order', () => {
  assert.deepEqual(full('Sandwiches\nBLT\nTuna Melt\n$10.45\n$12.50\nAdd Protein\nGrilled Chicken ......\nCrispy Tofu.\n, +$4,00\n+$4,00\nSalads\nHarvest $9.10'), [
    ['Sandwiches', 'BLT', 1045, null], ['Sandwiches', 'Tuna Melt', 1250, null], ['Salads', 'Harvest', 910, null],
    [ADDONS, 'Grilled Chicken', 400, 'For Sandwiches'], [ADDONS, 'Crispy Tofu', 400, 'For Sandwiches'],
  ]);
});

test('menu text: a tri-fold menu read straight off three photos', () => {
  const items = parseMenuText(fixture('menu-trifold-ocr.txt'), { name: 'Corner Slice' });
  const pizza = '10" $14.55 · 14" $19.70';
  const swap = 'For Smash Burgers, Chicken Sandwiches and Hoagies & Melts';
  assert.deepEqual(items.map((i) => [i.section, i.name, i.priceCents, i.description]), [
    ['Starters', 'Garlic Knots', 510, '(6) $5.10 · (12) $9.20'],
    ['Starters', 'Crispy Wings', 840, '(6) $8.40 · (12) $15.10 — Flavors: Mild | Hot | Lemon Pepper | Maple BBQ'],
    ['Starters', 'Pretzel Bites', 725, null],
    ['Starters', 'Loaded Tots', 830, null],
    ['Salads', 'Harvest', 910, null],
    ['Salads', 'Antipasto Bowl', 1499, 'Mixed greens, salami, olives, roasted red peppers and fresh mozzarella with balsamic'],
    ['Pizza', 'Plain Cheese', 1040, '10" $10.40 · 14" $13.50 — Cheese or one topping'],
    ['Specialty Pizza', 'Garden Party', 1455, `${pizza} — Onions, green peppers, mushrooms, olives, tomatoes`],
    ['Specialty Pizza', 'Fig & Goat', 1455, `${pizza} — Fig jam base, roasted garlic, goat cheese, arugula, topped with balsamic glaze`],
    ['Specialty Pizza', 'Hot Honey Hog', 1455, `${pizza} — Pepperoni, sausage, bacon, in hot honey sauce`],
    ['Specialty Pizza', 'Pesto Primo', 1455, `${pizza} — Loaded with pesto, fresh ricotta and a drizzle of olive oil`],
    ['Smash Burgers', 'Classic Smash', 935, 'Single $9.35 · Double $12.45 — American cheese, lettuce, tomato, pickles, thick-cut red onion'],
    ['Smash Burgers', 'The Barn Burner', 1350, 'Double smash patties, jalapeños, pepper jack, chipotle mayo'],
    ['Chicken Sandwiches', 'Nashville Crispy', 1350, 'Fried chicken with hot honey, slaw ted pickles on a toasted bun'],
    ['Chicken Sandwiches', 'Chicken Cutlet Parm', 1245, 'Breaded cutlet, marina neese on ciabatta'],
    ['Pastas', 'Baked Ziti', 1450, null],
    ['Hoagies & Melts', 'Steak & Cheese Hoagie', 1350, 'Shaved steak with your choice of American, provolone, or cheddar on a toasted roll'],
    ['Hoagies & Melts', 'Turkey Club', 1295, '100% turkey breast, bacon, l ato, mayo, on sourdough'],
    ['Hoagies & Melts', 'Veggie or Chicken Caprese', 1145, 'Veggie $11.45 · Chicken Caprese $13.50 — Fresh mozzarella, tomato, basil pesto'],
    ['Hoagies & Melts', 'BLT', 1045, null],
    ['Hoagies & Melts', 'Tuna Melt', 1250, null],
    ['Wraps', 'Falafel Pita', 1140, 'Pita, hummus, feta, diced cucumbers'],
    ['Wraps', 'Buffalo Chicken Wrap', 1245, 'Crispy chicken, buffalo sauce, lettuce'],
    ['Kids Menu', 'Chicken Fingers', 625, null],
    ['Kids Menu', 'Mac & Cheese', 625, null],
    ['Kids Menu', 'Grilled Cheese', 625, null],
    ['Dessert', 'Brownie Sundae', 425, null],
    ['Beverages', 'Fountain Soda', 250, null],
    ['Beverages', 'Bottled Water', 200, null],
    [ADDONS, 'Grilled Chicken', 400, 'For Salads'],
    [ADDONS, 'Crispy Tofu', 400, 'For Salads'],
    [ADDONS, 'Additional Toppings', 175, '10" $1.75 · 14" $2.50 — Onion, Pepper, Mushroom, Olive, Spinach, Basil, Bacon, Ham, Sausage, Meatball — For Specialty Pizza'],
    [ADDONS, 'Extra Cheese', 200, '10" $2.00 · 14" $3.00 — For Specialty Pizza'],
    [ADDONS, 'Sub French Fries', 175, swap],
    [ADDONS, 'Sweet Fries', 200, swap],
    [ADDONS, 'Gluten-Free bun', 300, 'For Smash Burgers'],
    [ADDONS, 'Sautéed Mushrooms', 150, 'For Smash Burgers'],
    [ADDONS, 'Bacon', 200, 'For Smash Burgers'],
    [ADDONS, 'Fried Egg', 150, 'For Smash Burgers'],
    [ADDONS, 'Add mushrooms, peppers or onions', 100, '+$1.00 each — For Hoagies & Melts'],
  ]);
});

test("menu text: the phones' model lines (Section: lines, prices and a description after a dash)", () => {
  const { fields, menuText } = splitMenuHeader(fixture('menu-trifold-model.txt'));
  assert.deepEqual(fields, { orderUrl: 'https://order.cornerslice.example/start', name: 'Corner Slice', cuisine: 'Pizza', phone: '555-0100', address: '12 Elm Road, Springfield', website: 'cornerslice.example' });
  const pizza = '10" $14.55 · 14" $19.70';
  assert.deepEqual(full(menuText, fields.name), [
    ['Starters', 'Garlic Knots', 510, '(6) $5.10 · (12) $9.20'],
    ['Starters', 'Crispy Wings', 840, '(6) $8.40 · (12) $15.10 — Flavors: Mild, Hot, Lemon Pepper, Maple BBQ'],
    ['Starters', 'Pretzel Bites', 725, null],
    ['Specialty Pizza', 'Garden Party', 1455, `${pizza} — Onions, green peppers, mushrooms, olives, tomatoes`],
    ['Specialty Pizza', 'Fig & Goat', 1455, `${pizza} — Fig jam base, roasted garlic, goat cheese, arugula`],
    ['Smash Burgers', 'Classic Smash', 935, 'Single $9.35 · Double $12.45 — American cheese, lettuce, tomato'],
    ['Smash Burgers', 'The Barn Burner', 1350, 'Double smash patties, jalapeños, pepper jack'],
    ['Hoagies & Melts', 'Steak & Cheese Hoagie', 1350, 'Shaved steak on a toasted roll'],
    ['Hoagies & Melts', 'Veggie or Chicken Caprese', 1145, 'Veggie $11.45 · Chicken Caprese $13.50 — Fresh mozzarella, tomato, basil pesto'],
    ['Kids Menu', 'Chicken Fingers', 625, null],
    ['Dessert', 'Brownie Sundae', 425, null],
    [ADDONS, 'Additional Toppings', 175, '10" $1.75 · 14" $2.50 — Onion, Pepper, Mushroom, Olive — For Specialty Pizza'],
    [ADDONS, 'Sub French Fries', 175, 'For Smash Burgers and Hoagies & Melts'],
  ]);
});

// --- What a phone's photo text did on a real tri-fold (made-up names, the same patterns) -----------

test('menu text: a price is only ever $12.45, 12.45 or +$5.00, never a token with letters or a mailing code', () => {
  assert.deepEqual(full('Beverages\nFountain Soda $2.50\nJuices\n+8t\n68Et\nIced Tea 8t\n0555-019-+8t'), [
    ['Beverages', 'Fountain Soda', 250, null], ['Beverages', 'Juices', null, null], ['Beverages', 'Iced Tea 8t', null, null],
  ]);
});

test('menu text: an item name over two lines is one item, its price on the second line', () => {
  assert.deepEqual(full('Desserts\nGiant Oatmeal\nRaisin Cookie $2.25\nBeverages\nFountain\nSoda Products $2.85\nWater $2.85\nJuices $2.85'), [
    ['Desserts', 'Giant Oatmeal Raisin Cookie', 225, null],
    ['Beverages', 'Fountain Soda Products', 285, null], ['Beverages', 'Water', 285, null], ['Beverages', 'Juices', 285, null],
  ]);
  // The price read on a line of its own under the name's second line.
  assert.deepEqual(full('Desserts\nGiant Oatmeal\nRaisin Cookie\n$2.25').map((i) => i.slice(0, 3)), [['Desserts', 'Giant Oatmeal Raisin Cookie', 225]]);
  // A name ending in dot leaders had its price on its row: not the start of the next name.
  assert.deepEqual(full('Kids Menu\nChicken Fingers .\nMac & Cheese\n$6.25').map((i) => i.slice(0, 3)), [['Kids Menu', 'Chicken Fingers', null], ['Kids Menu', 'Mac & Cheese', 625]]);
  // A heading over a priced item stays a heading.
  assert.deepEqual(full('Noodles\nPad thai 12.50\nLo mein 11.50').map((i) => i.slice(0, 3)), [['Noodles', 'Pad thai', 1250], ['Noodles', 'Lo mein', 1150]]);
});

test('menu text: short lines without prices in a section of them are items, not headings', () => {
  assert.deepEqual(full('Beverages\nFountain Soda\nIced Tea\nWater\nJuices $2.85').map((i) => i.slice(0, 3)), [
    ['Beverages', 'Fountain Soda', null], ['Beverages', 'Iced Tea', null], ['Beverages', 'Water', null], ['Beverages', 'Juices', 285],
  ]);
});

test('menu text: an "Add Protein" box over +$ prices is add-ons for the section above', () => {
  // Each with its price on its own line, or as a phone read it: names, then a price, then one more.
  assert.deepEqual(full('Salads\nHarvest $9.10\nAdd Protein\nGrilled Chicken +$4.00\nCrispy Tofu +$4.00\nPizza\nPlain Cheese $10.40'), full('Salads\nHarvest $9.10\nAdd Protein\nGrilled Chicken\nCrispy Tofu . + $4,00\n+$4,00\nPizza\nPlain Cheese $10.40'));
  // Not "Add mushrooms or onions" over the next sandwich.
  assert.deepEqual(full('Hoagies\nSteak Hoagie $13.50\nAdd mushrooms or onions\nTurkey Club $12.95\nRoast turkey, bacon').map((i) => i.slice(0, 3)), [['Hoagies', 'Steak Hoagie', 1350], ['Hoagies', 'Turkey Club', 1295], [ADDONS, 'Add mushrooms or onions', null]]);
  assert.deepEqual(full('Salads\nHarvest $9.10\nAdd Protein\nGrilled Chicken\nCrispy Tofu . + $4,00\n+$4,00\nPizza\nPlain Cheese $10.40'), [
    ['Salads', 'Harvest', 910, null], ['Pizza', 'Plain Cheese', 1040, null],
    [ADDONS, 'Grilled Chicken', 400, 'For Salads'], [ADDONS, 'Crispy Tofu', 400, 'For Salads'],
  ]);
});

test('menu text: leader dots and stray marks are trimmed off names, and a misread heading is spelled right', () => {
  assert.deepEqual(full('Wraps\nFalafel Pita. • $11.40\nVeggie Wrap... $10.00\nPasias\nBaked Ziti $14.50\nDeserts\nBrownie $4'), [
    ['Wraps', 'Falafel Pita', 1140, null], ['Wraps', 'Veggie Wrap', 1000, null], ['Pastas', 'Baked Ziti', 1450, null], ['Desserts', 'Brownie', 400, null],
  ]);
});
