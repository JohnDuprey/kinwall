// In-memory meal fixtures for VITE_MOCK only; production always uses the meal API.
import { mock } from './mock.ts'
import { dateKey } from './date.ts'
import { ingredientAmount, mealWeek, MEAL_SLOTS } from './meal-date.ts'
import { KIT_QUALIFIER, type Meal, type MealInput, type Recipe, type RecipeInput, type ShoppingProjection } from './meal-types.ts'

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
  seedRecipe('chicken', 'Lemon chicken with rice and broccoli', 'A complete chicken dinner with rice and roasted vegetables.',
    'Toss chicken and broccoli with olive oil, lemon juice, minced garlic, salt, and pepper. Roast at 425°F until the chicken reaches 165°F, about 25 minutes. Meanwhile simmer rice in broth until tender. Serve together with the pan juices.',
    'Cut broccoli into evenly sized florets.', [
      ['Chicken breast', 1.5, 'lb', 'Meat'], ['Broccoli', 1, 'lb', 'Produce', 'Cut into florets'], ['Olive oil', 2, 'tbsp', 'Pantry'], ['Lemons', 2, null, 'Produce', 'Juiced'],
      ['Garlic', 4, 'clove', 'Produce', 'Minced'], ['Salt', 0.5, 'tsp', 'Pantry'], ['Black pepper', 0.25, 'tsp', 'Pantry'], ['Rice', 1.5, 'cup', 'Pantry'], ['Chicken broth', 3, 'cup', 'Pantry'],
    ]),
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
const recipe = recipes[0]
// Each row is Sunday through Saturday; columns match breakfast, lunch, dinner, snack.
const menu = [
  ['pancakes', 'wraps', 'chicken', 'parfaits'],
  ['oats', 'wraps', 'pasta', 'snack'],
  ['parfaits', 'wraps', 'tacos', 'snack'],
  ['oats', 'leftovers', 'stir-fry', 'parfaits'],
  ['pancakes', 'wraps', 'salmon', 'snack'],
  ['oats', 'wraps', 'pizza', 'parfaits'],
  ['pancakes', 'cafe', 'chicken', 'snack'],
]
let meals: Meal[] = menu.flatMap((day, dayIndex) => day.map((key, slotIndex) => {
  const chosen = recipes.find(r => r.id === `demo-${key}`)
  return {
    id: `demo-meal-${dayIndex}-${MEAL_SLOTS[slotIndex]}`, date: dates[dayIndex], slot: MEAL_SLOTS[slotIndex],
    title: chosen?.name ?? (key === 'leftovers' ? 'Leftover taco bowls' : 'Lunch at the neighborhood cafe'),
    mealKind: chosen ? 'recipe' : key === 'leftovers' ? 'freeform' : 'dining_out', recipeId: chosen?.id ?? null,
    recipeSnapshot: chosen ? { name: chosen.name, defaultServings: chosen.defaultServings, ingredients: chosen.ingredients.map(i => ({ ...i })) } : null,
    servings: key === 'tacos' ? 6 : 4, assigneeMemberId: dayIndex % 2 === 0 ? 'm1' : 'm2', eaterIds: slotIndex === 2 && key !== 'tacos' ? ['m1', 'm2', 'm3', 'm4'] : [],
    notes: key === 'leftovers' ? 'Use the reserved taco filling and toppings from Tuesday.' : key === 'cafe' ? 'Meet after the morning activities; no groceries needed.' : key === 'tacos' ? 'Taco Tuesday! Six servings so there is filling for Wednesday lunch.' : chosen!.preparationNotes,
    plannedTime: ['07:30', '12:00', '18:00', '15:30'][slotIndex], status: dayIndex === 0 ? 'prepared' : key === 'leftovers' ? 'handled' : 'planned',
    sourceUrl: null, calendarEventId: null, createdAt: stamp, updatedAt: stamp,
  }
}))
const claims = new Map<string, string>()
const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ')
const fingerprint = (key: string, quantity: number | null, servings: number, date: string) => JSON.stringify([key, quantity, servings, date])

async function projection(from: string, to: string, listId: string | null): Promise<ShoppingProjection> {
  const existing = listId ? (await mock.getList(listId)).items : []
  const groups = new Map<string, ShoppingProjection['items'][number]>()
  for (const meal of meals.filter(m => m.date >= from && m.date <= to && m.mealKind === 'recipe' && m.recipeSnapshot)) {
    const snapshot = meal.recipeSnapshot!
    for (const ingredient of snapshot.ingredients) {
      const ref = `meal-plan:${meal.id}:ingredient:${ingredient.id}`
      const normalizedName = normalize(ingredient.name)
      const rawUnit = normalize(ingredient.unit ?? '')
      const aliases: Record<string, string> = { cups: 'cup', lbs: 'lb', pound: 'lb', pounds: 'lb', ounces: 'oz', ounce: 'oz', grams: 'g', gram: 'g', kilograms: 'kg', kilogram: 'kg', teaspoons: 'tsp', teaspoon: 'tsp', tablespoons: 'tbsp', tablespoon: 'tbsp', milliliters: 'ml', liters: 'l' }
      const dozen = ['dozen', 'dozens', 'doz'].includes(rawUnit)
      const unit = dozen || ['', 'each', 'count', 'piece', 'pieces'].includes(rawUnit) ? null : aliases[rawUnit] ?? rawUnit
      const { scalable } = ingredient
      const key = JSON.stringify([normalizedName, unit, scalable ? null : ref])
      const quantity = ingredient.quantity === null ? null : scalable ? ingredient.quantity * (dozen ? 12 : 1) * meal.servings / snapshot.defaultServings : ingredient.quantity
      const applied = claims.has(`${listId}:${ref}`)
      const source = { sourceRef: ref, mealId: meal.id, date: meal.date, slot: meal.slot, title: meal.title, recipeName: snapshot.name, quantity, unit: scalable ? unit : ingredient.unit, qualifier: ingredient.qualifier, preparation: ingredient.preparation, scalable, servings: meal.servings, defaultServings: snapshot.defaultServings, applied, changedSinceApplied: applied && claims.get(`${listId}:${ref}`) !== fingerprint(key, quantity, meal.servings, meal.date) }
      const group = groups.get(key) ?? { key, name: ingredient.name, normalizedName, quantity: null, unit: source.unit, qualifier: ingredient.qualifier, category: ingredient.category, scalable, sources: [], matches: existing.filter(i => normalize(i.title) === normalizedName).map(i => ({ id: i.id, title: i.title, quantity: i.quantity, done: i.done })), applied: false, partiallyApplied: false, changedSinceApplied: false }
      group.sources.push(source)
      if (quantity !== null) group.quantity = (group.quantity ?? 0) + quantity
      groups.set(key, group)
    }
  }
  return { from, to, listId, items: [...groups.values()].map(item => ({ ...item, applied: item.sources.every(s => s.applied), partiallyApplied: item.sources.some(s => s.applied) && item.sources.some(s => !s.applied), changedSinceApplied: item.sources.some(s => s.changedSinceApplied) })) }
}

/** The demo menu for the Board and a member's day (the server's readMeals). */
export const mockMeals = (from: string, to: string) => meals.filter(m => m.date >= from && m.date <= to)

export async function mockMealRequest(path: string, options: RequestInit): Promise<unknown> {
  const url = new URL(path, 'https://demo.invalid/')
  const [, resource, rawId, action] = url.pathname.slice(1).split('/')
  const id = rawId ? decodeURIComponent(rawId) : undefined
  const method = options.method ?? 'GET'
  const body = options.body ? JSON.parse(String(options.body)) : {}
  if (resource === 'recipes') {
    if (id === 'import-url' || id === 'parse-text' || id === 'import') throw new Error('The demo can’t read recipe pages. Try it on your own Kinwall.')
    if (method === 'GET') return recipes.filter(r => url.searchParams.get('archived') === 'true' || !r.archived)
    const old = recipes.find(r => r.id === id)
    if (id && !old) throw new Error('Recipe not found')
    if (method === 'DELETE') { recipes = recipes.filter(r => r.id !== id); meals = meals.map(m => m.recipeId === id ? { ...m, recipeId: null } : m); return { ok: true } }
    const input = body as Partial<RecipeInput>
    const saved: Recipe = { ...recipe, ...old, ...input, id: old?.id ?? crypto.randomUUID(), ingredients: input.ingredients?.map((i, sort) => ({ ...i, id: old?.ingredients.find(previous => normalize(previous.name) === normalize(i.name) && previous.unit === i.unit)?.id ?? crypto.randomUUID(), normalizedName: normalize(i.name), sort, scalable: isScalable(i) })) ?? old?.ingredients ?? [], createdAt: old?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString() }
    recipes = [...recipes.filter(r => r.id !== saved.id), saved]; return saved
  }
  if (id === 'projection') {
    const from = body.from ?? url.searchParams.get('from')!, to = body.to ?? url.searchParams.get('to')!, listId = body.listId ?? url.searchParams.get('listId')
    const result = await projection(from, to, listId)
    if (method === 'GET') return result
    const itemIds: string[] = []
    for (const item of result.items.filter(i => !i.applied && !body.omitKeys?.includes(i.key) && (body.includeKitItems || i.qualifier !== KIT_QUALIFIER))) {
      const sources = item.sources.filter(s => !s.applied)
      const quantity = sources.every(s => s.quantity === null) ? null : sources.reduce((sum, s) => sum + (s.quantity ?? 0), 0)
      // Remembered store/category/aisle first (category omitted so memory can fill it), then the recipe's.
      const created = await mock.addListItems(listId, { title: item.name, quantity: ingredientAmount(quantity, item.unit, item.qualifier) || null, notes: body.includeNotes ? sources.map(s => `${s.date} · ${s.slot} · ${s.title}`).join('\n') : null })
      for (const c of created) { c.category ??= item.category; c.meals = [...new Set(sources.map(s => s.title))] }
      itemIds.push(...created.map(i => i.id))
      for (const source of sources) claims.set(`${listId}:${source.sourceRef}`, fingerprint(item.key, source.quantity, source.servings, source.date))
    }
    return { added: itemIds.length, itemIds, projection: await projection(from, to, listId) }
  }
  const old = meals.find(m => m.id === id)
  if (method === 'GET') return meals.filter(m => m.date >= url.searchParams.get('from')! && m.date <= url.searchParams.get('to')!)
  if (id && !old) throw new Error('Meal not found')
  if (action) {
    if (action === 'calendar-link') { old!.calendarEventId = method === 'DELETE' ? null : body.eventId; old!.calendarEventStart = null }
    if (action === 'calendar-event' && !old!.calendarEventId) {
      const calendar = (await mock.getCalendars()).find(c => c.writable && (body.calendarId ? c.id === body.calendarId : c.kind === 'local'))
      if (!calendar) throw new Error('Create a writable local calendar first.')
      const time = old!.plannedTime ?? (await mock.getSettings()).mealTimes[old!.slot]
      const minutes = (old!.recipeSnapshot?.totalMinutes || 60) * 60000
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
  meals = [...meals.filter(m => m.id !== saved.id), saved]; return saved
}
