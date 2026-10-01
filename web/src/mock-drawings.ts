// The demo's Paint drawings: crayon pictures on paper, drawn the way a kid would (thick wobbly
// strokes, scribbled fills, one-stroke stars). A displacement filter makes every line wobble and a
// grain mask gives the crayon texture, so the shapes underneath can stay simple.

type Drawing = { id: string; caption: string; memberId: string; daysAgo: number; url: string }

const W = 400, H = 300
const line = (d: string, color: string, width = 7) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`
/** A back-and-forth crayon scribble filling a box, the way kids color in. */
const scribble = (x0: number, y0: number, x1: number, y1: number, color: string, gap = 9, width = 8) => {
  let d = `M${x0} ${y0}`
  for (let y = y0, i = 0; y <= y1; y += gap, i++) d += ` L${i % 2 ? x0 : x1} ${y + gap / 2}`
  return line(d, color, width)
}
/** A one-stroke five-point star. */
const star = (cx: number, cy: number, r: number, color: string) => {
  const p = [0, 2, 4, 1, 3, 0].map(k => { const a = -Math.PI / 2 + k * 2 * Math.PI / 5; return `${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}` })
  return line(`M${p.join(' L')}`, color, 4)
}
const circle = (cx: number, cy: number, r: number, fill: string, stroke = fill, width = 5) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"/>`
const flower = (x: number, ground: number, h: number, petal: string) => {
  const cy = ground - h
  const petals = [0, 1, 2, 3, 4].map(k => { const a = k * 2 * Math.PI / 5; return circle(+(x + 13 * Math.cos(a)).toFixed(1), +(cy + 13 * Math.sin(a)).toFixed(1), 9, petal, petal, 3) }).join('')
  return line(`M${x} ${ground} Q${x - 6} ${ground - h / 2} ${x} ${cy}`, '#3fa34d', 6) + line(`M${x - 2} ${ground - h / 3} q-14 -10 -20 -2 q8 8 20 2`, '#3fa34d', 5) + petals + circle(x, cy, 7, '#ffcf3f', '#e8a400', 3)
}
/** A stick person: big round head, smile, line body, arms out. */
const person = (x: number, ground: number, h: number, color: string, hair: string, dress = false) => {
  const head = h * 0.22, neck = ground - h + head * 2, hip = ground - h * 0.38
  return circle(x, ground - h + head, head, '#ffe0c2', '#c97b4a', 3)
    + line(`M${x - head} ${ground - h + head * 0.7} q${head} -${head * 1.1} ${head * 2} 0`, hair, 6)
    + line(`M${x - head * 0.45} ${ground - h + head * 1.15} q${head * 0.45} ${head * 0.45} ${head * 0.9} 0`, '#7a2e1c', 3)
    + circle(x - head * 0.38, ground - h + head * 0.85, 2, '#333', '#333', 1) + circle(x + head * 0.38, ground - h + head * 0.85, 2, '#333', '#333', 1)
    + (dress ? `<path d="M${x} ${neck} L${x - h * 0.2} ${hip} L${x + h * 0.2} ${hip} Z" fill="${color}" stroke="${color}" stroke-width="6" stroke-linejoin="round"/>` : line(`M${x} ${neck} L${x} ${hip}`, color, 8))
    + line(`M${x - h * 0.28} ${neck + h * 0.02} L${x} ${neck + h * 0.12} L${x + h * 0.28} ${neck + h * 0.02}`, color, 6)
    + line(`M${x - h * 0.14} ${ground} L${x} ${hip} L${x + h * 0.14} ${ground}`, '#3a4a8c', 6)
}
const sun = (cx: number, cy: number) => circle(cx, cy, 26, '#ffd23f', '#ff9f1c', 6)
  + line(Array.from({ length: 8 }, (_, k) => { const a = k * Math.PI / 4; return `M${(cx + 36 * Math.cos(a)).toFixed(1)} ${(cy + 36 * Math.sin(a)).toFixed(1)} L${(cx + 52 * Math.cos(a)).toFixed(1)} ${(cy + 52 * Math.sin(a)).toFixed(1)}` }).join(' '), '#ff9f1c', 6)

const svg = (seed: number, body: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">`
  + '<filter id="k" x="-5%" y="-5%" width="110%" height="110%">'
  + `<feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="${seed}" result="w"/>`
  + '<feDisplacementMap in="SourceGraphic" in2="w" scale="9" xChannelSelector="R" yChannelSelector="G" result="d"/>'
  + '<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" seed="7" result="g"/>'
  + '<feColorMatrix in="g" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -2.4 2.1" result="m"/>'
  + '<feComposite in="d" in2="m" operator="in"/></filter>'
  + `<rect width="${W}" height="${H}" fill="#fffdf6"/><g filter="url(#k)">${body}</g></svg>`)}`

const NIGHT_GARDEN = svg(3,
  scribble(14, 10, 386, 196, '#1f2f73', 10, 11)
  + circle(318, 62, 32, '#fff3a8', '#f2d43d', 6) + circle(334, 52, 28, '#1f2f73', '#1f2f73', 2)
  + star(60, 46, 14, '#ffe35a') + star(140, 30, 10, '#ffffff') + star(205, 70, 13, '#ffe35a') + star(258, 28, 9, '#ffffff') + star(100, 110, 9, '#ffe35a') + star(240, 130, 10, '#ffffff')
  + scribble(10, 206, 390, 290, '#2f8f46', 8, 9)
  + line('M10 206 l14 -16 l10 16 l14 -18 l10 18 l14 -14 l10 14 l14 -16 l10 16 l14 -18 l10 18 l14 -14 l10 14 l14 -16 l10 16 l14 -18 l10 18 l14 -14 l10 14 l14 -16 l10 16 l14 -18 l10 18 l14 -14 l10 14 l14 -16 l10 16 l14 -18 l10 18 l14 -14 l10 14 l14 -16 l10 16 l14 -14', '#3fa34d', 5)
  + flower(70, 250, 70, '#ff6fa8') + flower(150, 256, 92, '#b06cff') + flower(232, 250, 64, '#ff8b3d') + flower(318, 258, 86, '#ff6fa8')
  + circle(196, 120, 4, '#d6ff5a', '#d6ff5a', 2) + circle(120, 160, 4, '#d6ff5a', '#d6ff5a', 2) + circle(290, 168, 4, '#d6ff5a', '#d6ff5a', 2))

const ROCKET = svg(5,
  scribble(14, 10, 386, 290, '#14204a', 11, 11)
  + circle(318, 72, 44, '#e9e9e9', '#bdbdbd', 6) + circle(304, 60, 8, '#c8c8c8', '#a9a9a9', 3) + circle(332, 92, 6, '#c8c8c8', '#a9a9a9', 3)
  + star(60, 50, 12, '#ffe35a') + star(180, 34, 9, '#ffffff') + star(60, 240, 10, '#ffffff') + star(250, 250, 12, '#ffe35a')
  + '<g transform="rotate(40 160 170)">'
  + `<path d="M138 110 L182 110 L182 230 L138 230 Z" fill="#f4f4f4" stroke="#9aa3ad" stroke-width="6" stroke-linejoin="round"/>`
  + `<path d="M134 112 L160 62 L186 112 Z" fill="#ef476f" stroke="#c22a52" stroke-width="6" stroke-linejoin="round"/>`
  + circle(160, 150, 14, '#7fd3ff', '#118ab2', 6)
  + `<path d="M138 200 L112 240 L138 230 Z M182 200 L208 240 L182 230 Z" fill="#ef476f" stroke="#c22a52" stroke-width="6" stroke-linejoin="round"/>`
  + `<path d="M144 236 Q160 300 176 236 Z" fill="#ffd23f" stroke="#ff8a1c" stroke-width="6" stroke-linejoin="round"/>`
  + '</g>')

const HOUSE = svg(9,
  sun(64, 62)
  + line('M250 40 q14 -18 28 0 q14 -18 28 0 q14 -16 26 2 q-10 16 -26 6 q-14 14 -28 0 q-16 12 -28 -8', '#8ab8e8', 6)
  + scribble(8, 244, 392, 292, '#4caf50', 8, 9)
  + `<path d="M120 140 L220 140 L220 244 L120 244 Z" fill="#ffb347" stroke="#d9771c" stroke-width="6" stroke-linejoin="round"/>`
  + `<path d="M106 144 L170 84 L234 144 Z" fill="#d94b4b" stroke="#a52a2a" stroke-width="6" stroke-linejoin="round"/>`
  + line('M196 104 L196 78 L210 78 L210 118', '#7a4a2a', 6) + line('M203 70 q-6 -12 4 -20 q10 -8 2 -22', '#aaaaaa', 4)
  + `<path d="M156 244 L156 196 L184 196 L184 244" fill="#8b5a2b" stroke="#5d3a17" stroke-width="5"/>` + circle(178, 222, 3, '#ffd23f', '#ffd23f', 1)
  + `<path d="M132 158 h28 v24 h-28 Z M146 158 v24 M132 170 h28" fill="#bfe6ff" stroke="#3a7bd5" stroke-width="5"/>`
  + `<path d="M190 158 h22 v22 h-22 Z" fill="#bfe6ff" stroke="#3a7bd5" stroke-width="5"/>`
  + person(262, 250, 96, '#3a7bd5', '#5b3a1e') + person(306, 250, 90, '#e64980', '#e0a82e', true) + person(344, 250, 62, '#8e44ad', '#5b3a1e', true) + person(374, 250, 52, '#2f9e44', '#e0a82e')
  + line('M40 250 L40 200 M24 214 q16 -26 32 0 M28 226 q12 -16 24 0', '#3fa34d', 6) + circle(40, 190, 10, '#ff6fa8', '#d6336c', 4))

const DINO = svg(13,
  sun(340, 54)
  + line('M30 74 q14 -18 28 0 q14 -18 28 0 q12 -14 24 2 q-10 14 -24 6 q-14 12 -28 0 q-16 10 -28 -8', '#8ab8e8', 6)
  + scribble(8, 248, 392, 292, '#a0703a', 9, 9)
  + `<path d="M24 160 Q66 198 112 184 Q122 150 160 146 Q206 142 232 120 Q244 74 276 72 Q312 72 314 98 Q314 118 290 120 L262 124 Q262 176 246 214 L250 252 L232 252 L226 226 L170 226 L166 252 L148 252 L144 222 Q100 222 24 160 Z" fill="#6cc24a" stroke="#2f7d1f" stroke-width="7" stroke-linejoin="round"/>`
  + line('M122 160 l8 -22 l12 18 M146 148 l12 -26 l12 24 M174 144 l12 -28 l12 26 M206 132 l12 -26 l10 20 M232 112 l8 -20 l12 14', '#ff8b3d', 7)
  + circle(290, 92, 6, '#ffffff', '#222', 4) + circle(292, 93, 2, '#222', '#222', 1)
  + line('M286 110 q12 6 24 -2', '#222', 4) + line('M298 112 l4 8 l4 -8', '#ffffff', 3)
  + line('M248 156 q16 6 22 -6 M250 168 q16 6 22 -4', '#2f7d1f', 6)
  + circle(170, 190, 9, '#3f9a2b', '#3f9a2b', 2) + circle(200, 200, 7, '#3f9a2b', '#3f9a2b', 2) + circle(140, 196, 6, '#3f9a2b', '#3f9a2b', 2)
  // LEO, the way a five-year-old signs it
  + line('M22 100 L22 136 L42 136 M54 100 L54 136 M54 100 L72 100 M54 118 L68 118 M54 136 L74 136', '#e64980', 6) + circle(96, 118, 16, 'none', '#e64980', 6))

export const DEMO_DRAWINGS: Drawing[] = [
  { id: 'drawing-garden', caption: 'Our garden at night', memberId: 'm3', daysAgo: 0, url: NIGHT_GARDEN },
  { id: 'drawing-rocket', caption: 'Rocket to the moon', memberId: 'm4', daysAgo: 5, url: ROCKET },
  { id: 'drawing-house', caption: 'Our house and our family', memberId: 'm3', daysAgo: 8, url: HOUSE },
  { id: 'drawing-dino', caption: 'My dinosaur Stompy', memberId: 'm4', daysAgo: 12, url: DINO },
]
export const drawingPhoto = (id: string) => { const d = DEMO_DRAWINGS.find(x => x.id === id)!; return { id: d.id, url: d.url } }
