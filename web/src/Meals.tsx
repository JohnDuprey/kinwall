import { useEffect, useRef, useState } from 'react'
import { Choose } from './PickField.tsx'
import { withHashParam } from './hashQuery.ts'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import { filterSortLabel, LoadError, reducedMotion, Segmented } from './a11y.tsx'
import { todayKeyInTz } from './date.ts'
import { formatTime } from './timeFormat.ts'
import { ChevronLeft, ChevronRight, FilterIcon, LinkIcon, ListIcon, PlusIcon, XIcon } from './icons.tsx'
import { t, tm, tn } from './i18n.ts'
import { MEAL_SLOTS, SLOT_LABEL, SLOT_WORD, mealDayLabel, statusLabel, mealForMember, mealWeek, minutesLabel, moveMealDate, planDay, recipeTypeLabel, servingsLabel } from './meal-date.ts'
import MealSheet, { EaterAvatars, type MealDraft } from './MealSheet.tsx'
import RecipeSheet, { Stars, ratingOwner } from './RecipeSheet.tsx'
import Sheet from './Sheet.tsx'
import RecipeImportSheet from './RecipeImportSheet.tsx'
import RecipePhoto from './RecipePhoto.tsx'
import { RecipeTagFilter, RecipeTagManager, type RecipeTagChange } from './RecipeTags.tsx'
import MealProjection from './MealProjection.tsx'
import { PlannedMealSheet } from './MealQuickSheet.tsx'
import { useIsPhone, useMediaQuery, usePhoneHeader, SHORT_LANDSCAPE } from './useIsPhone.ts'
import { availableRecipeTagIds, browseRecipes, type RecipeSort, type CookedFilter } from './recipe-search.ts'
import RecipeBrowseControls from './RecipeBrowseControls.tsx'
import type { Meal, MealSlot, Recipe, RecipeKind, RecipeTag, Restaurant } from './meal-types.ts'
import { RestaurantBinder, RestaurantEditSheet, RestaurantSheet } from './Restaurants.tsx'
import { ORDER_TYPE_LABEL, ordersLabel } from './orders.ts'
import { PollSheet, usePolls } from './Polls.tsx'
import { useTripLinks } from './tripLinks.tsx'
import { kitDate } from './meal-kits.ts'
import UseItUp from './UseItUp.tsx'
import type { Me } from './types.ts'
import './meals.css'

export default function Meals() {
  const { settings, members, refreshTick, reloadCore, selectedMemberId } = useApp()
  const timezone = settings.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const today = todayKeyInTz(timezone)
  const [anchor, setAnchor] = useState(today)
  const days = mealWeek(anchor, settings.weekStart)
  const from = days[0], to = days[6]
  const narrow = useIsPhone()
  const shortLandscape = useMediaQuery(SHORT_LANDSCAPE)
  const isPhone = narrow || shortLandscape
  // Phones and portrait tablets list the week day by day (like the Board's Coming up); wider screens
  // show it as day columns (like Calendar's week).
  const agenda = usePhoneHeader() || shortLandscape
  const [view, setView] = useState<'week' | 'recipes' | 'restaurants'>('week')
  const [me, setMe] = useState<Me | null>(null)
  const [authError, setAuthError] = useState('')
  const [data, setData] = useState<{ from: string; to: string; meals: Meal[]; error?: string } | null>(null)
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [recipesLoaded, setRecipesLoaded] = useState(false)
  const [recipeError, setRecipeError] = useState('')
  const [tagCatalog, setTagCatalog] = useState<RecipeTag[]>()
  const [tagError, setTagError] = useState('')
  const [tagIds, setTagIds] = useState<string[]>([])
  const [managingTags, setManagingTags] = useState(false)
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [restaurantsLoaded, setRestaurantsLoaded] = useState(false)
  const [restaurantError, setRestaurantError] = useState('')
  const [place, setPlace] = useState<{ restaurant: Restaurant | null; editing: boolean } | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('active')
  const [category, setCategory] = useState('')
  const [sort, setSort] = useState<RecipeSort>('name')
  const [cooked, setCooked] = useState<CookedFilter>('all')
  // '' everything, 'any' anyone's favorites, else one member's ("Sam's favorites").
  const [loved, setLoved] = useState('')
  const [kind, setKind] = useState<'' | RecipeKind>('')
  const [showFilters, setShowFilters] = useState(false)
  const [restaurantSearch, setRestaurantSearch] = useState('')
  const [restaurantFilter, setRestaurantFilter] = useState('active')
  const [showRestaurantFilters, setShowRestaurantFilters] = useState(false)
  const [editing, setEditing] = useState<{ meal: Meal | null; initial: MealDraft } | null>(null)
  const [recipeSheet, setRecipeSheet] = useState<{ recipe: Recipe | null; readOnly?: boolean } | null>(null)
  const [openMeal, setOpenMeal] = useState<Meal | null>(null)
  const [projection, setProjection] = useState(false)
  const [importing, setImporting] = useState<{ url: string } | null>(null)
  const [tick, setTick] = useState(0)
  const [pendingMeal, setPendingMeal] = useState<string | null>(null)
  const [pendingOrders, setPendingOrders] = useState(false) // #/meals?meal=<id>&orders=1: "Ask for orders" opens the order sheet
  const [pendingRecipe, setPendingRecipe] = useState<string | null>(null) // #/meals?recipe=<id> (Spotlight, Siri)
  const [pendingPlace, setPendingPlace] = useState<string | null>(null) // #/meals?restaurant=<id> (the Add to Kinwall Shortcut)
  const admin = me?.scope === 'admin'
  // An open family poll about a meal shows in its cell (polls off: none come back).
  const polls = usePolls('open')
  const tripLinks = useTripLinks() // a meal planned for a trip shows the trip's name
  const [openPoll, setOpenPoll] = useState<string | null>(null)
  useEffect(() => {
    const read = () => {
      const query = new URLSearchParams(location.hash.split('?')[1] ?? '')
      // A link shared from another app: #/recipes/import?url=…
      if (location.hash.startsWith('#/recipes/import')) { setView('recipes'); setImporting({ url: query.get('url') ?? '' }); history.replaceState(history.state, '', '#/meals'); return }
      if (!location.hash.startsWith('#/meals')) return
      const date = query.get('date')
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date))) setAnchor(date)
      if (query.get('meal')) { setPendingMeal(query.get('meal')); setPendingOrders(query.get('orders') === '1'); setView('week') }
      if (query.get('recipe')) setPendingRecipe(query.get('recipe'))
      if (query.get('restaurant')) setPendingPlace(query.get('restaurant'))
      // cook=<id>: cooking mode was open before a reload. Its recipe opens, and the param stays for RecipeSheet to reopen it.
      const cook = query.get('cook')
      if (cook) setPendingRecipe(cook)
      if (query.toString()) history.replaceState(history.state, '', withHashParam('#/meals', 'cook', cook))
    }
    read(); window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, [])
  useEffect(() => {
    let canceled = false
    api.meStrict().then(value => { if (!canceled) { setMe(value); setAuthError('') } }).catch(() => { if (!canceled) { setMe(null); setAuthError(t('Could not verify editing access. Retry to enable editing.')) } })
    return () => { canceled = true }
  }, [tick, refreshTick])
  useEffect(() => {
    let canceled = false
    api.getMeals(from, to).then(meals => { if (!canceled) setData({ from, to, meals }) }).catch(e => { if (!canceled) setData({ from, to, meals: [], error: e instanceof Error ? e.message : t('Could not load meals.') }) })
    return () => { canceled = true }
  }, [from, to, tick, refreshTick])
  useEffect(() => {
    let canceled = false
    api.getRecipes(true).then(values => { if (!canceled) { setRecipes(values); setRecipesLoaded(true); setRecipeError('') } }).catch(e => { if (!canceled) setRecipeError(e instanceof Error ? e.message : t('Could not load recipes.')) })
    return () => { canceled = true }
  }, [tick, refreshTick])
  const needsTags = view === 'recipes' || !!importing || (!!recipeSheet && !recipeSheet.readOnly)
  useEffect(() => {
    if (!needsTags) return
    let canceled = false
    api.getRecipeTags().then(tags => {
      if (canceled) return
      setTagCatalog(tags)
      setTagIds(selected => availableRecipeTagIds(selected, tags))
      setTagError('')
    }).catch(e => { if (!canceled) setTagError(e instanceof Error ? e.message : t('Could not load recipe tags.')) })
    return () => { canceled = true }
  }, [needsTags, tick, refreshTick])
  useEffect(() => {
    let canceled = false
    api.getRestaurants(true).then(values => { if (!canceled) { setRestaurants(values); setRestaurantsLoaded(true); setRestaurantError('') } }).catch(e => { if (!canceled) setRestaurantError(e instanceof Error ? e.message : t('Could not load restaurants.')) })
    return () => { canceled = true }
  }, [tick, refreshTick])
  // A linked recipe opens like a tap in the recipe library, once the library has loaded; an unknown id just shows Meals.
  useEffect(() => {
    if (!pendingRecipe || !recipesLoaded) return
    const recipe = recipes.find(r => r.id === pendingRecipe)
    if (recipe) { setView('recipes'); setRecipeSheet({ recipe }) }
    setPendingRecipe(null)
  }, [pendingRecipe, recipesLoaded, recipes])
  useEffect(() => {
    if (!pendingPlace || !restaurantsLoaded) return
    const restaurant = restaurants.find(r => r.id === pendingPlace)
    if (restaurant) { setView('restaurants'); setPlace({ restaurant, editing: false }) }
    setPendingPlace(null)
  }, [pendingPlace, restaurantsLoaded, restaurants])
  const saved = () => { setEditing(null); setOpenMeal(null); setPendingMeal(null); setRecipeSheet(null); setTick(n => n + 1); reloadCore() }
  const meals = data?.from === from && data.to === to ? data.meals : null
  const mealError = data?.from === from && data.to === to ? data.error : undefined
  const tagChanged: RecipeTagChange = (id, tag) => {
    setTagCatalog(current => current && [...current.filter(item => item.id !== id), ...(tag ? [tag] : [])]
      .sort((a, b) => a.name.localeCompare(b.name)))
    setRecipes(current => current.map(recipe => recipe.tags?.some(item => item.id === id)
      ? { ...recipe, tags: recipe.tags.flatMap(item => item.id === id ? (tag ? [tag] : []) : [item]) } : recipe))
    if (!tag) setTagIds(ids => ids.filter(value => value !== id))
    setTick(n => n + 1)
  }
  const activeTags = tagCatalog?.filter(tag => tagIds.includes(tag.id)) ?? []
  const clearTags = (keyboard = false) => {
    if (keyboard) document.getElementById('recipe-search')?.focus()
    setTagIds([])
  }
  const currentRecipe = recipeSheet?.recipe && (recipes.find(r => r.id === recipeSheet.recipe?.id) ?? recipeSheet.recipe)
  // A linked meal (#/meals?meal=: notifications, Spotlight, Siri) opens like a tap here, once access and the library are known.
  const linkedMeal = me && pendingMeal && (recipesLoaded || recipeError) ? meals?.find(meal => meal.id === pendingMeal) : null
  const shownMeal = openMeal ?? linkedMeal
  const bySlot = new Map<string, Meal[]>()
  for (const meal of (meals ?? []).filter(meal => mealForMember(meal, selectedMemberId))) { const key = `${meal.date}:${meal.slot}`; bySlot.set(key, [...(bySlot.get(key) ?? []), meal]) }
  // The day-by-day list opens at today, as phones used to open on today's meals. What loads after the
  // plan (Use it up, photos) makes the page tall enough to reach today, so keep today in place as the
  // page grows, until the person scrolls, taps or a few seconds pass.
  const atToday = useRef(false)
  useEffect(() => {
    if (!agenda || !meals || atToday.current) return
    const day = document.getElementById(`meal-day-${today}`)
    const view = day?.closest('.meals-view')
    if (!day || !view) return
    atToday.current = true
    const go = () => day.scrollIntoView({ block: 'start' })
    go()
    const growing = new ResizeObserver(go)
    for (const part of view.children) growing.observe(part)
    const stop = () => { growing.disconnect(); clearTimeout(timer); for (const type of ['pointerdown', 'wheel', 'keydown']) view.removeEventListener(type, stop) }
    const timer = setTimeout(stop, 4000)
    for (const type of ['pointerdown', 'wheel', 'keydown']) view.addEventListener(type, stop)
  }, [agenda, meals, today])
  const categories = [...new Set(recipes.flatMap(recipe => recipe.ingredients.map(i => i.category).filter((c): c is string => !!c)))].sort()
  const shownRecipes = browseRecipes(recipes.filter(recipe => (filter === 'kits' ? !!recipe.kits?.length : filter === 'all' || recipe.archived === (filter === 'archived')) && (!kind || (recipe.kind ?? 'meal') === kind) && (!category || recipe.ingredients.some(i => i.category === category)) && (!loved || (loved === 'any' ? !!recipe.favoritedBy?.length : !!recipe.favoritedBy?.includes(loved)))), { query: search, sort, cooked, tagIds })
  const filterCount = [kind, filter !== 'active', category, loved, cooked !== 'all', sort !== 'name', tagIds.length > 0].filter(Boolean).length
  const filters = <>
    <div className="field"><label htmlFor="recipe-kind">{t('Type')}</label><Choose hideLabel label={t('Type')} id="recipe-kind" value={kind} onChange={next => setKind(next as '' | RecipeKind)}
      options={[
        { value: '', label: t('All') },
        { value: 'meal', label: t('Main dishes') },
        { value: 'side', label: t('Sides') },
        { value: 'dessert', label: t('Desserts') },
        { value: 'basic', label: t('Basics') },
      ]} /></div>
    <div className="field"><label htmlFor="recipe-filter">{t('Show')}</label><Choose hideLabel label={t('Show')} id="recipe-filter" value={filter} onChange={setFilter}
      options={[
        { value: 'active', label: t('Active recipes') },
        { value: 'kits', label: t('Meal kits on hand') },
        { value: 'archived', label: t('Archived recipes') },
        { value: 'all', label: t('All recipes') },
      ]} /></div>
    <div className="field"><label htmlFor="recipe-category">{t('Ingredient category')}</label><Choose hideLabel label={t('Ingredient category')} id="recipe-category" value={category} onChange={setCategory} sheet
      options={[
        { value: '', label: t('All categories') },
        ...categories.map(c => ({ value: c, label: c })),
      ]} /></div>
    <div className="field"><label htmlFor="recipe-loved">{t('Favorites')}</label><Choose hideLabel label={t('Favorites')} id="recipe-loved" value={loved} onChange={setLoved} sheet
      options={[
        { value: '', label: t('All recipes') },
        { value: 'any', label: t("Anyone's favorites") },
        ...members.map(m => ({ value: m.id, label: t("{name}'s favorites", { name: m.name }) })),
      ]} /></div>
    <div className="recipe-filter-tags"><RecipeTagFilter tags={tagCatalog ?? []} value={tagIds} onChange={setTagIds} />
      {admin && <button type="button" className="link-btn recipe-tag-action" onClick={() => setManagingTags(true)}>{t('Manage tags')}</button>}
    </div>
    <RecipeBrowseControls sort={sort} cooked={cooked} onSort={setSort} onCooked={setCooked} />
  </>
  const freeSlot = (date: string) => ['dinner', ...MEAL_SLOTS].find(slot => !bySlot.has(`${date}:${slot}`)) as typeof MEAL_SLOTS[number] | undefined
  const planMeal = () => { const date = planDay(today, from, to); setEditing({ meal: null, initial: { date, slot: freeSlot(date) ?? 'dinner' } }) }
  const restaurantQuery = restaurantSearch.trim().toLocaleLowerCase()
  const shownRestaurants = restaurants.filter(r => (restaurantFilter === 'all' || r.archived === (restaurantFilter === 'archived'))
    && (!restaurantQuery || [r.name, r.cuisine ?? '', ...r.menu.map(i => i.name)].some(s => s.toLocaleLowerCase().includes(restaurantQuery))))
  const restaurantFilters = <div className="field"><label htmlFor="restaurant-filter">{t('Show')}</label><Choose hideLabel label={t('Show')} id="restaurant-filter" value={restaurantFilter} onChange={setRestaurantFilter}
    options={[{ value: 'active', label: t('Active') }, { value: 'archived', label: t('Archived') }, { value: 'all', label: t('All') }]} /></div>
  const restaurantSearchField = <div className="field meals-search"><label className={isPhone ? 'sr-only' : undefined} htmlFor="restaurant-search">{t('Find a restaurant')}</label><input id="restaurant-search" type="search" placeholder={t('Pizza, lo mein…')} value={restaurantSearch} onChange={e => setRestaurantSearch(e.target.value)} /></div>
  // Today: this week, then (in the day-by-day list) scroll to today's meals.
  const showToday = () => { setAnchor(today); if (agenda) requestAnimationFrame(() => document.getElementById(`meal-day-${today}`)?.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' })) }
  const plannerControls = <>
    <div className="meal-actions"><button className="icon-btn" aria-label={t('Previous meal week')} onClick={() => setAnchor(moveMealDate(anchor, -7))}><ChevronLeft /></button><button className="btn btn-secondary" onClick={showToday}>{agenda ? t('Today') : t('This week')}</button><button className="icon-btn" aria-label={t('Next meal week')} onClick={() => setAnchor(moveMealDate(anchor, 7))}><ChevronRight /></button></div>
  </>
  const useItUp = settings.features.meals && <UseItUp recipes={recipes} admin={admin} reload={tick} poll={refreshTick} onOpen={recipe => setRecipeSheet({ recipe })} onPlan={recipe => setEditing({ meal: null, initial: { date: today, slot: 'dinner', recipe } })} />
  // The day's meals in clock order: a 3:30 snack before a 6:00 dinner. Without a time, a meal sits
  // where its slot usually falls.
  const mealClock = (meal: Meal, slot: MealSlot) => meal.plannedTime ?? { breakfast: '08:00', lunch: '12:00', snack: '15:00', dinner: '18:00' }[slot]
  // A meal as one row, like an event on the Board: when and which meal, the name, who's cooking.
  // Servings, eaters and notes stay in the meal's sheet.
  const mealRow = (meal: Meal, date: string, slot: MealSlot) => {
    const assignee = members.find(member => member.id === meal.assigneeMemberId)
    const recipe = recipes.find(r => r.id === meal.recipeId)
    const trip = tripLinks.get(`meal:${meal.id}`)
    const kit = recipe?.kits?.[0]
    const meta = [meal.mealKind === 'dining_out' && meal.orderType && tm(ORDER_TYPE_LABEL[meal.orderType]), meal.mealKind === 'dining_out' && meal.status === 'planned' && meal.orders?.length && ordersLabel(meal), meal.status !== 'planned' && `✓ ${statusLabel(meal)}`].filter(Boolean).join(' · ')
    return <button key={meal.id} type="button" className={`snap-row meal-row meal-${slot}${meal.status !== 'planned' ? ' meal-complete' : ''}`} onClick={() => setOpenMeal(meal)}
      aria-label={[tm(SLOT_LABEL[slot]), mealDayLabel(date), meal.title, trip && t('for the trip {title}', { title: trip.title }), statusLabel(meal), kit && t('Cook by {date}', { date: kitDate(kit.cookBy) }), assignee && t('cooked by {name}', { name: assignee.name }), meal.eaterIds?.length && t('for {names}', { names: members.filter(m => meal.eaterIds.includes(m.id)).map(m => m.name).join(', ') })].filter(Boolean).join(', ')}>
      {recipe?.imageUrl && <RecipePhoto id={recipe.id} className="meal-thumb" />}
      <span className="board-bar" aria-hidden="true" />
      <span className="snap-main" aria-hidden="true">
        <span className="board-when">{[meal.plannedTime && formatTime(meal.plannedTime), tm(SLOT_LABEL[slot])].filter(Boolean).join(' · ')}</span>
        <span className="snap-title">{meal.mealKind === 'dining_out' && '↗ '}{meal.title}</span>
        {kit && <span className="kit-tag meal-kit-tag">📦 <span>{t('Cook by {date}', { date: kitDate(kit.cookBy) })}</span></span>}
        {meta && <span className="snap-meta">{meta}</span>}
        {trip && <span className="meal-trip-tag">{trip.emoji || '✈️'} {trip.title}</span>}
      </span>
      {assignee && <span className="board-avatars meal-cook" aria-hidden="true">{assignee.avatar}</span>}
    </button>
  }

  return <div className="meals-view scroll-y">
    <div className="meals-heading"><div><h1>{t('Meals')}</h1><p className="field-hint">{t('What are we eating, and what do we need to buy?')}</p></div>
      {admin && <button type="button" className="icon-btn meals-phone-groceries" aria-label={t('Groceries')} onClick={() => setProjection(true)}><ListIcon /></button>}
      <div className="meal-actions meals-desktop-actions">{admin && <button className="btn btn-secondary" onClick={() => setProjection(true)}><ListIcon /> {t('Groceries')}</button>}{admin && <button className={`btn btn-secondary meals-import ${view !== 'recipes' ? 'meals-import-placeholder' : ''}`} disabled={view !== 'recipes'} onClick={() => setImporting({ url: '' })}><LinkIcon /> {t('Import from a link')}</button>}{admin && <div className="meals-heading-add"><button className="btn btn-primary" onClick={() => view === 'week' ? planMeal() : view === 'recipes' ? setRecipeSheet({ recipe: null }) : setPlace({ restaurant: null, editing: true })}><PlusIcon /> {view === 'week' ? t('Plan meal') : view === 'recipes' ? t('New recipe') : t('New restaurant')}</button></div>}</div>
    </div>
    <div className="meals-navigation">
      <Segmented tabs idBase="meals-tab" label={t('Meals sections')} value={view} onChange={setView} options={[{ key: 'week', label: t('Week planner') }, { key: 'recipes', label: t('Recipe library') }, { key: 'restaurants', label: t('Restaurants') }]} />
      {view === 'recipes' && <>
        <div className="field meals-search"><label className="sr-only" htmlFor="recipe-search">{t('Find a recipe')}</label><input id="recipe-search" type="search" placeholder={t('Find a recipe')} value={search} onChange={e => setSearch(e.target.value)} /></div>
        <button type="button" className={`btn btn-secondary filter-btn meals-filters-btn ${filterCount ? 'active' : ''}`} aria-haspopup="dialog" aria-label={filterSortLabel(filterCount)} onClick={() => setShowFilters(true)}>
          <FilterIcon width={20} height={20} /><span className="meals-filters-label">{t('Filters')}</span>{filterCount > 0 && <span className="filter-badge" aria-hidden="true">{filterCount}</span>}
        </button>
        {admin && <button type="button" className="btn btn-primary meals-add-recipe" aria-label={t('Add a recipe')} onClick={() => setRecipeSheet({ recipe: null })}><PlusIcon /></button>}
      </>}
      {isPhone && view === 'week' && <div className="meals-planner-controls">{plannerControls}{admin && <button type="button" className="btn btn-primary meals-plan" aria-label={t('Plan a meal')} onClick={planMeal}><PlusIcon /></button>}</div>}
      {isPhone && view === 'restaurants' && <>
        {restaurantSearchField}
        <button type="button" className={`btn btn-secondary filter-btn meals-filters-btn ${restaurantFilter !== 'active' ? 'active' : ''}`} aria-haspopup="dialog" aria-label={filterSortLabel(restaurantFilter !== 'active' ? 1 : 0)} onClick={() => setShowRestaurantFilters(true)}><FilterIcon width={20} height={20} />{restaurantFilter !== 'active' && <span className="filter-badge" aria-hidden="true">1</span>}</button>
        {admin && <button type="button" className="btn btn-primary meals-add-recipe" aria-label={t('Add a restaurant')} onClick={() => setPlace({ restaurant: null, editing: true })}><PlusIcon /></button>}
      </>}
    </div>
    {authError && <p role="alert" className="field-error">{authError} <button className="link-btn" onClick={() => setTick(n => n + 1)}>{t('Retry')}</button></p>}
    {me && !admin && <p className="field-hint">{t('A grown-up plans the meals. You can rate recipes, add your order on a takeout night and mark a meal you cook as done.')}</p>}
    {view === 'week' ? <section role="tabpanel" aria-labelledby="meals-tab-week">
      <div className="meals-toolbar">
        {!isPhone && plannerControls}
        <h2 aria-live="polite">{t('{from} – {to}', { from: mealDayLabel(from, { month: 'short', day: 'numeric' }), to: mealDayLabel(to, { month: 'short', day: 'numeric', year: 'numeric' }) })}</h2>
      </div>
      {recipeError && <p className="field-error" role="alert">{t('The recipe library could not refresh.')} <button className="link-btn" onClick={() => setTick(n => n + 1)}>{t('Retry')}</button></p>}
      {mealError ? <LoadError what="the meal plan" error={mealError} onRetry={() => setTick(n => n + 1)} /> : !meals ? <p role="status">{t('Loading meals…')}</p>
        : <div className={agenda ? 'meal-week meal-agenda' : 'meal-week'} role="region" aria-label={t('Weekly meal plan')}>{days.map(date => {
          const isToday = date === today
          const open = MEAL_SLOTS.filter(slot => !bySlot.has(`${date}:${slot}`) && !polls.some(p => p.date === date && p.slot === slot))
          return <section key={date} id={`meal-day-${date}`} className={`meal-day${isToday ? ' today' : ''}`} aria-labelledby={`meal-day-${date}-name`}>
            {agenda
              ? <h3 className="meal-day-head" id={`meal-day-${date}-name`}>{mealDayLabel(date, { weekday: 'long', month: 'short', day: 'numeric' })}{isToday && <span className="meal-today-label">{t('Today')}</span>}</h3>
              : <h3 className={`week-header-cell meal-day-head${isToday ? ' today' : ''}`} id={`meal-day-${date}-name`} aria-label={[mealDayLabel(date, { weekday: 'long', month: 'short', day: 'numeric' }), isToday && t('Today')].filter(Boolean).join(', ')}>
                <span className="wd" aria-hidden="true">{mealDayLabel(date, { weekday: 'short' })}</span><span className="dn" aria-hidden="true">{mealDayLabel(date, { day: 'numeric' })}</span></h3>}
            {MEAL_SLOTS.flatMap(slot => (bySlot.get(`${date}:${slot}`) ?? []).map(meal => ({ meal, slot }))).sort((a, b) => mealClock(a.meal, a.slot).localeCompare(mealClock(b.meal, b.slot))).map(({ meal, slot }) => mealRow(meal, date, slot))}
            {polls.filter(p => p.date === date).map(p => <button key={p.id} type="button" className="meal-poll" aria-haspopup="dialog" onClick={() => setOpenPoll(p.id)}><span><span aria-hidden="true">🗳</span> {t('Vote open')}</span><small>{p.question}</small></button>)}
            {admin && (agenda
              // Each empty slot as a small chip (a full day: one "Add", for a second dish); on the week's
              // columns, one button (dinner first, the slot families plan most). Any slot can hold more than one meal.
              ? <div className="meal-add-chips">{(open.length ? open : ['dinner' as MealSlot]).map(slot => <button key={slot} type="button" className="meal-add-chip" aria-label={t('Plan {meal} for {day}', { meal: tm(SLOT_WORD[slot]), day: mealDayLabel(date) })} onClick={() => setEditing({ meal: null, initial: { date, slot } })}><PlusIcon width={14} height={14} aria-hidden="true" /> {open.length ? tm(SLOT_LABEL[slot]) : t('Add')}</button>)}</div>
              : <button type="button" className="meal-add" aria-label={t('Plan a meal for {day}', { day: mealDayLabel(date) })} onClick={() => setEditing({ meal: null, initial: { date, slot: freeSlot(date) ?? 'dinner' } })}><PlusIcon width={16} height={16} aria-hidden="true" /> {open.includes('dinner') ? tm(SLOT_LABEL.dinner) : t('Add')}</button>)}
            {!admin && open.length === MEAL_SLOTS.length && <p className="meal-empty">{t('Nothing planned')}</p>}
          </section>
        })}</div>}
      {useItUp}
    </section> : view === 'restaurants' ? <RestaurantBinder restaurants={shownRestaurants} search={restaurantSearch} filter={restaurantFilter} controls={!isPhone && <div className="meals-toolbar">{restaurantSearchField}{restaurantFilters}</div>} loaded={restaurantsLoaded} error={restaurantError} onRetry={() => setTick(n => n + 1)} onOpen={restaurant => setPlace({ restaurant, editing: false })} /> : <section role="tabpanel" aria-labelledby="meals-tab-recipes">
      {showFilters && <Sheet title={t('Filter and sort')} onClose={() => setShowFilters(false)} actions={<>
        {filterCount > 0 && <button type="button" className="btn btn-secondary" onClick={() => { setKind(''); setFilter('active'); setCategory(''); setLoved(''); setCooked('all'); setSort('name'); setTagIds([]) }}>{t('Clear filters')}</button>}
        <button type="button" className="btn btn-primary" onClick={() => setShowFilters(false)}>{tn(shownRecipes.length, 'Show {n} recipe', 'Show {n} recipes')}</button>
      </>}>{filters}</Sheet>}
      {activeTags.length > 0 && <div className="chip-row recipe-tag-chips" role="group" aria-label={t('Active recipe tags')}>
        {activeTags.map(tag => <button key={tag.id} type="button" className="chip" aria-label={t('Remove tag filter: {name}', { name: tag.name })}
          onClick={event => {
            if (activeTags.length === 1) clearTags(event.detail === 0)
            else {
              (event.currentTarget.nextElementSibling as HTMLElement | null)?.focus()
              setTagIds(ids => ids.filter(id => id !== tag.id))
            }
          }}><span>{tag.name}</span><XIcon width={16} height={16} aria-hidden="true" /></button>)}
        <button type="button" className="link-btn recipe-tag-action" onClick={event => clearTags(event.detail === 0)}>{t('Clear tags')}</button>
      </div>}
      {tagError && <p role="alert" className="field-error">{tagError} <button type="button" className="link-btn recipe-tag-action" onClick={() => setTick(n => n + 1)}>{t('Retry')}</button></p>}
      {recipeError && <LoadError what="recipes" error={recipeError} onRetry={() => setTick(n => n + 1)} />}
      {!recipesLoaded && !recipeError ? <p role="status">{t('Loading recipes…')}</p> : <>
        <p className="sr-only" role="status" aria-live="polite">{tn(shownRecipes.length, '{n} recipe', '{n} recipes')}</p>
        {shownRecipes.length === 0 && !recipeError && <p className="state-card">{search || category || kind || loved || cooked !== 'all' || filter !== 'active' || tagIds.length ? t('No recipes match these filters.') : t('Your recipe library is ready. Add a recipe with ingredients to start planning.')}</p>}
        <div className="recipe-library">{shownRecipes.map(recipe => <button key={recipe.id} className="recipe-card" onClick={() => setRecipeSheet({ recipe })}>
          {recipe.imageUrl && <RecipePhoto id={recipe.id} className="recipe-card-photo" />}
          <strong>{recipe.name}{recipe.kind && recipe.kind !== 'meal' && <span className="kit-tag">{recipeTypeLabel(recipe.kind)}</span>}</strong><span>{[recipe.kind === 'basic' ? recipe.makes && t('Makes {amount}', { amount: recipe.makes }) : servingsLabel(recipe.defaultServings), tn(recipe.ingredients.length, '{n} ingredient', '{n} ingredients'), recipe.totalMinutes && minutesLabel(recipe.totalMinutes), recipe.archived && t('Archived')].filter(Boolean).join(' · ')}</span>{!!recipe.rating?.count && <Stars average={recipe.rating.average!} count={recipe.rating.count} />}{!!recipe.favoritedBy?.length && <span className="recipe-loved"><span aria-hidden="true">♥</span><EaterAvatars ids={recipe.favoritedBy} members={members} label={t('Favorite of')} /></span>}{recipe.description && <p>{recipe.description}</p>}
        </button>)}</div>
      </>}
    </section>}
    {isPhone && showRestaurantFilters && <Sheet title={t('Filters')} onClose={() => setShowRestaurantFilters(false)} actions={<>
      {restaurantFilter !== 'active' && <button type="button" className="btn btn-secondary" onClick={() => setRestaurantFilter('active')}>{t('Clear filters')}</button>}
      <button type="button" className="btn btn-primary" onClick={() => setShowRestaurantFilters(false)}>{tn(shownRestaurants.length, 'Show {n} restaurant', 'Show {n} restaurants')}</button>
    </>}>{restaurantFilters}</Sheet>}
    {shownMeal && <PlannedMealSheet key={shownMeal.id} meal={shownMeal} recipes={recipes} me={me} startOrders={pendingOrders && shownMeal.id === pendingMeal} onRated={() => setTick(n => n + 1)} onClose={() => { setOpenMeal(null); setPendingMeal(null); setPendingOrders(false) }} onSaved={saved} />}
    {editing && <MealSheet meal={editing.meal} initial={editing.initial} recipes={recipes} admin={admin} owner={me?.owner} me={me} onChanged={() => setTick(n => n + 1)} onClose={() => setEditing(null)} onSaved={saved} onRecipe={recipe => setRecipeSheet({ recipe, readOnly: true })} />}
    {recipeSheet && <RecipeSheet key={recipeSheet.recipe?.id ?? 'new'} recipe={currentRecipe ?? null} library={recipes} tagCatalog={tagCatalog} onTagChanged={tagChanged} onImport={() => setImporting({ url: '' })} admin={admin && !recipeSheet.readOnly} owner={ratingOwner(me)} onRated={() => setTick(n => n + 1)} onClose={() => setRecipeSheet(null)} onSaved={saved} onPlan={recipeSheet.readOnly || !admin ? undefined : recipe => { setRecipeSheet(null); setEditing({ meal: null, initial: { date: today, slot: 'dinner', recipe } }) }} />}
    {importing && me && <RecipeImportSheet url={importing.url} admin={admin} library={recipes} tagCatalog={tagCatalog} onTagChanged={tagChanged} onClose={() => setImporting(null)} onSaved={recipe => { setImporting(null); setTick(n => n + 1); setRecipeSheet({ recipe }) }} />}
    {managingTags && admin && <RecipeTagManager tags={tagCatalog ?? []} onChange={tagChanged} onClose={() => setManagingTags(false)} />}
    {place && !place.editing && place.restaurant && <RestaurantSheet key={place.restaurant.id} restaurant={place.restaurant} admin={admin} onClose={() => setPlace(null)} onEdit={() => setPlace({ ...place, editing: true })}
      onPlan={async restaurant => {
        // A night out is for a dinner coming up: the first one in the next two weeks with nothing planned.
        const planned = await api.getMeals(today, moveMealDate(today, 13)).catch(() => [])
        const date = Array.from({ length: 14 }, (_, i) => moveMealDate(today, i)).find(d => !planned.some(m => m.date === d && m.slot === 'dinner')) ?? today
        setPlace(null); setEditing({ meal: null, initial: { date, slot: 'dinner', restaurant } })
      }}
      onOpenMeal={(id, date) => { setPlace(null); location.hash = `#/meals?date=${date}&meal=${encodeURIComponent(id)}` }}
      onSaved={saved => { setTick(n => n + 1); setPlace(saved && !saved.archived ? { restaurant: saved, editing: false } : null) }} />}
    {place?.editing && <RestaurantEditSheet restaurant={place.restaurant} onClose={() => setPlace(place.restaurant ? { ...place, editing: false } : null)} onSaved={saved => { setTick(n => n + 1); setPlace({ restaurant: saved, editing: false }) }} />}
    {openPoll && <PollSheet id={openPoll} onClose={() => { setOpenPoll(null); setTick(n => n + 1) }} />}
    {projection && <MealProjection from={from} to={to} admin={admin} onClose={() => setProjection(false)} />}
  </div>
}
