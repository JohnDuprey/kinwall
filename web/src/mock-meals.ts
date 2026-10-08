// In-memory meal fixtures for VITE_MOCK only; production always uses the meal API.
import { mock } from './mock.ts'
import { dateKey } from './date.ts'
import { ingredientAmount, mealWeek, MEAL_SLOTS } from './meal-date.ts'
import { matchBasic } from './recipe-search.ts'
import { KIT_QUALIFIER, type BasicChoices, type Meal, type MealInput, type MenuItem, type OrderItem, type Recipe, type RecipeInput, type Restaurant, type RestaurantInput, type ShoppingProjection } from './meal-types.ts'

// Keep the same Sunday–Saturday menu on the current local week, including across DST changes.
const dates = mealWeek(dateKey(new Date()), 0)
const stamp = `${dates[0]}T12:00:00.000Z`
// The server's rule (server/src/meals.ts isScalable), which the API sends as ingredient.scalable.
const isScalable = (i: { quantity: number | null; unit: string | null; qualifier: string | null }) =>
  i.quantity !== null && !i.qualifier && !/^(packages?|packs?|cans?|jars?|bunch(es)?|pinch(es)?|handfuls?)$/i.test(i.unit?.trim() ?? '')
type SeedIngredient = [name: string, quantity: number | null, unit: string | null, category: string, preparation?: string, qualifier?: string]
const seedRecipe = (id: string, name: string, description: string, instructions: string, preparationNotes: string, ingredients: SeedIngredient[]): Recipe => ({
  id: `demo-${id}`, name, description, defaultServings: 4, instructions, preparationNotes, sourceUrl: null, archived: false,
  ingredients: ingredients.map(([name, quantity, unit, category, preparation, qualifier], sort) => ({
    id: `demo-${id}-${sort}`, name, normalizedName: name.toLowerCase(), quantity, unit, category, preparation: preparation ?? null, qualifier: qualifier ?? null, sort, scalable: isScalable({ quantity, unit, qualifier: qualifier ?? null }),
  })), createdAt: stamp, updatedAt: stamp,
})
let recipes: Recipe[] = [
  seedRecipe('tacos', 'Tuesday Tacos', 'Beef tacos with fresh toppings and warm corn tortillas.',
    'Brown the beef and diced onion in a skillet. Stir in taco seasoning and water; simmer until the filling thickens. Warm the tortillas and serve with tomatoes, lettuce, cheese, salsa, cilantro, and lime wedges.',
    'Set out toppings separately so everyone can build their own tacos.', [
      ['Ground beef', 1, 'lb', 'Meat'], ['Yellow onion', 1, null, 'Produce', 'Diced'], ['Taco seasoning', 2, 'tbsp', 'Pantry'], ['Water', 0.5, 'cup', 'Pantry'],
      ['Corn tortillas', 12, null, 'Bakery'], ['Tomatoes', 2, null, 'Produce', 'Diced'], ['Lettuce', 0.5, 'head', 'Produce', 'Shredded'],
      ['Cheddar cheese', 1, 'cup', 'Dairy', 'Grated'], ['Salsa', 0.5, 'cup', 'Pantry'], ['Cilantro', 1, 'bunch', 'Produce', 'Chopped', 'Small bunch'], ['Limes', 2, null, 'Produce', 'Cut into wedges'],
    ]),
  seedRecipe('pancakes', 'Blueberry pancakes', 'Fluffy pancakes with berries and maple syrup.',
    'Whisk flour, baking powder, and salt. Beat eggs with milk and melted butter, then stir into the dry ingredients. Fold in blueberries. Cook small ladles of batter on a nonstick griddle, flipping when bubbles form. Serve with maple syrup.',
    'Freeze extra pancakes with parchment between them.', [
      ['Flour', 2, 'cup', 'Pantry'], ['Baking powder', 2, 'tsp', 'Pantry'], ['Salt', 0.5, 'tsp', 'Pantry'], ['Eggs', 2, null, 'Dairy'],
      ['Milk', 1.5, 'cup', 'Dairy'], ['Butter', 3, 'tbsp', 'Dairy', 'Melted'], ['Blueberries', 1, 'cup', 'Produce'], ['Maple syrup', 0.25, 'cup', 'Pantry'],
    ]),
  seedRecipe('oats', 'Apple cinnamon oatmeal', 'Warm oats with apples, cinnamon, and yogurt.',
    'Simmer oats, milk, diced apples, and cinnamon for 8–10 minutes, stirring often. Divide into bowls and top with yogurt and maple syrup.',
    'Dice the apples the night before and refrigerate.', [
      ['Rolled oats', 2, 'cup', 'Pantry'], ['Milk', 4, 'cup', 'Dairy'], ['Apples', 2, null, 'Produce', 'Diced'],
      ['Cinnamon', 1, 'tsp', 'Pantry'], ['Greek yogurt', 1, 'cup', 'Dairy'], ['Maple syrup', 2, 'tbsp', 'Pantry'],
    ]),
  seedRecipe('parfaits', 'Berry yogurt parfaits', 'Layered yogurt, berries, and crunchy granola.',
    'Divide half the yogurt among four bowls. Layer with berries and granola, then repeat. Drizzle with honey just before serving.',
    'Keep the granola separate until serving so it stays crunchy.', [
      ['Greek yogurt', 3, 'cup', 'Dairy'], ['Blueberries', 1, 'cup', 'Produce'], ['Strawberries', 1, 'cup', 'Produce', 'Sliced'],
      ['Granola', 1, 'cup', 'Pantry'], ['Honey', 2, 'tbsp', 'Pantry'],
    ]),
  seedRecipe('wraps', 'Chickpea salad wraps', 'Lemon chickpea wraps with crisp vegetables.',
    'Mash chickpeas lightly with yogurt, lemon juice, and salt. Fold in diced cucumber and tomatoes. Divide among tortillas, add lettuce, and roll tightly.',
    'Pack the filling separately if making lunches ahead.', [
      ['Chickpeas', 2, 'can', 'Pantry', 'Drained and rinsed', '15 oz cans'], ['Greek yogurt', 0.5, 'cup', 'Dairy'], ['Lemons', 1, null, 'Produce', 'Juiced'],
      ['Salt', 0.25, 'tsp', 'Pantry'], ['Cucumber', 1, null, 'Produce', 'Diced'], ['Tomatoes', 2, null, 'Produce', 'Diced'], ['Lettuce', 0.5, 'head', 'Produce', 'Shredded'], ['Flour tortillas', 4, null, 'Bakery'],
    ]),
  // Structured steps, like an imported recipe's, so Start cooking has timers and per-step ingredients.
  { ...seedRecipe('chicken', 'Lemon chicken with rice and broccoli', 'A complete chicken dinner with rice and roasted vegetables.',
    'Toss chicken and broccoli with olive oil, lemon juice, minced garlic, salt, and pepper. Roast at 425°F until the chicken reaches 165°F, about 25 minutes. Meanwhile simmer rice in broth until tender. Serve together with the pan juices.',
    'Cut broccoli into evenly sized florets.', [
      ['Chicken breast', 1.5, 'lb', 'Meat'], ['Broccoli', 1, 'lb', 'Produce', 'Cut into florets'], ['Olive oil', 2, 'tbsp', 'Pantry'], ['Lemons', 2, null, 'Produce', 'Juiced'],
      ['Garlic', 4, 'clove', 'Produce', 'Minced'], ['Salt', 0.5, 'tsp', 'Pantry'], ['Black pepper', 0.25, 'tsp', 'Pantry'], ['Rice', 1.5, 'cup', 'Pantry'], ['Chicken broth', 3, 'cup', 'Pantry'],
    ]), steps: [
    { text: 'Heat the oven to 425°F and cut the broccoli into evenly sized florets.', bullets: [], title: 'Prep' },
    { text: 'Toss the chicken breast and broccoli with olive oil, lemon juice, garlic, salt and black pepper.', bullets: ['Spread everything on a sheet pan in one layer.'], imageUrl: 'https://picsum.photos/800/600' },
    { text: 'Roast for 25 minutes, until the chicken reaches 165°F.', bullets: ['Turn the broccoli halfway through.'], title: 'Roast', imageUrl: 'https://picsum.photos/800/600', timers: [{ name: 'Chicken', minutes: 25 }, { name: 'Turn the broccoli', minutes: 12 }] },
    { title: 'Cook the rice', imageUrl: 'https://picsum.photos/800/600', text: 'Meanwhile, bring the rice and chicken broth to a boil.', bullets: ['Cover, turn the heat to low and simmer 18-20 minutes.', 'Rest off the heat for 5 minutes, then fluff.'] },
    { text: 'Slice the chicken and serve with the rice, broccoli and pan juices.', bullets: [] },
  ] },
  seedRecipe('pasta', 'Spaghetti Bolognese', 'Rich tomato and beef sauce over spaghetti.',
    'Soften onion and garlic in olive oil. Add beef and brown thoroughly. Stir in crushed tomatoes, salt, and pepper; simmer for 25 minutes. Boil spaghetti in water until tender, drain, and toss with sauce. Top with Parmesan and basil.',
    'The sauce can be made a day ahead and refrigerated.', [
      ['Yellow onion', 1, null, 'Produce', 'Diced'], ['Garlic', 3, 'clove', 'Produce', 'Minced'], ['Olive oil', 1, 'tbsp', 'Pantry'], ['Ground beef', 1, 'lb', 'Meat'],
      ['Crushed tomatoes', 1, 'can', 'Pantry', undefined, '28 oz can'], ['Salt', 0.5, 'tsp', 'Pantry'], ['Black pepper', 0.25, 'tsp', 'Pantry'],
      ['Spaghetti', 1, 'lb', 'Pantry'], ['Parmesan', 0.5, 'cup', 'Dairy', 'Grated'], ['Basil', 0.25, 'cup', 'Produce', 'Chopped'],
    ]),
  seedRecipe('stir-fry', 'Tofu vegetable stir-fry', 'Crisp vegetables and tofu over rice.',
    'Cook rice in water until tender. Whisk soy sauce, honey, ginger, and garlic. Pat tofu dry and sear in sesame oil. Add broccoli and sliced peppers; stir-fry until tender-crisp. Add sauce and heat through, then serve over rice.',
    'Press the tofu for 15 minutes before cutting into cubes.', [
      ['Rice', 1.5, 'cup', 'Pantry'], ['Water', 3, 'cup', 'Pantry'], ['Soy sauce', 0.25, 'cup', 'Pantry'], ['Honey', 1, 'tbsp', 'Pantry'],
      ['Ginger', 1, 'tbsp', 'Produce', 'Grated'], ['Garlic', 2, 'clove', 'Produce', 'Minced'], ['Firm tofu', 1, 'lb', 'Refrigerated'],
      ['Sesame oil', 2, 'tbsp', 'Pantry'], ['Broccoli', 1, 'lb', 'Produce', 'Cut into florets'], ['Bell peppers', 2, null, 'Produce', 'Sliced'],
    ]),
  seedRecipe('salmon', 'Salmon with potatoes and green beans', 'A sheet-pan fish dinner with lemon and dill.',
    'Toss halved potatoes with half the oil, salt, and pepper. Roast at 425°F for 20 minutes. Add salmon and green beans with the remaining oil and seasonings. Roast until salmon reaches 145°F and potatoes are tender, about 15 minutes. Finish with lemon juice and dill.',
    'Use small potatoes so everything finishes together.', [
      ['Salmon', 1.5, 'lb', 'Seafood'], ['Baby potatoes', 1.5, 'lb', 'Produce', 'Halved'], ['Green beans', 1, 'lb', 'Produce', 'Trimmed'],
      ['Olive oil', 3, 'tbsp', 'Pantry'], ['Salt', 0.5, 'tsp', 'Pantry'], ['Black pepper', 0.25, 'tsp', 'Pantry'], ['Lemons', 1, null, 'Produce', 'Juiced'], ['Dill', 2, 'tbsp', 'Produce', 'Chopped'],
    ]),
  seedRecipe('pizza', 'Garden vegetable pizza', 'Family pizza with peppers, tomatoes, and mozzarella.',
    'Stretch dough onto two baking trays. Spread with pizza sauce, then add mozzarella, sliced peppers, tomatoes, and oregano. Bake at 450°F for 15–20 minutes until the crust is golden and cheese is bubbling.',
    'Let the dough come to room temperature before stretching.', [
      ['Pizza dough', 2, 'lb', 'Bakery'], ['Pizza sauce', 1, 'cup', 'Pantry'], ['Mozzarella', 2, 'cup', 'Dairy', 'Grated'],
      ['Bell peppers', 1, null, 'Produce', 'Sliced'], ['Tomatoes', 2, null, 'Produce', 'Sliced'], ['Oregano', 1, 'tsp', 'Pantry'],
    ]),
  seedRecipe('snack', 'Hummus and veggie plates', 'Colorful vegetables, hummus, and pita for sharing.',
    'Cut carrots and cucumber into sticks. Slice pita into triangles and divide onto four plates with hummus and tomatoes.',
    'Store cut vegetables in a covered container in the fridge.', [
      ['Hummus', 1, 'cup', 'Refrigerated'], ['Carrots', 4, null, 'Produce', 'Cut into sticks'], ['Cucumber', 1, null, 'Produce', 'Cut into sticks'],
      ['Pita bread', 2, null, 'Bakery'], ['Cherry tomatoes', 1, 'cup', 'Produce', 'Quartered'],
    ]),
]
// Demo family ratings (m1 Alex, m2 Sam, m3 Maya, m4 Leo), as the server sends them.
const rated = (byMember: Record<string, number>) => {
  const stars = Object.values(byMember)
  return { average: stars.length ? Math.round(stars.reduce((a, b) => a + b, 0) / stars.length * 10) / 10 : null, count: stars.length, byMember }
}
const seedRatings: Record<string, Record<string, number>> = {
  tacos: { m1: 5, m2: 4, m3: 5, m4: 5 }, pizza: { m1: 4, m2: 4, m3: 5, m4: 5 }, pancakes: { m2: 5, m3: 4, m4: 5 },
  pasta: { m1: 4, m2: 3, m4: 4 }, salmon: { m1: 5, m2: 4, m3: 2, m4: 1 }, 'stir-fry': { m1: 4, m3: 3 },
}
recipes = recipes.map(r => ({ ...r, rating: rated(seedRatings[r.id.slice(5)] ?? {}) }))
// Basics: made ahead and used inside other recipes. Tuesday Tacos' seasoning and the pizza's dough link to them.
const seedBasic = (id: string, name: string, description: string, instructions: string, makes: string, ingredients: SeedIngredient[], steps: Recipe['steps']): Recipe =>
  ({ ...seedRecipe(id, name, description, instructions, '', ingredients), preparationNotes: null, kind: 'basic', makes, steps, rating: rated({}) })
recipes.push(
  seedBasic('taco-seasoning', 'Taco seasoning', 'A mild blend for tacos, burrito bowls and roasted veggies.', 'Stir everything together. Keep in a jar for up to 6 months.', 'about ¼ cup', [
    ['Chili powder', 2, 'tbsp', 'Spices'], ['Ground cumin', 1, 'tbsp', 'Spices'], ['Smoked paprika', 1, 'tsp', 'Spices'], ['Garlic powder', 1, 'tsp', 'Spices'],
    ['Onion powder', 1, 'tsp', 'Spices'], ['Dried oregano', 0.5, 'tsp', 'Spices'], ['Salt', 1, 'tsp', 'Pantry'],
  ], [{ text: 'Stir the chili powder, cumin, paprika, garlic powder, onion powder, oregano and salt together.', bullets: [], title: 'Mix' }, { text: 'Keep it in a jar for up to 6 months.', bullets: [], title: 'Store' }]),
  seedBasic('pizza-dough', 'Pizza dough', 'An easy dough for two family pizzas.', 'Mix the flour, yeast and salt. Add the water and olive oil and knead for 8 minutes. Let it rise for 1 hour.', '2 large crusts', [
    ['Flour', 4, 'cup', 'Pantry'], ['Instant yeast', 2.25, 'tsp', 'Baking'], ['Salt', 1.5, 'tsp', 'Pantry'], ['Warm water', 1.5, 'cup', 'Pantry'], ['Olive oil', 2, 'tbsp', 'Pantry'],
  ], [{ text: 'Mix the flour, yeast and salt, then add the warm water and olive oil.', bullets: [], title: 'Mix' }, { text: 'Knead for 8 minutes, until smooth.', bullets: [], timers: [{ name: 'Knead', minutes: 8 }] }, { text: 'Cover and let it rise for 1 hour.', bullets: [], title: 'Rise' }]),
)
// Tuesday Tacos' "Taco seasoning" and the pizza's "Pizza dough" are made from those basics.
const link = (recipeId: string, ingredient: string, basicId: string) => {
  const basic = recipes.find(r => r.id === basicId)!
  recipes = recipes.map(r => r.id !== recipeId ? r : { ...r, ingredients: r.ingredients.map(i => i.name === ingredient ? { ...i, basicId, basicName: basic.name } : i) })
}
link('demo-tacos', 'Taco seasoning', 'demo-taco-seasoning')
link('demo-pizza', 'Pizza dough', 'demo-pizza-dough')
const recipe = recipes[0]
// Each row is Sunday through Saturday; columns match breakfast, lunch, dinner, snack.
const menu = [
  ['pancakes', 'wraps', 'chicken', 'parfaits'],
  ['oats', 'wraps', 'pasta', 'snack'],
  ['parfaits', 'wraps', 'tacos', 'snack'],
  ['oats', 'leftovers', 'stir-fry', 'parfaits'],
  ['pancakes', 'wraps', 'salmon', 'snack'],
  ['oats', 'wraps', 'takeout', 'parfaits'],
  ['pancakes', 'cafe', 'chicken', 'snack'],
]
let meals: Meal[] = menu.flatMap((day, dayIndex) => day.map((key, slotIndex) => {
  const chosen = recipes.find(r => r.id === `demo-${key}`)
  return {
    id: `demo-meal-${dayIndex}-${MEAL_SLOTS[slotIndex]}`, date: dates[dayIndex], slot: MEAL_SLOTS[slotIndex],
    title: chosen?.name ?? (key === 'leftovers' ? 'Leftover taco bowls' : key === 'takeout' ? 'Corner Slice' : 'Lunch at the neighborhood cafe'),
    mealKind: chosen ? 'recipe' : key === 'leftovers' ? 'freeform' : 'dining_out', recipeId: chosen?.id ?? null,
    restaurantId: key === 'takeout' ? 'demo-corner-slice' : null, orderType: key === 'takeout' ? 'pickup' : null, orders: [],
    recipeSnapshot: chosen ? { name: chosen.name, defaultServings: chosen.defaultServings, ingredients: chosen.ingredients.map(i => ({ ...i })) } : null,
    servings: key === 'tacos' ? 6 : 4, assigneeMemberId: dayIndex % 2 === 0 ? 'm1' : 'm2', eaterIds: slotIndex === 2 && key !== 'tacos' ? ['m1', 'm2', 'm3', 'm4'] : [],
    notes: key === 'leftovers' ? 'Use the reserved taco filling and toppings from Tuesday.' : key === 'takeout' ? 'Pizza night! Pick up on the way home from practice.' : key === 'cafe' ? 'Meet after the morning activities; no groceries needed.' : key === 'tacos' ? 'Taco Tuesday! Six servings so there is filling for Wednesday lunch.' : chosen!.preparationNotes,
    plannedTime: ['07:30', '12:00', '18:00', '15:30'][slotIndex], status: dayIndex === 0 ? 'prepared' : key === 'leftovers' ? 'prepared' : 'planned',
    sourceUrl: null, calendarEventId: null, createdAt: stamp, updatedAt: stamp,
  }
}))
// The restaurant binder: made-up places only (never real restaurants in the demo).
type SeedItem = [section: string, name: string, price: number, favorite?: boolean, description?: string]
const seedPlace = (id: string, name: string, cuisine: string, phone: string, address: string, notes: string | null, items: SeedItem[]): Restaurant => ({
  id: `demo-${id}`, name, cuisine, phone, address, website: `https://example.com/${id}`, orderUrl: `https://example.com/${id}/order`, menuUrl: null, notes, archived: false,
  menu: items.map(([section, name, price, favorite, description], sort): MenuItem => ({ id: `demo-${id}-${sort}`, section, name, description: description ?? null, priceCents: Math.round(price * 100), favorite: !!favorite, sort })),
  createdAt: stamp, updatedAt: stamp,
})
let restaurants: Restaurant[] = [
  // A full takeout menu, the way a photographed one reads in: sizes and counts in the description
  // ("12\" $12.99 · 16\" $16.99"), and an Add-ons section saying what each goes with.
  seedPlace('corner-slice', 'Corner Slice', 'Pizza', '555-0142', '12 Elm Street, Springfield', 'Ask for the crust well done. Pickup is around the back.', [
    ['Pizza', 'Cheese pizza', 12.99, true, '12" $12.99 · 16" $16.99 — Hand-tossed, our red sauce and whole-milk mozzarella'],
    ['Pizza', 'Pepperoni pizza', 14.49, true, '12" $14.49 · 16" $18.99 — Cup pepperoni that crisps at the edges'],
    ['Pizza', 'Veggie pizza', 15.49, false, '12" $15.49 · 16" $19.99 — Peppers, onions, black olives, mushrooms and tomatoes'],
    ['Pizza', 'Margherita', 14.99, false, '12" $14.99 · 16" $18.99 — Fresh mozzarella, basil and olive oil'],
    ['Pizza', 'Personal cheese pizza', 7.99, false, '8 inch, just right for one'],
    ['Specialty pizza', 'Elm Street Special', 17.99, false, '12" $17.99 · 16" $22.99 — Pepperoni, sausage, meatball, peppers, onions, mushrooms and black olives'],
    ['Specialty pizza', 'BBQ chicken', 16.99, false, '12" $16.99 · 16" $21.99 — Grilled chicken, red onion, smoked gouda and a sweet BBQ sauce base'],
    ['Specialty pizza', 'Buffalo chicken', 16.99, false, '12" $16.99 · 16" $21.99 — Crispy chicken tossed in buffalo sauce, blue cheese drizzle and celery'],
    ['Specialty pizza', 'Meat lover’s', 17.99, false, '12" $17.99 · 16" $22.99 — Pepperoni, sausage, ham, bacon and ground beef'],
    ['Specialty pizza', 'White garden', 16.49, false, '12" $16.49 · 16" $20.99 — Ricotta and garlic base, spinach, roasted tomatoes, zucchini and parmesan'],
    ['Specialty pizza', 'Hawaiian', 15.99, false, '12" $15.99 · 16" $20.49 — Ham, pineapple and a little bacon'],
    ['Specialty pizza', 'Spinach and feta', 15.99, false, '12" $15.99 · 16" $20.49 — Spinach, feta, red onion, garlic and oregano'],
    ['Appetizers', 'Garlic knots', 5.5, true, '(6) $5.50 · (12) $9.75 — With marinara'],
    ['Appetizers', 'Mozzarella sticks', 8.49, false, 'With marinara'],
    ['Appetizers', 'Chicken wings', 8.99, false, '(6) $8.99 · (12) $15.99 — Flavors: Buffalo | BBQ | Garlic parm | Honey hot'],
    ['Appetizers', 'Chicken tenders', 8.99, true, '(4) $8.99 · (8) $14.99 — With honey mustard'],
    ['Appetizers', 'French fries', 3.99, false, 'Small $3.99 · Large $5.99'],
    ['Appetizers', 'Curly fries', 5.49],
    ['Appetizers', 'Onion rings', 5.99],
    ['Appetizers', 'Loaded potato skins', 8.99, false, 'Cheddar, bacon and sour cream'],
    ['Appetizers', 'Fried pickles', 6.99, false, 'With ranch'],
    ['Salads', 'Garden salad', 5.99, false, 'Small $5.99 · Large $8.99 — Greens, tomato, cucumber, red onion and croutons'],
    ['Salads', 'Caesar salad', 8.99, false, 'Romaine, parmesan, croutons and Caesar dressing'],
    ['Salads', 'Greek salad', 9.49, false, 'Greens, feta, black olives, tomato, cucumber, red onion and pepperoncini'],
    ['Salads', 'Antipasto', 12.99, false, 'Greens, ham, salami, provolone, olives, roasted red peppers and tomatoes with Italian dressing'],
    ['Salads', 'Chicken Caesar wrap', 10.99, false, 'Grilled chicken, romaine, parmesan and Caesar dressing in a flour wrap'],
    ['Burgers', 'Classic burger', 8.99, false, 'Single $8.99 · Double $11.99 — Lettuce, tomato, pickles and American cheese'],
    ['Burgers', 'Bacon cheddar burger', 10.49, false, 'Single $10.49 · Double $13.49 — Bacon, sharp cheddar and BBQ sauce'],
    ['Burgers', 'Mushroom Swiss burger', 11.99, false, 'Sautéed mushrooms, Swiss cheese and garlic mayo'],
    ['Burgers', 'Veggie burger', 10.99, false, 'Black bean patty, lettuce, tomato and chipotle mayo'],
    ['Subs and sandwiches', 'Meatball sub', 7.99, false, 'Half $7.99 · Whole $11.99 — Homemade meatballs, marinara and provolone'],
    ['Subs and sandwiches', 'Eggplant or chicken parm', 10.99, false, 'Eggplant $10.99 · Chicken $12.49 — Breaded, with marinara and provolone on a toasted roll'],
    ['Subs and sandwiches', 'Italian sub', 7.99, false, 'Half $7.99 · Whole $11.99 — Ham, salami, capicola, provolone, lettuce, tomato, onion, oil and vinegar'],
    ['Subs and sandwiches', 'Steak and cheese', 8.99, false, 'Half $8.99 · Whole $12.99 — Shaved steak, grilled onions and American cheese'],
    ['Subs and sandwiches', 'Turkey club', 10.99, false, 'Turkey, bacon, lettuce, tomato and mayo on toasted white'],
    ['Subs and sandwiches', 'Grilled chicken wrap', 10.49, false, 'Grilled chicken, lettuce, tomato, cheddar and ranch'],
    ['Subs and sandwiches', 'BLT', 8.99],
    ['Subs and sandwiches', 'Tuna melt', 9.99, false, 'Tuna salad and American cheese on grilled rye'],
    ['Pasta', 'Spaghetti and meatballs', 12.99],
    ['Pasta', 'Baked ziti', 11.99, false, 'Ricotta, marinara and melted mozzarella'],
    ['Pasta', 'Chicken alfredo', 14.49, false, 'Fettuccine, grilled chicken and a creamy parmesan sauce'],
    ['Kids', 'Kids’ cheese pizza', 6.49, false, 'A small cheese pizza with a juice box'],
    ['Kids', 'Kids’ chicken nuggets', 6.49, false, 'With fries'],
    ['Kids', 'Kids’ mac and cheese', 5.99, true],
    ['Kids', 'Kids’ grilled cheese', 5.99, false, 'With fries'],
    ['Desserts', 'Chocolate chip cookie', 1.99],
    ['Desserts', 'Cannoli', 3.99],
    ['Desserts', 'Brownie', 3.49],
    ['Desserts', 'Cinnamon knots', 4.99, false, '(6) with icing'],
    ['Drinks', 'Lemonade', 2.75],
    ['Drinks', 'Fountain soda', 1.99, false, 'Small $1.99 · Large $2.99'],
    ['Drinks', '2-liter soda', 3.5],
    ['Drinks', 'Bottled water', 1.75],
    ['Drinks', 'Chocolate milk', 1.99],
    ['Add-ons', 'Extra topping', 1.5, false, '12" $1.50 · 16" $2.25 — Pepperoni, sausage, mushrooms, onions, peppers, olives or bacon — For Pizza and Specialty pizza'],
    ['Add-ons', 'Extra cheese', 1.5, false, '12" $1.50 · 16" $2.25 — For Pizza and Specialty pizza'],
    ['Add-ons', 'Stuffed crust', 2.99, false, 'For Pizza and Specialty pizza'],
    ['Add-ons', 'Gluten-free crust', 3, false, 'For Pizza'],
    ['Add-ons', 'Bacon', 1.5, false, 'For Burgers and Subs and sandwiches'],
    ['Add-ons', 'Avocado', 1.75, false, 'For Burgers, Salads and Subs and sandwiches'],
    ['Add-ons', 'Sub fries', 1.75, false, 'For Burgers and Subs and sandwiches'],
    ['Add-ons', 'Grilled chicken', 4, false, 'For Salads and Pasta'],
    ['Add-ons', 'Side of ranch', 0.75, false, 'For Appetizers and Salads'],
  ]),
  seedPlace('golden-bowl', 'Golden Bowl', 'Chinese', '555-0178', '480 Market Avenue, Springfield', 'Cash or card. Mild unless you ask.', [
    ['Starters', 'Egg rolls (2)', 4.5, true], ['Starters', 'Crab rangoon (6)', 6.95], ['Starters', 'Wonton soup', 4.25],
    ['Noodles & rice', 'Chicken lo mein', 11.95, true], ['Noodles & rice', 'Vegetable fried rice', 9.95], ['Noodles & rice', 'Beef chow fun', 13.5],
    ['Entrées', 'Orange chicken', 13.25, true, 'With white rice'], ['Entrées', 'Broccoli beef', 13.95], ['Entrées', 'Sweet and sour tofu', 12.5],
  ]),
  seedPlace('maple-diner', 'Maple Street Diner', 'Breakfast & burgers', '555-0115', '7 Maple Street, Springfield', null, [
    ['Breakfast', 'Short stack pancakes', 7.5, true], ['Breakfast', 'Two eggs any style', 8.25],
    ['Burgers', 'Classic cheeseburger', 11.5, true], ['Burgers', 'Veggie burger', 11.0], ['Sides', 'Fries', 3.95], ['Sides', 'Onion rings', 4.75],
  ]),
]

// Friday's pizza night: three orders in, Maya's still to come. Last Friday's (already ordered) is everyone's usual.
const pick = (placeId: string, name: string, qty = 1, note: string | null = null, option?: string) => { const i = restaurants.find(r => r.id === placeId)!.menu.find(x => x.name === name)!; return { menuItemId: i.id, name: option ? `${i.name} (${option})` : i.name, qty, note } }
const placed = (memberId: string, items: ReturnType<typeof pick>[], note: string | null = null) => ({ memberId, items, note, updatedAt: stamp })
const friday = meals.find(m => m.restaurantId === 'demo-corner-slice')!
const slice = (name: string, qty = 1, note: string | null = null, option?: string) => pick('demo-corner-slice', name, qty, note, option)
friday.orders = [placed('m1', [slice('Pepperoni pizza', 1, null, '16"')]), placed('m2', [slice('Caesar salad', 1, '+ Grilled chicken'), slice('Garlic knots', 1, null, '6')], 'Extra ranch, please'), placed('m4', [slice('Chicken tenders', 1, 'Honey mustard on the side', '4')])]
meals.push({ ...friday, id: 'demo-meal-last-friday', date: dateKey(new Date(Date.parse(`${friday.date}T12:00:00`) - 7 * 86400000)), status: 'prepared', notes: null,
  orders: [placed('m1', [slice('Pepperoni pizza', 1, null, '16"')]), placed('m2', [slice('Caesar salad')]), placed('m3', [slice('Kids’ mac and cheese')]), placed('m4', [slice('Chicken tenders', 1, null, '4')])] })
// On the calendar (mock.ts's demo-meal-ev-* events): Sunday's dinner (cooked), Tuesday Tacos, Wednesday's leftovers (cooked),
// Friday's pizza night (3 of 4 orders in) and last Friday's (ordered).
for (const [mealId, eventId] of [['demo-meal-0-dinner', 'demo-meal-ev-0'], ['demo-meal-2-dinner', 'demo-meal-ev-2'], ['demo-meal-3-lunch', 'demo-meal-ev-3'], [friday.id, 'demo-meal-ev-5'], ['demo-meal-last-friday', 'demo-meal-ev-last']]) {
  const meal = meals.find(m => m.id === mealId)!
  meal.calendarEventId = eventId; meal.calendarEventStart = 'meal'
}
/** GET /api/events' `meal` on each linked event (server/src/prepBy.ts). */
export const mockEventMeals = () => new Map(meals.filter(m => m.calendarEventId).map(m => [m.calendarEventId!, {
  id: m.id, status: m.status, mealKind: m.mealKind, restaurantId: m.restaurantId ?? null, eaterCount: m.eaterIds.length, orderCount: (m.orders ?? []).filter(o => o.items.length).length,
}]))
/** The server's read-only lastOrders / upcoming on a restaurant (server/src/routes/restaurants.ts). */
function withNights(r: Restaurant): Restaurant {
  const today = dateKey(new Date())
  const mine = meals.filter(m => m.restaurantId === r.id)
  const lastOrders = mine.filter(m => m.status !== 'planned').sort((a, b) => b.date.localeCompare(a.date)).flatMap(m => (m.orders ?? []).filter(o => o.items.length).map(o => ({ memberId: o.memberId, mealId: m.id, date: m.date, items: o.items })))
    .filter((o, i, all) => all.findIndex(x => x.memberId === o.memberId) === i)
  const upcoming = mine.filter(m => m.date >= today).sort((a, b) => a.date.localeCompare(b.date)).map(m => ({ mealId: m.id, date: m.date, slot: m.slot, plannedTime: m.plannedTime, orderType: m.orderType ?? null, status: m.status, eaterIds: m.eaterIds, orderCount: m.orders?.length ?? 0 }))
  return { ...r, lastOrders, upcoming }
}
/** GET /api/events/{id}/meal. */
export const mockEventMeal = async (eventId: string) => ({ meal: meals.find(m => m.calendarEventId === eventId) ?? null })

const claims = new Map<string, string>()
const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ')
const fingerprint = (key: string, quantity: number | null, servings: number, date: string) => JSON.stringify([key, quantity, servings, date])

// The server's rules (server/src/meals.ts shoppingProjection): a line made from a basic is its own item
// until answered; made skips it, ingredients adds the basic's own ingredients once, as written.
async function projection(from: string, to: string, listId: string | null, basics: BasicChoices = {}): Promise<ShoppingProjection> {
  const existing = listId ? (await mock.getList(listId)).items : []
  const groups = new Map<string, ShoppingProjection['items'][number]>()
  const planned = meals.filter(m => m.date >= from && m.date <= to && m.mealKind === 'recipe' && m.recipeSnapshot)
  const onList = new Set(planned.flatMap(m => m.recipeSnapshot!.ingredients.filter(i => i.basicId && [...claims.keys()].some(k => k.startsWith(`${listId}:meal-plan:${m.id}:ingredient:${i.id}:basic:`))).map(i => i.basicId!)))
  const expanded = new Set<string>()
  for (const meal of planned) {
    const snapshot = meal.recipeSnapshot!
    for (const line of snapshot.ingredients) {
      const basic = recipes.find(r => r.id === line.basicId && r.kind === 'basic')
      const answer = basic && !onList.has(basic.id) ? basics[basic.id] : undefined
      if (answer === 'made' || (answer === 'ingredients' && expanded.has(basic!.id))) continue
      if (answer === 'ingredients') expanded.add(basic!.id)
      const own = answer === 'ingredients' ? basic!.ingredients.map(i => ({ ingredient: i, ref: `meal-plan:${meal.id}:ingredient:${line.id}:basic:${i.id}`, servings: basic!.defaultServings, defaultServings: basic!.defaultServings, basicName: basic!.name as string | null }))
        : [{ ingredient: line, ref: `meal-plan:${meal.id}:ingredient:${line.id}`, servings: meal.servings, defaultServings: snapshot.defaultServings, basicName: null }]
      for (const { ingredient, ref, servings, defaultServings, basicName } of own) {
        const linked = !basicName && basic ? basic : undefined
        const normalizedName = normalize(ingredient.name)
        const rawUnit = normalize(ingredient.unit ?? '')
        const aliases: Record<string, string> = { cups: 'cup', lbs: 'lb', pound: 'lb', pounds: 'lb', ounces: 'oz', ounce: 'oz', grams: 'g', gram: 'g', kilograms: 'kg', kilogram: 'kg', teaspoons: 'tsp', teaspoon: 'tsp', tablespoons: 'tbsp', tablespoon: 'tbsp', milliliters: 'ml', liters: 'l' }
        const dozen = ['dozen', 'dozens', 'doz'].includes(rawUnit)
        const unit = dozen || ['', 'each', 'count', 'piece', 'pieces'].includes(rawUnit) ? null : aliases[rawUnit] ?? rawUnit
        const { scalable } = ingredient
        const key = JSON.stringify([normalizedName, unit, scalable ? null : ref, ...(linked ? [`basic:${linked.id}`] : [])])
        const quantity = ingredient.quantity === null ? null : scalable ? ingredient.quantity * (dozen ? 12 : 1) * servings / defaultServings : ingredient.quantity
        const applied = claims.has(`${listId}:${ref}`) || (!!linked && onList.has(linked.id))
        const source = { sourceRef: ref, mealId: meal.id, date: meal.date, slot: meal.slot, title: meal.title, recipeName: snapshot.name, quantity, unit: scalable ? unit : ingredient.unit, qualifier: ingredient.qualifier, preparation: ingredient.preparation, scalable, servings, defaultServings, applied, changedSinceApplied: claims.has(`${listId}:${ref}`) && claims.get(`${listId}:${ref}`) !== fingerprint(key, quantity, servings, meal.date), basicName }
        const group = groups.get(key) ?? { key, name: ingredient.name, normalizedName, quantity: null, unit: source.unit, qualifier: ingredient.qualifier, category: ingredient.category, scalable, sources: [], matches: existing.filter(i => normalize(i.title) === normalizedName).map(i => ({ id: i.id, title: i.title, quantity: i.quantity, done: i.done })), applied: false, partiallyApplied: false, changedSinceApplied: false, basicId: linked?.id ?? null, basicName: linked?.name ?? null }
        group.sources.push(source)
        if (quantity !== null) group.quantity = (group.quantity ?? 0) + quantity
        groups.set(key, group)
      }
    }
  }
  return { from, to, listId, items: [...groups.values()].map(item => ({ ...item, applied: item.sources.every(s => s.applied), partiallyApplied: item.sources.some(s => s.applied) && item.sources.some(s => !s.applied), changedSinceApplied: item.sources.some(s => s.changedSinceApplied) })) }
}

/** The demo menu for the Board and a member's day (the server's readMeals). */
export const mockMeals = (from: string, to: string) => meals.filter(m => m.date >= from && m.date <= to)

export async function mockMealRequest(path: string, options: RequestInit): Promise<unknown> {
  const url = new URL(path, 'https://demo.invalid/')
  const [, resource, rawId, action, sub] = url.pathname.slice(1).split('/')
  const id = rawId ? decodeURIComponent(rawId) : undefined
  const method = options.method ?? 'GET'
  const body = options.body ? JSON.parse(String(options.body)) : {}
  if (resource === 'restaurants') {
    if (id === 'details') throw new Error('The demo can’t read websites. Try it on your own Kinwall.')
    if (id === 'parse-menu') throw new Error('The demo can’t read pasted menus. Try it on your own Kinwall, or add items one at a time.')
    const old = restaurants.find(r => r.id === id)
    if (id && !old) throw new Error('Restaurant not found')
    if (method === 'GET') return id ? withNights(old!) : restaurants.filter(r => url.searchParams.get('archived') === 'true' || !r.archived).sort((a, b) => a.name.localeCompare(b.name)).map(withNights)
    if (method === 'DELETE') { restaurants = restaurants.filter(r => r.id !== id); return { ok: true } }
    const input = body as Partial<RestaurantInput>
    const now = new Date().toISOString()
    const saved: Restaurant = { cuisine: null, phone: null, address: null, website: null, orderUrl: null, menuUrl: null, notes: null, archived: false, ...old, ...input, name: input.name ?? old!.name, id: old?.id ?? crypto.randomUUID(),
      menu: input.menu ? input.menu.map((i, sort) => ({ ...i, id: i.id && old?.menu.some(o => o.id === i.id) ? i.id : crypto.randomUUID(), sort })) : old?.menu ?? [], createdAt: old?.createdAt ?? now, updatedAt: now }
    restaurants = [...restaurants.filter(r => r.id !== saved.id), saved]; return saved
  }
  if (resource === 'recipes') {
    if (id === 'import-url' || id === 'parse-text' || id === 'import') throw new Error('The demo can’t read recipe pages. Try it on your own Kinwall.')
    if (method === 'GET') return recipes.filter(r => url.searchParams.get('archived') === 'true' || !r.archived).map(r => ({ kind: 'meal' as const, makes: null, ...r }))
    const old = recipes.find(r => r.id === id)
    if (id && !old) throw new Error('Recipe not found')
    if (action === 'share') {
      // The demo's links go nowhere: there's no server to show the page.
      const share = method === 'DELETE' ? null : old!.share ?? { url: `${location.origin}/r/demo-${old!.id}`, createdAt: new Date().toISOString() }
      recipes = recipes.map(r => r.id === id ? { ...r, share } : r)
      return share ? { ...share, token: `demo-${old!.id}` } : { ok: true }
    }
    if (action === 'link-uses') {
      const basics = recipes.filter(r => r.kind === 'basic' && (!r.archived || r.id === id))
      let linked = 0
      recipes = recipes.map(r => r.id === id ? r : { ...r, ingredients: r.ingredients.map(i => !i.basicId && matchBasic(i.name, basics)?.id === id ? (linked++, { ...i, basicId: id, basicName: old!.name }) : i) })
      return { linked }
    }
    if (action === 'rating') {
      const byMember = { ...old!.rating?.byMember }
      if (body.stars) byMember[body.memberId] = body.stars; else delete byMember[body.memberId]
      const saved = { ...old!, rating: rated(byMember) }
      recipes = recipes.map(r => r.id === saved.id ? saved : r); return saved
    }
    if (method === 'DELETE') { recipes = recipes.filter(r => r.id !== id).map(r => ({ ...r, ingredients: r.ingredients.map(i => i.basicId === id ? { ...i, basicId: null, basicName: null } : i) })); meals = meals.map(m => m.recipeId === id ? { ...m, recipeId: null } : m); return { ok: true } }
    const input = body as Partial<RecipeInput>
    const saved: Recipe = { ...recipe, rating: rated({}), ...old, ...input, id: old?.id ?? crypto.randomUUID(), ingredients: input.ingredients?.map((i, sort) => ({ ...i, basicName: recipes.find(r => r.id === i.basicId && r.kind === 'basic')?.name ?? null, id: old?.ingredients.find(previous => normalize(previous.name) === normalize(i.name) && previous.unit === i.unit)?.id ?? crypto.randomUUID(), normalizedName: normalize(i.name), sort, scalable: isScalable(i) })) ?? old?.ingredients ?? [], createdAt: old?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString() }
    recipes = [...recipes.filter(r => r.id !== saved.id), saved]; return saved
  }
  if (id === 'projection') {
    const from = body.from ?? url.searchParams.get('from')!, to = body.to ?? url.searchParams.get('to')!, listId = body.listId ?? url.searchParams.get('listId')
    const result = await projection(from, to, listId, body.basics)
    if (method === 'GET') return result
    const itemIds: string[] = []
    for (const item of result.items.filter(i => !i.applied && !body.omitKeys?.includes(i.key) && (body.includeKitItems || i.qualifier !== KIT_QUALIFIER))) {
      const sources = item.sources.filter(s => !s.applied)
      const quantity = sources.every(s => s.quantity === null) ? null : sources.reduce((sum, s) => sum + (s.quantity ?? 0), 0)
      // Remembered store/category/aisle first (category omitted so memory can fill it), then the recipe's.
      const created = await mock.addListItems(listId, { title: item.name, quantity: ingredientAmount(quantity, item.unit, item.qualifier) || null, notes: body.includeNotes ? sources.map(s => `${s.date} · ${s.slot} · ${s.title}${s.basicName ? ` · for ${s.basicName}` : ''}`).join('\n') : sources.find(s => s.basicName) ? `For ${sources.find(s => s.basicName)!.basicName}` : null })
      for (const c of created) { c.category ??= item.category; c.meals = [...new Set(sources.map(s => s.title))] }
      itemIds.push(...created.map(i => i.id))
      for (const source of sources) claims.set(`${listId}:${source.sourceRef}`, fingerprint(item.key, source.quantity, source.servings, source.date))
    }
    return { added: itemIds.length, itemIds, projection: await projection(from, to, listId) }
  }
  const old = meals.find(m => m.id === id)
  if (method === 'GET') return meals.filter(m => m.date >= url.searchParams.get('from')! && m.date <= url.searchParams.get('to')!)
  if (id && !old) throw new Error('Meal not found')
  const demoKid = mock.demoKid
  if (action === 'orders' && sub) {
    if (old!.status !== 'planned' && demoKid()) throw new Error('This order is in already. Ask a grown-up to change it.')
    if (demoKid() && demoKid() !== sub) throw new Error('This device can only do that for its owner.')
    const others = (old!.orders ?? []).filter(o => o.memberId !== sub)
    old!.orders = method === 'DELETE' || (!body.items?.length && !body.note) ? others : [...others, { memberId: sub, items: body.items.map((i: Partial<OrderItem> & { name: string }) => ({ ...i, menuItemId: i.menuItemId ?? null, qty: i.qty ?? 1, note: i.note ?? null })), note: body.note ?? null, updatedAt: new Date().toISOString() }]
    return { ...old }
  }
  if (action === 'ask-orders') return { ok: true, sent: 0 }
  if (action) {
    if (action === 'swap') {
      const other = meals.find(m => m.id === body.otherId && m.id !== id)
      if (!other) throw new Error('Meal not found')
      ;[old!.date, other.date, old!.slot, other.slot] = [other.date, old!.date, other.slot, old!.slot] // ponytail: demo events don't follow
      return [{ ...old! }, { ...other }]
    }
    if (action === 'calendar-link') { old!.calendarEventId = method === 'DELETE' ? null : body.eventId; old!.calendarEventStart = null }
    if (action === 'calendar-event' && !old!.calendarEventId) {
      const calendar = (await mock.getCalendars()).find(c => c.writable && (body.calendarId ? c.id === body.calendarId : c.kind === 'local'))
      if (!calendar) throw new Error('Create a writable local calendar first.')
      const settings = await mock.getSettings()
      const time = old!.plannedTime ?? settings.mealTimes[old!.slot]
      const minutes = (old!.recipeSnapshot?.totalMinutes || settings.defaultEventMinutes || 60) * 60000
      const at = new Date(`${old!.date}T${time}:00`).getTime()
      const [start, end] = body.eventStart === 'cooking' ? [at - minutes, at] : [at, at + minutes]
      const event = await mock.createEvent({ title: `${old!.slot[0].toUpperCase()}${old!.slot.slice(1)} · ${old!.title}`, calendarId: calendar.id, start: new Date(start).toISOString(), end: new Date(end).toISOString(), allDay: false, memberIds: [...new Set([...old!.eaterIds, ...(old!.assigneeMemberId ? [old!.assigneeMemberId] : [])])] })
      old!.calendarEventId = event.id; old!.calendarEventStart = body.eventStart ?? 'meal'
    }
    return { ...old }
  }
  if (method === 'DELETE') { meals = meals.filter(m => m.id !== id); return { ok: true } }
  const input = body as MealInput & { refreshRecipe?: boolean }
  const saved: Meal = { ...meals[0], ...old, ...input, id: old?.id ?? crypto.randomUUID(), recipeSnapshot: old?.recipeSnapshot ?? null, calendarEventId: old?.calendarEventId ?? null, createdAt: old?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString() }
  if (saved.mealKind === 'recipe' && (!old || saved.recipeId !== old.recipeId || input.refreshRecipe || !saved.recipeSnapshot)) {
    const chosen = recipes.find(r => r.id === saved.recipeId && !r.archived)
    if (!chosen) throw new Error('Recipe not found or archived')
    saved.recipeSnapshot = { name: chosen.name, defaultServings: chosen.defaultServings, ingredients: chosen.ingredients.map(i => ({ ...i })) }
  }
  if (saved.mealKind !== 'recipe') { saved.recipeId = null; saved.recipeSnapshot = null }
  if (saved.mealKind !== 'dining_out') { saved.restaurantId = null; saved.orderType = null }
  else if (saved.restaurantId && saved.restaurantId !== old?.restaurantId && !input.title) saved.title = restaurants.find(r => r.id === saved.restaurantId)?.name ?? saved.title
  saved.orders ??= []
  meals = [...meals.filter(m => m.id !== saved.id), saved]; return saved
}
