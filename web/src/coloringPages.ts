// Paint's built-in coloring pages: simple line art, drawn here as SVG (original drawings, 800×600).
// Every area a kid would fill is closed, so Fill stays inside the lines. Paint draws the page on its
// own layer above the paint, so coloring never covers the outlines.

export interface ColoringPage { id: string; name: string; emoji: string; svg: string }

const W = 800, H = 600
const INK = '#222'
const page = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><g fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`
const p = (d: string) => `<path d="${d}"/>`
const c = (cx: number, cy: number, r: number) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`
const e = (cx: number, cy: number, rx: number, ry: number) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/>`
const r = (x: number, y: number, w: number, h: number, rx = 0) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>`
const dot = (cx: number, cy: number, rr = 6) => `<circle cx="${cx}" cy="${cy}" r="${rr}" fill="${INK}"/>`
/** A five-point star outline. */
const star = (cx: number, cy: number, R: number) => {
  const pts = Array.from({ length: 10 }, (_, k) => {
    const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? R * 0.45 : R
    return `${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`
  })
  return `<polygon points="${pts.join(' ')}"/>`
}
/** A five-petal flower on a stem with a leaf. */
const flower = (x: number, ground: number, h: number, pr = 26) => {
  const cy = ground - h
  const at = (a: number, d: number) => `${(x + d * Math.cos(a)).toFixed(1)} ${(cy + d * Math.sin(a)).toFixed(1)}`
  const petals = Array.from({ length: 5 }, (_, k) => {
    const a = -Math.PI / 2 + k * 2 * Math.PI / 5 // each petal starts and ends on the middle circle
    return p(`M${at(a - 0.5, pr * 0.75)} C${at(a - 0.55, pr * 2.6)} ${at(a + 0.55, pr * 2.6)} ${at(a + 0.5, pr * 0.75)}`)
  }).join('')
  return p(`M${x} ${ground} L${x} ${cy + pr * 0.75}`) + p(`M${x} ${ground - h * 0.35} q40 -30 60 -10 q-30 30 -60 10 Z`) + petals + c(x, cy, pr * 0.75)
}
const cloud = (x: number, y: number) => p(`M${x} ${y} q-10 -40 30 -45 q15 -35 60 -20 q35 -25 60 10 q40 0 30 40 Z`)
const sun = (cx: number, cy: number, R = 50) => c(cx, cy, R)
  + Array.from({ length: 8 }, (_, k) => { const a = k * Math.PI / 4; return p(`M${(cx + (R + 15) * Math.cos(a)).toFixed(1)} ${(cy + (R + 15) * Math.sin(a)).toFixed(1)} L${(cx + (R + 40) * Math.cos(a)).toFixed(1)} ${(cy + (R + 40) * Math.sin(a)).toFixed(1)}`) }).join('')

const CAT = page(
  p('M10 520 L790 520') // floor
  + e(400, 420, 150, 100) // body
  + p('M520 470 q120 20 120 -80 q0 -60 -40 -60 q-20 0 -15 25 q30 5 25 40 q-5 50 -100 45') // tail
  + c(400, 210, 110) // head
  + p('M318 140 L300 40 L380 106') + p('M482 140 L500 40 L420 106') // ears
  + p('M322 125 L314 75 L355 106') + p('M478 125 L486 75 L445 106') // inner ears
  + e(360, 200, 18, 24) + e(440, 200, 18, 24) + dot(364, 204, 8) + dot(444, 204, 8) // eyes
  + p('M388 240 L412 240 L400 254 Z') + p('M400 254 q-12 22 -32 12 M400 254 q12 22 32 12') // nose and mouth
  + p('M350 248 L260 236 M350 260 L262 270 M450 248 L540 236 M450 260 L538 270') // whiskers
  + e(340, 505, 40, 20) + e(460, 505, 40, 20) // paws
  + e(400, 440, 60, 50), // tummy
)

const HOUSE = page(
  sun(110, 100, 45) + cloud(560, 110)
  + p('M10 520 L790 520')
  + r(220, 280, 300, 240) // walls
  + p('M190 290 L370 140 L550 290 Z') // roof
  + r(450, 150, 40, 80) // chimney
  + r(330, 390, 80, 130, 8) + dot(395, 455, 5) // door
  + r(245, 310, 70, 60) + p('M280 310 L280 370 M245 340 L315 340') // window
  + r(425, 310, 70, 60) + p('M460 310 L460 370 M425 340 L495 340')
  + c(370, 230, 26) // round attic window
  + p('M635 520 L635 410 M665 520 L665 410') + p('M635 410 Q570 410 580 360 Q560 300 610 290 Q620 240 670 255 Q720 250 720 300 Q750 330 725 370 Q725 410 665 410 Z') // tree
  + p('M370 520 L340 600 M410 520 L440 600'), // path
)

const GARDEN = page(
  sun(690, 90, 42)
  + p('M10 470 L790 470') // ground
  + flower(130, 470, 230, 30) + flower(300, 470, 300, 34) + flower(480, 470, 200, 28) + flower(660, 470, 270, 32)
  + p('M20 470 q20 -40 40 0 q20 -40 40 0 M560 470 q20 -40 40 0 q20 -40 40 0') // grass
  + p('M60 530 q30 -30 60 0 q-30 30 -60 0 Z M300 545 q30 -30 60 0 q-30 30 -60 0 Z M560 530 q30 -30 60 0 q-30 30 -60 0 Z') // stones
  // a little bee
  + e(470, 110, 34, 24) + p('M462 87 L462 133 M480 88 L480 132') + c(500, 100, 3) + p('M450 92 q-20 -40 10 -40 q20 0 10 40 M478 88 q0 -40 25 -35 q20 10 -10 40'),
)

const ROCKET = page(
  star(110, 110, 34) + star(690, 470, 30) + star(140, 470, 22) + star(560, 90, 20)
  + c(650, 170, 70) + e(650, 170, 120, 26) // planet with a ring
  + p('M330 430 L330 210 Q330 110 400 60 Q470 110 470 210 L470 430 Z') // body
  + p('M336 170 L464 170') // nose cone line
  + c(400, 260, 42) + c(400, 260, 26) // window
  + p('M330 340 L260 450 L330 430 Z') + p('M470 340 L540 450 L470 430 Z') // fins
  + r(355, 430, 90, 30, 6) // nozzle
  + p('M360 460 Q400 590 440 460 Z') + p('M380 465 Q400 540 420 465'), // flame
)

const DINO = page(
  p('M10 520 L790 520')
  + p('M40 480 Q140 470 200 410 Q260 300 360 310 Q440 320 470 230 Q490 150 500 120 Q510 70 560 70 Q620 70 620 115 Q620 150 570 152 Q540 155 535 190 Q520 300 500 380 L500 520 L450 520 L440 440 L300 440 L290 520 L240 520 L235 440 Q150 475 40 480 Z')
  + dot(580, 100, 7) + p('M585 130 q15 6 24 -4') // eye, smile
  + c(330, 370, 22) + c(400, 350, 16) + c(270, 400, 14) + c(400, 405, 16) // spots
  + p('M660 520 L670 330') + p('M670 330 q-60 -40 -110 -10 M670 330 q-40 -60 -20 -110 M670 330 q50 -60 110 -40 M670 330 q70 -10 100 40') // palm tree
  + c(680, 350, 12) + c(658, 352, 12),
)

const CASTLE = page(
  p('M10 540 L790 540')
  + p('M180 540 L180 240 L620 240 L620 540') // wall
  + p('M180 240 L180 210 L220 210 L220 240 M260 240 L260 210 L300 210 L300 240 M340 240 L340 210 L380 210 L380 240 M420 240 L420 210 L460 210 L460 240 M500 240 L500 210 L540 210 L540 240 M580 240 L580 210 L620 210 L620 240') // battlements
  + r(80, 180, 100, 360) + p('M70 180 L130 80 L190 180 Z') + p('M130 80 L130 30 L170 45 L130 60') // left tower, roof, flag
  + r(620, 180, 100, 360) + p('M610 180 L670 80 L730 180 Z') + p('M670 80 L670 30 L710 45 L670 60')
  + p('M330 540 L330 420 Q400 330 470 420 L470 540') + p('M330 460 L470 460 M330 500 L470 500 M376 360 L376 540 M424 360 L424 540') // gate with bars
  + p('M110 270 L110 240 Q130 215 150 240 L150 270 Z') + p('M650 270 L650 240 Q670 215 690 240 L690 270 Z') // tower windows
  + p('M250 330 L250 300 Q270 275 290 300 L290 330 Z') + p('M510 330 L510 300 Q530 275 550 300 L550 330 Z'),
)

const FISH = page(
  p('M150 300 Q260 140 470 180 Q560 200 600 300 Q560 400 470 420 Q260 460 150 300 Z') // body
  + p('M600 300 L730 200 Q700 300 730 400 Z') // tail
  + p('M380 190 Q420 110 490 130 L470 182') + p('M380 412 Q420 470 470 440 L462 418') // fins
  + c(240, 280, 26) + dot(244, 282, 10) + p('M180 330 q20 14 40 4') // eye, mouth
  + p('M320 230 Q300 300 320 370') // gill
  + p('M380 250 q20 20 0 40 M440 250 q20 20 0 40 M380 310 q20 20 0 40 M440 310 q20 20 0 40 M500 280 q20 20 0 40') // scales
  + c(110, 200, 16) + c(80, 150, 11) + c(100, 110, 7) // bubbles
  + p('M60 600 q-30 -60 0 -110 q30 -50 0 -100 M120 600 q30 -50 0 -90 q-25 -40 5 -80 M700 600 q-30 -60 0 -110 q30 -50 0 -90'),
)

const CAR = page(
  sun(680, 100, 40)
  + p('M10 520 L790 520')
  + p('M100 440 L100 370 Q100 340 140 335 L250 320 L330 230 Q345 215 370 215 L540 215 Q565 215 580 235 L650 320 L690 330 Q720 340 720 380 L720 440 Z') // body
  + p('M345 245 L300 320 L440 320 L440 245 Z') + p('M470 245 L470 320 L610 320 L565 245 Z') // windows
  + p('M455 330 L455 430') + r(400, 345, 35, 10, 5) + r(480, 345, 35, 10, 5) // door line, handles
  + c(230, 450, 62) + c(230, 450, 26) + c(590, 450, 62) + c(590, 450, 26) // wheels
  + e(700, 365, 14, 18) + p('M100 400 L130 400'), // headlight, bumper
)

const BUTTERFLY = page(
  p('M390 290 Q250 80 140 130 Q70 180 150 270 Q210 320 390 300 Z') // top wings
  + p('M410 290 Q550 80 660 130 Q730 180 650 270 Q590 320 410 300 Z')
  + p('M390 310 Q230 330 200 420 Q200 490 280 480 Q360 460 392 330 Z') // bottom wings
  + p('M410 310 Q570 330 600 420 Q600 490 520 480 Q440 460 408 330 Z')
  + e(400, 320, 18, 110) + c(400, 195, 26) // body, head
  + p('M390 172 Q360 100 320 90 M410 172 Q440 100 480 90') + c(316, 88, 10) + c(484, 88, 10) // antennae
  + c(230, 190, 38) + c(570, 190, 38) + c(280, 420, 26) + c(520, 420, 26) + c(320, 250, 14) + c(480, 250, 14) // wing spots
  + dot(390, 192, 4) + dot(410, 192, 4),
)

const ICE_CREAM = page(
  p('M290 300 L400 570 L510 300 Z') // cone
  + [345, 400, 455].map(x0 => { const a = (510 - x0) / 220, b = (x0 - 290) / 220; return p(`M${x0} 300 L${x0 + 110 * a} ${300 + 270 * a} M${x0} 300 L${x0 - 110 * b} ${300 + 270 * b}`) }).join('') // waffle
  + p('M270 300 Q250 240 300 220 Q300 150 380 150 Q430 140 460 180 Q540 170 540 240 Q560 280 530 300 Z') // bottom scoop
  + p('M310 170 Q300 90 380 80 Q450 70 470 130 Q480 160 460 180') // top scoop
  + c(400, 52, 22) + p('M405 32 q10 -25 35 -25') // cherry
  + p('M300 260 q10 15 25 0 M360 270 q10 15 25 0 M430 265 q10 15 25 0 M490 255 q10 15 25 0') // drips
  + star(130, 140, 30) + star(670, 140, 30) + star(160, 470, 22) + star(640, 470, 22),
)

export const COLORING_PAGES: ColoringPage[] = [
  { id: 'cat', name: 'Cat', emoji: '🐱', svg: CAT },
  { id: 'house', name: 'House', emoji: '🏠', svg: HOUSE },
  { id: 'garden', name: 'Garden', emoji: '🌷', svg: GARDEN },
  { id: 'rocket', name: 'Rocket', emoji: '🚀', svg: ROCKET },
  { id: 'dinosaur', name: 'Dinosaur', emoji: '🦕', svg: DINO },
  { id: 'castle', name: 'Castle', emoji: '🏰', svg: CASTLE },
  { id: 'fish', name: 'Fish', emoji: '🐟', svg: FISH },
  { id: 'car', name: 'Car', emoji: '🚗', svg: CAR },
  { id: 'butterfly', name: 'Butterfly', emoji: '🦋', svg: BUTTERFLY },
  { id: 'ice-cream', name: 'Ice cream', emoji: '🍦', svg: ICE_CREAM },
]
export const pageUrl = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`
