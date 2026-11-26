import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestTags, suggestNewTags } from '../src/recipe-tag-suggestions.ts';

const recipe = (name: string, names: string[] = [], extra = {}) => ({ name, ingredients: names.map(name => ({ name })), ...extra });
test('words ignore accents, simple plurals and ampersands, but match whole words', () => {
  const tags = [{ id: 'a', name: 'Crème & mushroom' }, { id: 'b', name: 'ham' }];
  assert.deepEqual(suggestTags(recipe('Creme and mushrooms, Birmingham style'), tags, []).map(s => s.tagId), ['a']);
});
test('common cooking plurals keep their singular spelling', () => {
  const tags = ['Cookie', 'Brownie', 'Smoothie', 'Pie', 'Veggie', 'Berry'].map(name => ({ id: name, name }));
  assert.deepEqual(suggestTags(recipe('Cookies brownies smoothies pies veggies berries'), tags, []).map(s => s.tagId), tags.slice(0, 5).map(t => t.id));
});
test('facts require known time and ingredients and exclude existing tags', () => {
  const tags = ['Quick', 'Vegetarian', 'Vegan', 'Dessert'].map(name => ({ id: name, name }));
  assert.deepEqual(suggestTags(recipe('Dinner'), tags, []), []);
  assert.deepEqual(suggestTags(recipe('Dinner', ['chicken', 'milk'], { totalMinutes: 30 }), tags, []).map(s => s.tagId), ['Quick']);
  assert.deepEqual(suggestTags(recipe('Dinner', ['lentils', 'egg'], { totalMinutes: 31, tags: [tags[1]] }), tags, []), []);
  assert.deepEqual(suggestTags(recipe('Treat', ['cocoa', 'oats'], { kind: 'dessert' }), tags, []).map(s => s.tagId), ['Vegetarian', 'Vegan', 'Dessert']);
});
test('habits need two other recipes and ignore staples and amounts', () => {
  const tags = [{ id: 'p', name: 'Pasta night' }];
  const library = [recipe('One', ['2 cups tomatoes', 'onions', 'lentils'], { id: '1', tags }), recipe('Two', ['tomato', 'onion', 'lentil'], { id: '2', tags })];
  assert.equal(suggestTags(recipe('New', ['tomato', 'onion', 'lentil', 'salt', 'oil']), tags, library)[0]?.rule, 'habits');
  assert.deepEqual(suggestTags(recipe('New', ['salt', 'oil', 'garlic']), tags, library), []);
  assert.deepEqual(suggestTags(recipe('New', ['tomato', 'onion', 'lentil']), tags, library.slice(0, 1)), []);
});
test('habits compare ingredient names, not three words from one ingredient', () => {
  const tags = [{ id: 'p', name: 'Favorite' }];
  const library = [recipe('One', ['red kidney beans', 'carrot', 'potato', 'leek'], { tags }), recipe('Two', ['red kidney beans'], { tags })];
  assert.deepEqual(suggestTags(recipe('New', ['red kidney beans', 'spinach', 'tofu', 'rice']), tags, library), []);
});
test('description and import hints match; Quick & Easy is a quick tag', () => {
  const tags = ['Italian', 'Summer', 'Quick & Easy'].map(name => ({ id: name, name }));
  assert.deepEqual(suggestTags(recipe('Bowl', [], { description: 'A summer favorite', cuisine: ['Italian'], totalMinutes: 20 }), tags, []).map(s => s.tagId), tags.map(t => t.id));
});
test('words precede facts, then habits; suggestions are bounded and stable', () => {
  const tags = ['Quick', 'Chicken', 'Dinner', 'Roast', 'Sunday', 'Favorite', 'Lunch'].map(name => ({ id: name, name }));
  const r = recipe('Chicken dinner roast Sunday favorite lunch', ['chicken'], { totalMinutes: 20 });
  assert.deepEqual(suggestTags(r, tags, []).map(s => s.tagId), ['Chicken', 'Dinner', 'Roast', 'Sunday', 'Favorite']);
  assert.deepEqual(suggestTags(r, tags, []), suggestTags(r, tags, []));
});
test('ideas count recipes once, exclude tags and staples, and require ten percent in large libraries', () => {
  const library = Array.from({ length: 3 }, (_, i) => recipe(`Chicken ${i}`, ['chicken', 'salt', 'tomatoes']));
  const ideas = suggestNewTags(library, [{ id: 't', name: 'Tomato' }]);
  assert.deepEqual(ideas, [{ name: 'Chicken', count: 3, examples: ['Chicken 0', 'Chicken 1', 'Chicken 2'] }]);
  assert.equal(suggestNewTags([...library, ...Array.from({ length: 27 }, () => recipe('Dinner'))], [])[0]?.count, 3);
  assert.deepEqual(suggestNewTags([...library, ...Array.from({ length: 28 }, () => recipe('Dinner'))], []), []);
});
test('ingredient ideas keep meaningful names together instead of suggesting modifiers', () => {
  const library = Array.from({ length: 3 }, () => recipe('Bowl', ['Greek yogurt', 'olive oil']));
  const ideas = suggestNewTags(library, [{ id: 'b', name: 'Bowl' }]);
  assert.deepEqual(ideas.map(i => i.name), ['Greek yogurt']);
});
test('three shared ingredient names can qualify even when Jaccard is below forty percent', () => {
  const tags = [{ id: 'p', name: 'Pasta night' }];
  const shared = ['lentil', 'tomato', 'onion'];
  const library = [recipe('One', [...shared, 'carrot', 'potato', 'leek', 'cabbage'], { tags }), recipe('Two', ['spinach'], { tags })];
  assert.equal(suggestTags(recipe('New', [...shared, 'rice', 'tofu', 'broccoli', 'lemon']), tags, library)[0]?.tagId, 'p');
});
test('ideas include hints, ignore normalized existing names, and are capped at eight', () => {
  const library = Array.from({ length: 3 }, () => recipe('Bowl', ['200g salt'], { keywords: ['Crème', 'tomatoes', 'chicken', 'lentils', 'rice', 'onions', 'tofu', 'basil', 'broccoli', 'cabbage', 'carrots'] }));
  const ideas = suggestNewTags(library, [{ id: 'c', name: 'Creme' }]);
  assert.equal(ideas.length, 8);
  assert.ok(!ideas.some(i => /creme|salt|200/.test(i.name.toLowerCase())));
});
test('amounts joined to units do not become ingredient ideas', () => {
  const library = Array.from({ length: 3 }, () => recipe('Bowl', ['200g lentils']));
  assert.deepEqual(suggestNewTags(library, [{ id: 'b', name: 'Bowl' }]).map(i => i.name), ['Lentil']);
});
test('word matches precede facts, then habits ordered by best Jaccard score', () => {
  const low = { id: 'low', name: 'Family meals' }, high = { id: 'high', name: 'Family favorite' };
  const quick = { id: 'quick', name: 'Quick' }, lemon = { id: 'lemon', name: 'Lemon' };
  const r = recipe('Lemon bowl', ['lemon', 'lentil', 'onion'], { totalMinutes: 20 });
  const library = [0, 1].flatMap(i => [recipe(`High ${i}`, ['lemon', 'lentil', 'onion'], { tags: [high] }), recipe(`Low ${i}`, ['lemon', 'lentil', 'carrot', 'tomato'], { tags: [low] })]);
  assert.deepEqual(suggestTags(r, [low, quick, lemon, high], library).map(s => s.tagId), ['lemon', 'quick', 'high', 'low']);
});
test('the staple list is configurable and the current recipe does not count as a tagging habit', () => {
  const tag = { id: 'tag', name: 'Family favorite' };
  const library = [recipe('One', ['tomato'], { id: 'one', tags: [tag] }), recipe('Two', ['tomato'], { id: 'two', tags: [tag] })];
  assert.equal(suggestTags(recipe('New', ['tomato']), [tag], library).length, 1);
  assert.deepEqual(suggestTags(recipe('New', ['tomato']), [tag], library, ['tomato']), []);
  assert.deepEqual(suggestTags(recipe('One', ['tomato'], { id: 'one' }), [tag], library), []);
});
