// The demo's Paint drawings: real Paint pictures, drawn with Paint's own brushes, Fill, stamps and a
// coloring page from scripted strokes (scripts/demo-drawings.ts; `node scripts/demo-drawings.mjs`
// remakes them). They live in web/demo-drawings/, which only the demo build copies in (build:demo),
// so the real build doesn't carry them; the dev server serves them from there too.

type Drawing = { id: string; caption: string; memberId: string; daysAgo: number; url: string }

const pic = (name: string) => `demo-drawings/${name}.webp` // relative to the page: the demo is served from its root

export const DEMO_DRAWINGS: Drawing[] = [
  { id: 'drawing-garden', caption: 'Our garden at night', memberId: 'm3', daysAgo: 0, url: pic('garden') },
  { id: 'drawing-rocket', caption: 'Rocket to the moon', memberId: 'm4', daysAgo: 5, url: pic('rocket') },
  { id: 'drawing-house', caption: 'Our house and our family', memberId: 'm3', daysAgo: 8, url: pic('house') },
  { id: 'drawing-dino', caption: 'My dinosaur Stompy', memberId: 'm4', daysAgo: 12, url: pic('dino') },
]
export const drawingPhoto = (id: string) => { const d = DEMO_DRAWINGS.find(x => x.id === id)!; return { id: d.id, url: d.url } }
