import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectRecipeKind, parseRecipeHtml } from '../src/recipe-web.ts';

const cases: [unknown, unknown, string, string][] = [
  [null, null, 'Chicken Pot Pie', 'meal'],
  [null, null, "Shepherd’s Pie", 'meal'],
  [null, null, 'Apple Pie', 'dessert'],
  ['Salad', null, 'Caesar Salad', 'meal'],
  [null, null, 'Side Salad', 'side'],
  ['Side Dish', null, 'Caesar Salad', 'side'],
  [null, null, 'Pizza Dough', 'basic'],
  [null, null, 'Pie Crust', 'basic'],
  [null, null, 'Cheesecake', 'dessert'],
  [['Dinner', 'Dessert'], null, 'Cake', 'dessert'],
  ['Breakfast', null, 'Blueberry Muffins', 'meal'],
  ['DINNER, DESSERTS', null, 'Treat', 'dessert'],
  ['Side', 'dessert', 'Cake', 'side'],
  [null, ['Baking', 'Cookies'], 'Treat', 'dessert'],
  ['Baking', null, 'Bread', 'meal'],
  [null, 'spice rub', 'Taco mix', 'basic'],
  ['Entrée', 'dessert', 'Cake', 'meal'],
  [null, null, 'Kartoffelsalat', 'meal'],
];
for (const [category, keywords, name, expected] of cases) test(`recipe kind: ${JSON.stringify(category)} / ${JSON.stringify(keywords)} / ${name} → ${expected}`, () => {
  assert.equal(detectRecipeKind(category, keywords, name), expected);
  const html = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Recipe', recipeCategory: category, keywords, name })}</script>`;
  assert.equal(parseRecipeHtml(html, 'https://food.example/recipe')?.kind, expected);
});

test('recipe kind: Kinwall data wins over page hints and name', () => {
  const html = `<script id="kinwall-recipe" type="application/json">${JSON.stringify({ kinwall: 1, recipe: { name: 'Cheesecake', kind: 'side', ingredients: [] } })}</script><script type="application/ld+json">{"@type":"Recipe","name":"Cake","recipeCategory":"Dessert"}</script>`;
  assert.equal(parseRecipeHtml(html, 'https://food.example/recipe')?.kind, 'side');
});

for (const [expected, hints] of Object.entries({
  dessert: ['dessert', 'desserts', 'cake', 'cupcake', 'cookie', 'cookies', 'brownie', 'brownies', 'pie', 'tart', 'cheesecake', 'pudding', 'ice cream', 'sorbet', 'candy', 'fudge', 'sweet', 'sweets'],
  side: ['side', 'side dish', 'sides', 'side salad', 'vegetable side', 'accompaniment'],
  basic: ['sauce', 'condiment', 'dressing', 'marinade', 'seasoning', 'spice blend', 'spice mix', 'spice rub', 'dough', 'crust', 'stock', 'broth', 'frosting', 'icing', 'syrup', 'jam'],
  meal: ['main', 'main course', 'main dish', 'entree', 'entrée', 'dinner', 'lunch', 'breakfast', 'brunch', 'supper'],
})) test(`recipe kind: ${expected} vocabulary`, () => {
  for (const hint of hints) assert.equal(detectRecipeKind(hint, null, 'Recipe'), expected, hint);
});
