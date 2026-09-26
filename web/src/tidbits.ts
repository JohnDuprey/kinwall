// The Board's rotating quote / fact card: the built-in quotes and facts (no network), plus the
// online sources the family turned on in Settings -> Quotes & facts. Picked from the date and a
// 30-minute slot, so every display in the house shows the same one at the same time.
import type { FactCategory, OnlineTidbits, OnThisDayKind, TidbitSettings, TidbitSource } from './types.ts'

export const QUOTES: { text: string; by: string }[] = [
  { text: 'Not all those who wander are lost.', by: 'J.R.R. Tolkien' },
  { text: 'All we have to decide is what to do with the time that is given us.', by: 'J.R.R. Tolkien' },
  { text: 'Even the smallest person can change the course of the future.', by: 'J.R.R. Tolkien' },
  { text: 'Imagination is more important than knowledge.', by: 'Albert Einstein' },
  { text: 'The important thing is not to stop questioning.', by: 'Albert Einstein' },
  { text: 'Life is like riding a bicycle. To keep your balance you must keep moving.', by: 'Albert Einstein' },
  { text: 'Look deep into nature, and then you will understand everything better.', by: 'Albert Einstein' },
  { text: 'The only way to have a friend is to be one.', by: 'Ralph Waldo Emerson' },
  { text: 'If I have seen further it is by standing on the shoulders of giants.', by: 'Isaac Newton' },
  { text: 'A journey of a thousand miles begins with a single step.', by: 'Lao Tzu' },
  { text: 'Knowing others is intelligence; knowing yourself is true wisdom.', by: 'Lao Tzu' },
  { text: 'Well done is better than well said.', by: 'Benjamin Franklin' },
  { text: 'Energy and persistence conquer all things.', by: 'Benjamin Franklin' },
  { text: 'Lost time is never found again.', by: 'Benjamin Franklin' },
  { text: 'The more that you read, the more things you will know.', by: 'Dr. Seuss' },
  { text: 'Today you are You, that is truer than true. There is no one alive who is Youer than You.', by: 'Dr. Seuss' },
  { text: "A person's a person, no matter how small.", by: 'Dr. Seuss' },
  { text: 'Unless someone like you cares a whole awful lot, nothing is going to get better.', by: 'Dr. Seuss' },
  { text: 'Oh, the thinks you can think up if only you try!', by: 'Dr. Seuss' },
  { text: 'The good thing about science is that it’s true whether or not you believe in it.', by: 'Neil deGrasse Tyson' },
  { text: 'The universe is under no obligation to make sense to you.', by: 'Neil deGrasse Tyson' },
  { text: 'We are made of star-stuff.', by: 'Carl Sagan' },
  { text: 'Imagination will often carry us to worlds that never were. But without it we go nowhere.', by: 'Carl Sagan' },
  { text: 'Nothing in life is to be feared, it is only to be understood.', by: 'Marie Curie' },
  { text: 'One never notices what has been done; one can only see what remains to be done.', by: 'Marie Curie' },
  { text: 'Though she be but little, she is fierce.', by: 'William Shakespeare' },
  { text: 'What’s in a name? That which we call a rose by any other name would smell as sweet.', by: 'William Shakespeare' },
  { text: 'Hope is the thing with feathers that perches in the soul.', by: 'Emily Dickinson' },
  { text: 'In every walk with nature one receives far more than he seeks.', by: 'John Muir' },
  { text: 'The mountains are calling and I must go.', by: 'John Muir' },
  { text: 'Alone we can do so little; together we can do so much.', by: 'Helen Keller' },
  { text: 'Optimism is the faith that leads to achievement.', by: 'Helen Keller' },
  { text: 'Keep your face to the sunshine and you cannot see a shadow.', by: 'Helen Keller' },
  { text: 'You can’t use up creativity. The more you use, the more you have.', by: 'Maya Angelou' },
  { text: 'Try to be a rainbow in someone’s cloud.', by: 'Maya Angelou' },
  { text: 'Do the best you can until you know better. Then when you know better, do better.', by: 'Maya Angelou' },
  { text: 'Darkness cannot drive out darkness; only light can do that.', by: 'Martin Luther King Jr.' },
  { text: 'The time is always right to do what is right.', by: 'Martin Luther King Jr.' },
  { text: 'I am not afraid of storms, for I am learning how to sail my ship.', by: 'Louisa May Alcott' },
  { text: 'Second star to the right, and straight on till morning.', by: 'J.M. Barrie' },
  { text: 'Why, sometimes I’ve believed as many as six impossible things before breakfast.', by: 'Lewis Carroll' },
  { text: 'It’s no use going back to yesterday, because I was a different person then.', by: 'Lewis Carroll' },
  { text: 'Some day you will be old enough to start reading fairy tales again.', by: 'C.S. Lewis' },
  { text: 'Great things are done by a series of small things brought together.', by: 'Vincent van Gogh' },
  { text: 'Colours are the smiles of nature.', by: 'Leigh Hunt' },
  { text: 'A book is a dream that you hold in your hand.', by: 'Neil Gaiman' },
  { text: 'Reading is to the mind what exercise is to the body.', by: 'Joseph Addison' },
  { text: 'Books are a uniquely portable magic.', by: 'Stephen King' },
  { text: 'What you do makes a difference, and you have to decide what kind of difference you want to make.', by: 'Jane Goodall' },
  { text: 'In the end we will conserve only what we love.', by: 'Baba Dioum' },
  { text: 'The sea, once it casts its spell, holds one in its net of wonder forever.', by: 'Jacques Cousteau' },
  { text: 'No water, no life. No blue, no green.', by: 'Sylvia Earle' },
  { text: 'Philosophy begins in wonder.', by: 'Plato' },
  { text: 'The beginning is the most important part of the work.', by: 'Plato' },
  { text: 'Where words fail, music speaks.', by: 'Hans Christian Andersen' },
  { text: 'Just living is not enough. One must have sunshine, freedom, and a little flower.', by: 'Hans Christian Andersen' },
  { text: 'If you look the right way, you can see that the whole world is a garden.', by: 'Frances Hodgson Burnett' },
  { text: 'I’m so glad I live in a world where there are Octobers.', by: 'L.M. Montgomery' },
  { text: 'Isn’t it nice to think that tomorrow is a new day with no mistakes in it yet?', by: 'L.M. Montgomery' },
  { text: 'Curiosity is the wick in the candle of learning.', by: 'William Arthur Ward' },
  { text: 'Equipped with his five senses, man explores the universe around him and calls the adventure Science.', by: 'Edwin Hubble' },
  { text: 'The first principle is that you must not fool yourself, and you are the easiest person to fool.', by: 'Richard Feynman' },
  { text: 'It is not the mountain we conquer, but ourselves.', by: 'Edmund Hillary' },
  { text: 'The best way to cheer yourself up is to try to cheer somebody else up.', by: 'Mark Twain' },
  { text: 'You have brains in your head. You have feet in your shoes. You can steer yourself any direction you choose.', by: 'Dr. Seuss' },
  { text: 'While we teach, we learn.', by: 'Seneca' },
  { text: 'Very little is needed to make a happy life.', by: 'Marcus Aurelius' },
  { text: 'Give me a place to stand, and I will move the earth.', by: 'Archimedes' },
  { text: 'Our greatest glory is not in never falling, but in rising every time we fall.', by: 'Oliver Goldsmith' },
  { text: 'Float like a butterfly, sting like a bee.', by: 'Muhammad Ali' },
  { text: 'You miss 100% of the shots you don’t take.', by: 'Wayne Gretzky' },
  { text: 'When you come to a fork in the road, take it.', by: 'Yogi Berra' },
  { text: 'Champions keep playing until they get it right.', by: 'Billie Jean King' },
  { text: 'Talent wins games, but teamwork and intelligence win championships.', by: 'Michael Jordan' },
  { text: 'Even if you’re on the right track, you’ll get run over if you just sit there.', by: 'Will Rogers' },
  { text: 'Education is the most powerful weapon which you can use to change the world.', by: 'Nelson Mandela' },
  { text: 'Autumn is a second spring when every leaf is a flower.', by: 'Albert Camus' },
  { text: 'Genius is one percent inspiration and ninety-nine percent perspiration.', by: 'Thomas Edison' },
  { text: 'To see a world in a grain of sand and a heaven in a wild flower.', by: 'William Blake' },
  { text: 'Look up at the stars and not down at your feet.', by: 'Stephen Hawking' },
  { text: 'That’s one small step for a man, one giant leap for mankind.', by: 'Neil Armstrong' },
  { text: 'Fall seven times, stand up eight.', by: 'Japanese proverb' },
  { text: 'Many hands make light work.', by: 'Proverb' },
]

export const FACTS: { text: string; category: FactCategory }[] = [
  { text: 'Octopuses have three hearts and blue blood.', category: 'animals' },
  { text: 'A day on Venus is longer than its whole year.', category: 'space' },
  { text: 'Bananas are berries, but strawberries are not.', category: 'plants' },
  { text: 'Sharks have been around longer than trees.', category: 'animals' },
  { text: 'Sunlight takes about 8 minutes to reach Earth.', category: 'space' },
  { text: 'A group of flamingos is called a flamboyance.', category: 'animals' },
  { text: 'Sea otters often hold paws while they sleep so they don’t drift apart.', category: 'animals' },
  { text: 'Wombats make cube-shaped poop.', category: 'animals' },
  { text: 'The Eiffel Tower grows up to about 15 cm taller on hot summer days, as the iron expands.', category: 'science' },
  { text: 'There are more trees on Earth than stars in the Milky Way.', category: 'plants' },
  { text: 'A bolt of lightning is about five times hotter than the surface of the Sun.', category: 'science' },
  { text: 'Butterflies taste with their feet.', category: 'animals' },
  { text: 'The word “alphabet” comes from alpha and beta, the first two Greek letters.', category: 'words' },
  { text: 'Saturn is so light for its size that it’s less dense than water.', category: 'space' },
  { text: 'Koalas can sleep up to 20 hours a day.', category: 'animals' },
  { text: 'Your heart beats about 100,000 times a day.', category: 'body' },
  { text: 'Babies are born with around 300 bones; adults have 206, because some fuse together.', category: 'body' },
  { text: 'Jupiter’s Great Red Spot is a storm bigger than the whole Earth.', category: 'space' },
  { text: 'Neptune was found using math before anyone saw it through a telescope.', category: 'space' },
  { text: 'The Moon drifts about 3.8 cm farther from Earth every year.', category: 'space' },
  { text: 'Footprints on the Moon could last millions of years, because there’s no wind to blow them away.', category: 'space' },
  { text: 'A polar bear’s fur is actually see-through, and its skin is black.', category: 'animals' },
  { text: 'A giraffe has seven neck bones, the same number as you.', category: 'animals' },
  { text: 'The blue whale is the largest animal known to have ever lived.', category: 'animals' },
  { text: 'Tiny tardigrades, or “water bears”, have survived being exposed to outer space.', category: 'animals' },
  { text: 'Venus is the hottest planet, even though Mercury is closer to the Sun.', category: 'space' },
  { text: 'Mount Everest grows a few millimeters taller every year.', category: 'science' },
  { text: 'The Pacific Ocean covers about a third of Earth’s surface.', category: 'science' },
  { text: 'Honeybees do a “waggle dance” to tell each other where to find flowers.', category: 'animals' },
  { text: 'An ostrich’s eye is bigger than its brain.', category: 'animals' },
  { text: 'Every dog’s nose print is unique, like a fingerprint.', category: 'animals' },
  { text: 'Owls can’t move their eyes, so they turn their heads up to 270 degrees instead.', category: 'animals' },
  { text: 'A baby kangaroo is called a joey.', category: 'animals' },
  { text: 'Sea stars have no brain and no blood.', category: 'animals' },
  { text: 'Some turtles can breathe through their bottoms.', category: 'animals' },
  { text: 'The word “robot” comes from a Czech word for hard work, and first appeared in a 1920 play.', category: 'words' },
  { text: '“Goodbye” started out as “God be with ye”.', category: 'words' },
  { text: 'The dot over a lowercase i or j is called a tittle.', category: 'words' },
  { text: 'The word “run” has hundreds of different meanings in the Oxford English Dictionary.', category: 'words' },
  { text: '“The quick brown fox jumps over the lazy dog” uses every letter of the alphabet.', category: 'words' },
  { text: 'Shakespeare is the first known writer to use the words “eyeball” and “bedroom”.', category: 'words' },
  { text: 'The word “muscle” comes from the Latin for “little mouse”.', category: 'words' },
  { text: '“Astronaut” means “star sailor” in Greek.', category: 'words' },
  { text: '“Dinosaur” means “terrible lizard”.', category: 'words' },
  { text: '“Hippopotamus” means “river horse” in Greek.', category: 'words' },
  { text: 'Rainbows are really full circles; from the ground we usually see only the top arc.', category: 'science' },
  { text: 'Almost every snowflake has six sides.', category: 'science' },
  { text: 'Lightning flashes about 40 to 50 times every second somewhere on Earth.', category: 'science' },
  { text: 'Thousands of years ago the Sahara was green, with lakes, grasslands and hippos.', category: 'science' },
  { text: 'Antarctica is the world’s largest desert, because so little snow or rain falls there.', category: 'science' },
  { text: 'Earth’s inner core is about as hot as the surface of the Sun.', category: 'science' },
  { text: 'The International Space Station circles Earth about every 90 minutes, so astronauts see around 16 sunrises a day.', category: 'space' },
  { text: 'Olympus Mons on Mars is about two and a half times as tall as Mount Everest.', category: 'space' },
  { text: 'A year on Mercury lasts just 88 Earth days.', category: 'space' },
  { text: 'About a million Earths could fit inside the Sun.', category: 'space' },
  { text: 'Mars is red because its dust is full of iron oxide: rust.', category: 'space' },
  { text: 'Pluto is smaller than our Moon.', category: 'space' },
  { text: 'Uranus spins on its side, like a rolling ball.', category: 'space' },
  { text: 'Astronauts can grow up to about 5 cm taller in space, because their spines stretch out.', category: 'space' },
  { text: 'Venus spins backwards compared with most planets, so its Sun rises in the west.', category: 'space' },
  { text: 'Frogs don’t drink with their mouths; they soak up water through their skin.', category: 'animals' },
  { text: 'Garden snails have thousands of tiny teeth.', category: 'animals' },
  { text: 'Emperor penguin dads keep their egg warm on their feet for about two months.', category: 'animals' },
  { text: 'A peregrine falcon can dive at over 320 km/h (200 mph), faster than any other animal.', category: 'animals' },
  { text: 'Some bamboo can grow almost a meter in a single day.', category: 'plants' },
  { text: 'Some bristlecone pine trees are more than 4,800 years old.', category: 'plants' },
  { text: 'Young sunflowers turn to follow the Sun across the sky.', category: 'plants' },
  { text: 'Some mushrooms glow in the dark.', category: 'plants' },
  { text: 'Your brain uses about a fifth of all your body’s energy.', category: 'body' },
  { text: 'Fingernails grow faster than toenails.', category: 'body' },
  { text: 'Sound travels about four times faster in water than in air.', category: 'science' },
  { text: 'Diamonds and pencil “lead” are both made of carbon.', category: 'science' },
  { text: 'Axolotls can regrow whole legs.', category: 'animals' },
  { text: 'Seahorse dads are the ones who carry the babies.', category: 'animals' },
  { text: 'Goats have rectangle-shaped pupils.', category: 'animals' },
  { text: 'A shrimp’s heart is in its head.', category: 'animals' },
  { text: 'No two zebras have exactly the same stripes.', category: 'animals' },
  { text: 'Apples float because about a quarter of an apple is air.', category: 'plants' },
  { text: 'Peanuts aren’t nuts: they’re legumes, like peas and beans.', category: 'plants' },
  { text: 'A “googol” is 1 followed by 100 zeros, and a nine-year-old came up with the name.', category: 'words' },
]

export const SOURCE_TITLES: Record<TidbitSource, string> = { quotes: 'Quotes', facts: 'Fun facts', onthisday: 'On this day', trivia: 'Trivia question' }

/** Settings row summary: which sources are on. */
export function tidbitSummary(t: TidbitSettings): string {
  if (!t.sources.length) return 'Off: the Board has no quote card.'
  return (Object.keys(SOURCE_TITLES) as TidbitSource[]).filter(s => t.sources.includes(s)).map(s => SOURCE_TITLES[s]).join(', ')
}

export const FACT_CATEGORY_LABELS: Record<FactCategory, string> = {
  animals: '🐾 Animals', space: '🚀 Space', science: '🔬 Earth & science', body: '🫀 Human body', plants: '🌱 Plants & food', words: '🔤 Words',
}

/** What the card can show. Built-in quotes and facts ship with the app; On this day and trivia
 *  come from the server (GET /api/tidbits), fetched once a day. */
export type Tidbit =
  | { kind: 'quote'; text: string; by: string }
  | { kind: 'fact'; text: string }
  | { kind: 'onthisday'; type: OnThisDayKind; text: string; year: number | null }
  | { kind: 'trivia'; question: string; answer: string; choices: string[]; category: string }

/** The tidbit for a day (its local calendar date) and a 30-minute `slot` of that day (0-47), or
 *  null when no source is on. Takes turns through the sources that have anything, stepping
 *  through each list with a stride coprime to its length, so neighboring slots jump between
 *  topics and every entry comes round before any repeats. Every display computes the same one. */
export function tidbitFor(date: Date, slot: number, settings: TidbitSettings, online: OnlineTidbits | null): Tidbit | null {
  const facts = FACTS.filter(f => settings.factCategories.length === 0 || settings.factCategories.includes(f.category))
  const pools: Tidbit[][] = []
  for (const source of ['quotes', 'facts', 'onthisday', 'trivia'] as const) {
    if (!settings.sources.includes(source)) continue
    const pool: Tidbit[] =
      source === 'quotes' ? QUOTES.map(q => ({ kind: 'quote', ...q }))
      : source === 'facts' ? facts.map(f => ({ kind: 'fact', text: f.text }))
      : source === 'onthisday' ? (online?.onThisDay ?? []).map(o => ({ kind: 'onthisday', type: o.kind, text: o.text, year: o.year }))
      : (online?.trivia ?? []).map(t => ({ kind: 'trivia', ...t }))
    if (pool.length) pools.push(pool)
  }
  // Nothing online yet (first load, or offline) but online sources are on: fall back to the built-in lists.
  if (!pools.length && settings.sources.length) pools.push(QUOTES.map(q => ({ kind: 'quote', ...q })), FACTS.map(f => ({ kind: 'fact', text: f.text })))
  if (!pools.length) return null
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000)
  const n = day * 48 + slot
  const pool = pools[n % pools.length]
  return pool[(Math.floor(n / pools.length) * 37) % pool.length]
}
