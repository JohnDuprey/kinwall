// Every text and page parser finishes ~100k characters of worst-case input quickly. These inputs
// took seconds to minutes before (long runs of spaces or dots, unclosed tags, nested tags), which on
// self-hosted Node froze the whole server for every wall and phone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMenuText } from '../src/menu-text.ts';
import { parseRestaurantHtml, splitMenuHeader } from '../src/restaurant-import.ts';
import { bookQuery, findIsbn, parseEventText } from '../src/share-text.ts';
import { clean, parseRecipeHtml, parseRecipeText, stripTags } from '../src/recipe-web.ts';
import { notesText } from '../src/providers/notes.ts';

const N = 100_000;
const LIMIT_MS = 300; // each case takes a few ms; this leaves room for a slow CI machine
const quick = (name: string, run: () => unknown) => {
  const start = performance.now();
  run();
  const ms = performance.now() - start;
  assert.ok(ms < LIMIT_MS, `${name} took ${Math.round(ms)} ms`);
};
const page = 'https://x.example/';
const ld = (json: string) => `<script type="application/ld+json">${json}</script>`;

test('parsers: 100k characters of adversarial menu, share and event text parse quickly', () => {
  quick('menu spaces', () => parseMenuText(`a${' '.repeat(N)}b`));
  quick('menu dots', () => parseMenuText(`a${'.'.repeat(N)}b`));
  quick('menu spaces and dots', () => parseMenuText(`a${' .'.repeat(N / 2)}x`));
  quick('menu spaces before a price', () => parseMenuText(`Pizza${' '.repeat(N)}$12`));
  quick('menu header', () => splitMenuHeader(`Name:${' '.repeat(N)}x`));
  quick('event tabs after at', () => parseEventText(`at${' \t'.repeat(N / 2)}x`, '2026-10-07'));
  quick('event many ats', () => parseEventText('at '.repeat(N / 3), '2026-10-07'));
  quick('event street words', () => parseEventText(`12 ${'Elm '.repeat(N / 4)}`, '2026-10-07'));
  quick('event weekdays', () => parseEventText('Monday '.repeat(N / 7), '2026-10-07'));
  quick('event commas', () => parseEventText(`x${','.repeat(N)}y`, '2026-10-07'));
  quick('event clock ranges', () => parseEventText('1 - '.repeat(N / 4), '2026-10-07'));
  quick('book by', () => bookQuery('a by '.repeat(N / 5)));
  quick('isbn', () => findIsbn('978 '.repeat(N / 4)));
});

test('parsers: a hostile web page or HTML notes parse quickly', () => {
  quick('unclosed <', () => clean('<'.repeat(N)));
  quick('unclosed <a', () => clean('<a'.repeat(N / 2)));
  quick('nested < >', () => clean('<'.repeat(N / 2) + '>'.repeat(N / 2)));
  quick('unclosed <br', () => clean('<br'.repeat(N / 3)));
  quick('unclosed <script', () => parseRestaurantHtml('<script '.repeat(N / 8), page));
  quick('unclosed JSON-LD scripts', () => parseRestaurantHtml('<script type="application/ld+json">'.repeat(N / 35), page));
  quick('unclosed Kinwall script', () => parseRecipeHtml('<script id=kinwall-recipe '.repeat(N / 27), page));
  quick('unclosed links', () => parseRecipeHtml(ld('{"@type":"Recipe","name":"x"}') + '<link rel=x '.repeat(N / 11), page));
  quick('tags inside JSON-LD strings', () => parseRecipeHtml(ld(`{"@type":"Recipe","name":"${'<'.repeat(N)}","recipeInstructions":"${'<a'.repeat(N / 2)}"}`), page));
  quick('recipe text', () => parseRecipeText(`a${' '.repeat(N)}b`));
  quick('event notes', () => notesText('<a'.repeat(N / 2)));
  quick('event notes scripts', () => notesText(`<b>x</b>${'<script'.repeat(N / 7)}`));
});

test('parsers: the faster versions read the same things', () => {
  assert.deepEqual(parseMenuText('Fries   $5\nPizza - 12\nSoup....3.25\nItem 12345').map((i) => [i.name, i.priceCents]), [['Fries', 500], ['Pizza', 1200], ['Soup', 325], ['Item 12345', null]]);
  assert.equal(stripTags('<scr<script>ipt>alert(1)</scr<b>ipt>'), 'alert(1)');
  assert.equal(stripTags('<<a>b>c'), 'c');
  assert.equal(stripTags('ready in < 5 min'), 'ready in < 5 min');
  assert.equal(stripTags('a > b <i>c</i>'), 'a > b c');
  assert.equal(parseEventText('Party at the Lincoln Park pavilion, 3pm', '2026-10-07').place, 'the Lincoln Park pavilion');
  const r = parseRecipeHtml(`<link rel="canonical" href="https://x.example/r">${ld('{"@type":"Recipe","name":"Tacos <b>al pastor</b>"}')}`, page);
  assert.equal(r?.name, 'Tacos al pastor');
  assert.equal(r?.sourceUrl, 'https://x.example/r');
});
