// Paint's built-in coloring pages: simple, bold line art, drawn here as SVG (original drawings,
// 800×600). Every page has a frame and every area a kid would fill is closed, so Fill stays inside
// the lines (test/coloringPages.test.ts fills each one and checks). Paint draws the page on its own
// layer above the paint, so coloring never covers the outlines.
//
// Drawing rules that keep areas closed: lines that divide an area start and end on its outline (or
// cross it), shapes don't just touch, and nothing is filled white (a white fill would be a wall).

export type PageCategory = 'Animals' | 'Things that go' | 'Places and nature' | 'Treats' | 'Seasons'
export interface ColoringPage { id: string; name: string; emoji: string; category: PageCategory; svg: string }

const W = 800, H = 600
const INK = '#222'
const FRAME = `<rect x="12" y="12" width="776" height="576" rx="28"/>`
const page = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><g fill="none" stroke="${INK}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">${FRAME}${body}</g></svg>`
const p = (d: string) => `<path d="${d}"/>`
const c = (cx: number, cy: number, r: number) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`
const e = (cx: number, cy: number, rx: number, ry: number) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/>`
const r = (x: number, y: number, w: number, h: number, rx = 0) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>`
const dot = (cx: number, cy: number, rr = 6) => `<circle cx="${cx}" cy="${cy}" r="${rr}" fill="${INK}" stroke="none"/>`
/** A line across the whole page at height `y`, ends on the frame. */
const ground = (y: number) => p(`M12 ${y} L788 ${y}`)
const f1 = (n: number) => n.toFixed(1)
/** A five-point star outline. */
const star = (cx: number, cy: number, R: number) => {
  const pts = Array.from({ length: 10 }, (_, k) => {
    const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? R * 0.45 : R
    return `${f1(cx + rr * Math.cos(a))},${f1(cy + rr * Math.sin(a))}`
  })
  return `<polygon points="${pts.join(' ')}"/>`
}
/** A heart, `s` wide. */
const heart = (x: number, y: number, s: number) => {
  const k = s / 100
  return p(`M${x} ${y + 30 * k} C${x - 10 * k} ${y - 5 * k} ${x - 50 * k} ${y - 5 * k} ${x - 50 * k} ${y + 25 * k} C${x - 50 * k} ${y + 55 * k} ${x - 15 * k} ${y + 70 * k} ${x} ${y + 90 * k} C${x + 15 * k} ${y + 70 * k} ${x + 50 * k} ${y + 55 * k} ${x + 50 * k} ${y + 25 * k} C${x + 50 * k} ${y - 5 * k} ${x + 10 * k} ${y - 5 * k} ${x} ${y + 30 * k} Z`)
}
/** A five-petal flower on a stem with a leaf; the stem ends on `ground`. */
const flower = (x: number, ground: number, h: number, pr = 26) => {
  const cy = ground - h
  const at = (a: number, d: number) => `${f1(x + d * Math.cos(a))} ${f1(cy + d * Math.sin(a))}`
  const petals = Array.from({ length: 5 }, (_, k) => {
    const a = -Math.PI / 2 + k * 2 * Math.PI / 5 // each petal starts and ends on the middle circle
    return p(`M${at(a - 0.5, pr * 0.75)} C${at(a - 0.55, pr * 2.6)} ${at(a + 0.55, pr * 2.6)} ${at(a + 0.5, pr * 0.75)}`)
  }).join('')
  return p(`M${x} ${ground} L${x} ${cy + pr * 0.75}`) + p(`M${x} ${ground - h * 0.35} q40 -30 60 -10 q-30 30 -60 10 Z`) + petals + c(x, cy, pr * 0.75)
}
/** A falling leaf, tilted `deg`: two halves either side of its middle vein, and a stalk. */
const leaf = (x: number, y: number, deg: number) =>
  `<g transform="rotate(${deg} ${x} ${y})">${p(`M${x - 40} ${y} Q${x} ${y - 30} ${x + 40} ${y} Q${x} ${y + 30} ${x - 40} ${y} Z M${x - 40} ${y} L${x + 40} ${y} M${x - 40} ${y} l-16 6`)}</g>`
const cloud = (x: number, y: number) => p(`M${x} ${y} q-10 -40 30 -45 q15 -35 60 -20 q35 -25 60 10 q40 0 30 40 Z`)
const sun = (cx: number, cy: number, R = 50) => c(cx, cy, R)
  + Array.from({ length: 8 }, (_, k) => { const a = k * Math.PI / 4; return p(`M${f1(cx + (R + 14) * Math.cos(a))} ${f1(cy + (R + 14) * Math.sin(a))} L${f1(cx + (R + 36) * Math.cos(a))} ${f1(cy + (R + 36) * Math.sin(a))}`) }).join('')

// ---------- Animals ----------

const CAT = page(
  ground(520)
  + p('M326 304 Q250 400 268 520 L532 520 Q550 400 474 304') // body, from the head down to the floor
  + c(400, 230, 105) // head
  + p('M318 170 L300 78 L370 132') + p('M482 170 L500 78 L430 132') // ears
  + e(362, 218, 17, 23) + e(438, 218, 17, 23) + dot(366, 222, 8) + dot(442, 222, 8) // eyes
  + p('M386 258 L414 258 L400 274 Z') + p('M400 274 q-10 18 -28 10 M400 274 q10 18 28 10') // nose, mouth
  + p('M346 262 L262 250 M346 276 L264 290 M454 262 L538 250 M454 276 L536 290') // whiskers
  + p('M535 484 C600 470 625 440 615 405 C610 390 598 386 600 372 C606 352 648 362 652 400 C660 470 620 512 534 503') // tail
  + e(352, 506, 34, 14) + e(448, 506, 34, 14) // paws
  + c(160, 472, 48) + p('M120 446 Q165 470 205 440 M118 486 Q170 506 222 466 M150 425 Q140 470 165 519') // ball of yarn
  + p('M208 470 Q240 470 250 420') // its loose end
  + star(660, 110, 34) + star(140, 110, 26),
)

const DOG = page(
  ground(520)
  + p('M340 307 Q270 410 285 520 L515 520 Q530 410 460 307') // body
  + e(400, 230, 105, 95) // head
  + p('M318 170 C266 166 246 262 268 322 C284 350 318 334 318 290') + p('M482 170 C534 166 554 262 532 322 C516 350 482 334 482 290') // floppy ears
  + e(360, 210, 16, 20) + e(440, 210, 16, 20) + dot(363, 214, 8) + dot(443, 214, 8) // eyes
  + e(400, 272, 44, 32) // snout
  + `<ellipse cx="400" cy="256" rx="15" ry="10" fill="${INK}" stroke="none"/>` + p('M400 262 L400 282 M400 282 q-14 12 -26 2 M400 282 q14 12 26 2') // nose, mouth
  + p('M355 520 L355 440 M445 520 L445 440') // front legs
  + p('M517 476 Q580 456 590 396 Q610 404 598 436 Q580 486 517 498') // tail
  + e(420, 175, 30, 18) // a patch over one eye
  + p('M120 520 L134 466 L250 466 L264 520') + e(192, 466, 58, 12) // bowl
  + c(650, 480, 40) + p('M610 480 Q650 500 690 480') // ball
  + heart(660, 90, 80) + star(140, 120, 34),
)

const DINO = page(
  ground(520)
  + p('M60 470 Q160 460 220 400 Q280 300 370 310 Q440 320 470 230 Q490 150 500 120 Q512 72 560 72 Q622 72 622 116 Q622 152 572 154 Q542 158 536 190 Q522 300 502 380 L502 520 L452 520 L442 444 L304 444 L294 520 L244 520 L238 444 Q160 478 60 470 Z') // body
  + dot(582, 102, 8) + p('M586 132 q16 6 26 -4') // eye, smile
  + c(330, 372, 22) + c(400, 352, 16) + c(272, 404, 14) + c(404, 408, 16) // spots
  + p('M340 312 L360 270 L382 312 M400 300 L428 256 L446 286 M452 262 L484 232 L475 270') // back plates, ending on the back
  + p('M650 520 L660 330') + p('M660 330 q-60 -40 -110 -10 q50 -10 110 10 M660 330 q-40 -60 -20 -110 q10 60 20 110 M660 330 q40 -50 90 -36 q-50 0 -90 36 M660 330 q60 -10 86 36 q-34 -28 -86 -36') // palm tree
  + sun(130, 110, 44) + cloud(320, 120),
)

const UNICORN = page(
  // Head and neck, facing left.
  p('M330 560 C320 470 300 420 250 384 C200 364 160 344 170 302 C175 272 200 256 230 242 C270 204 300 172 330 160 C360 150 400 150 430 165 L448 98 L472 176 C520 210 550 300 560 420 C565 480 570 520 575 560 Z')
  + p('M330 160 L312 52 L359 154') + p('M324 132 L346 122 M318 102 L333 94') // horn and its stripes
  + p('M440 160 L452 122 L460 170') // inside the ear
  + p('M282 236 q16 14 32 0 M286 240 l-6 10 M298 244 l0 11 M310 240 l6 10') // closed eye and lashes
  + dot(196, 292, 6) + p('M186 326 q16 8 32 0') // nostril, smile
  // Mane: wavy locks down the back of the neck, each one closed against the neck.
  + p('M472 176 C520 130 590 160 576 216 C626 236 636 300 598 330 C642 362 640 420 602 450 C642 484 640 540 602 560 L575 560')
  + p('M576 216 L504 212 M598 330 L549 336 M602 450 L563 446')
  + p('M396 156 C380 120 410 100 436 116') // forelock
  + star(150, 120, 40) + star(690, 110, 30) + star(120, 470, 28) + heart(700, 420, 70),
)

const FISH = page(
  p('M12 520 Q120 500 220 520 Q330 540 440 518 Q560 496 660 520 Q730 534 788 520') // sand
  + p('M150 300 Q260 140 470 180 Q560 200 600 300 Q560 400 470 420 Q260 460 150 300 Z') // body
  + p('M596 290 L730 196 Q700 300 730 404 L596 310') // tail
  + p('M380 189 Q420 110 490 130 L476 186') + p('M380 413 Q420 470 470 440 L462 418') // fins
  + c(240, 280, 26) + dot(244, 282, 10) + p('M182 330 q20 14 40 4') // eye, mouth
  + p('M318 180 Q290 300 318 420') // gill, from the top to the bottom of the body
  + p('M380 250 q20 20 0 40 M440 250 q20 20 0 40 M380 320 q20 20 0 40 M440 320 q20 20 0 40 M500 285 q20 20 0 40') // scales
  + c(110, 200, 18) + c(84, 146, 12) + c(108, 100, 8) // bubbles
  + p('M70 514 C40 470 100 440 70 380 C50 340 90 300 80 260 C120 300 100 340 116 380 C140 440 96 470 116 506') // seaweed
  + p('M690 524 C670 480 720 466 706 430 C738 450 730 486 740 527')
  + star(560, 552, 24) + star(250, 556, 18), // starfish on the sand
)

const BUTTERFLY = page(
  p('M390 290 Q250 80 140 130 Q70 180 150 270 Q210 320 390 300 Z') // top wings
  + p('M410 290 Q550 80 660 130 Q730 180 650 270 Q590 320 410 300 Z')
  + p('M390 310 Q230 330 200 420 Q200 490 280 480 Q360 460 392 330 Z') // bottom wings
  + p('M410 310 Q570 330 600 420 Q600 490 520 480 Q440 460 408 330 Z')
  + e(400, 320, 20, 112) + c(400, 192, 28) // body, head
  + p('M388 168 Q360 100 320 90 M412 168 Q440 100 480 90') + c(314, 88, 11) + c(486, 88, 11) // antennae
  + c(232, 190, 38) + c(568, 190, 38) + c(282, 420, 26) + c(518, 420, 26) + c(322, 252, 16) + c(478, 252, 16) // wing spots
  + dot(390, 188, 5) + dot(410, 188, 5) + p('M392 204 q8 8 16 0')
  + flower(110, 588, 70, 22) + flower(690, 588, 90, 24),
)

// ---------- Things that go ----------

const CAR = page(
  sun(680, 110, 40) + cloud(150, 120)
  + ground(530)
  + p('M100 446 L100 372 Q100 340 140 335 L250 320 L330 230 Q345 215 370 215 L540 215 Q565 215 580 235 L650 320 L690 330 Q720 340 720 380 L720 446 Z') // body
  + p('M345 245 L300 320 L440 320 L440 245 Z') + p('M470 245 L470 320 L610 320 L565 245 Z') // windows
  + p('M455 215 L455 446') + r(400, 345, 35, 12, 6) + r(480, 345, 35, 12, 6) // door line, handles
  + c(230, 452, 62) + c(230, 452, 26) + c(590, 452, 62) + c(590, 452, 26) // wheels
  + e(698, 368, 14, 18) + p('M100 400 L132 400'), // headlight, bumper
)

const TRAIN = page(
  p('M12 506 L788 506 M12 530 L788 530') // rails
  + [60, 140, 220, 300, 380, 460, 540, 620, 700].map(x => p(`M${x} 506 L${x} 530`)).join('') // sleepers
  // Engine: cab, roof, boiler, chimney, cow catcher.
  + r(420, 250, 130, 190) + r(445, 280, 80, 70, 10) + r(404, 226, 162, 24, 8)
  + r(550, 320, 160, 120) + c(690, 360, 14)
  + p('M590 320 L580 250 L640 250 L630 320') + p('M574 250 L646 250 L646 232 L574 232 Z')
  + p('M710 396 L756 440 L710 440')
  + r(408, 440, 330, 30)
  + c(470, 470, 36) + c(610, 470, 30) + c(690, 470, 30) + dot(470, 470, 8) + dot(610, 470, 7) + dot(690, 470, 7)
  // A car behind it.
  + r(130, 300, 250, 140, 12) + r(155, 326, 60, 50, 8) + r(225, 326, 60, 50, 8) + r(295, 326, 60, 50, 8) + r(118, 276, 274, 24, 8)
  + r(122, 440, 270, 30) + p('M392 455 L408 455')
  + c(185, 470, 30) + c(330, 470, 30) + dot(185, 470, 7) + dot(330, 470, 7)
  + c(625, 200, 18) + c(662, 160, 24) + c(712, 112, 32) // smoke
  + sun(110, 110, 42),
)

const ROCKET = page(
  star(110, 110, 34) + star(690, 470, 30) + star(140, 470, 22) + star(560, 90, 20) + star(250, 300, 18)
  + c(650, 190, 70) + p('M530 205 Q650 250 770 175 Q650 210 530 205 Z') // planet with a ring
  + c(150, 290, 34) + c(140, 280, 8) + c(162, 304, 6) // a little moon with craters
  + p('M330 430 L330 210 Q330 110 400 60 Q470 110 470 210 L470 430 Z') // body
  + p('M336 170 L464 170') // nose cone line
  + c(400, 260, 42) + c(400, 260, 26) // window
  + p('M330 340 L260 450 L330 430 M470 340 L540 450 L470 430') // fins
  + r(355, 430, 90, 30, 6) // nozzle
  + p('M360 460 Q400 590 440 460') + p('M380 460 Q400 530 420 460'), // flame
)

// ---------- Places and nature ----------

const HOUSE = page(
  sun(115, 112, 45) + cloud(560, 110)
  + ground(520)
  + r(220, 280, 300, 240) // walls
  + p('M190 290 L370 140 L550 290 Z') // roof
  + p('M450 207 L450 150 L490 150 L490 240') // chimney, standing on the roof
  + c(470, 112, 14) + c(492, 80, 18) // smoke
  + r(330, 390, 80, 130, 8) + dot(395, 455, 6) // door
  + r(245, 310, 70, 60) + p('M280 310 L280 370 M245 340 L315 340') // windows
  + r(425, 310, 70, 60) + p('M460 310 L460 370 M425 340 L495 340')
  + c(370, 230, 26) // round attic window
  + p('M635 520 L635 410 M665 520 L665 410') + p('M635 410 Q570 410 580 360 Q560 300 610 290 Q620 240 670 255 Q720 250 720 300 Q750 330 725 370 Q725 410 665 410 Z') // tree
  + e(370, 548, 30, 10) + e(350, 572, 26, 8), // stepping stones
)

const CASTLE = page(
  ground(540)
  + p('M180 540 L180 240 L620 240 L620 540') // wall
  + p('M180 240 L180 210 L220 210 L220 240 M260 240 L260 210 L300 210 L300 240 M340 240 L340 210 L380 210 L380 240 M420 240 L420 210 L460 210 L460 240 M500 240 L500 210 L540 210 L540 240 M580 240 L580 210 L620 210 L620 240') // battlements
  + r(80, 180, 100, 360) + p('M70 180 L130 80 L190 180 Z') + p('M130 80 L130 30 L170 45 L130 60') // left tower, roof, flag
  + r(620, 180, 100, 360) + p('M610 180 L670 80 L730 180 Z') + p('M670 80 L670 30 L710 45 L670 60')
  + p('M330 540 L330 420 Q400 330 470 420 L470 540') + p('M330 460 L470 460 M330 500 L470 500 M376 366 L376 540 M424 366 L424 540') // gate with bars
  + p('M110 270 L110 240 Q130 215 150 240 L150 270 Z') + p('M650 270 L650 240 Q670 215 690 240 L690 270 Z') // tower windows
  + p('M250 330 L250 300 Q270 275 290 300 L290 330 Z') + p('M510 330 L510 300 Q530 275 550 300 L550 330 Z')
  + p('M180 356 L620 356 M180 440 L330 440 M470 440 L620 440') // stone rows
  + cloud(330, 110) + star(560, 80, 22),
)

const GARDEN = page(
  p('M12 400 L788 400') // the grass starts here
  + [330, 290, 250, 210].map(R => p(`M${400 - R} 400 A${R} ${R} 0 0 1 ${400 + R} 400`)).join('') // rainbow
  + sun(400, 330, 40).replace(/<path[^>]*>/g, '') // the sun peeking up inside it (no rays, they'd cut the rainbow)
  + cloud(60, 110) + p('M690 120 q20 -30 40 0 M730 120 q20 -30 40 0') // cloud, birds
  + flower(110, 560, 92, 22) + flower(270, 560, 80, 20) + flower(420, 560, 96, 22) + flower(570, 560, 84, 20) + flower(710, 560, 92, 22)
  + p('M12 560 L788 560'), // flower bed
)

// ---------- Treats ----------

const CUPCAKE = page(
  p('M240 365 C200 340 220 280 270 285 C270 230 330 210 360 240 C380 190 450 190 465 240 C500 215 560 240 545 290 C590 300 590 360 560 365 Z') // frosting
  + p('M262 365 L300 540 L500 540 L538 365') // paper cup
  + p('M316 365 L340 540 M372 365 L380 540 M428 365 L420 540 M484 365 L460 540') // its pleats
  + p('M232 300 C300 320 340 290 400 305 C460 320 500 290 567 301') // a swirl in the frosting
  + c(400, 172, 26) + p('M405 147 q8 -30 30 -35') // cherry
  + p('M290 262 l14 6 M336 246 l10 10 M440 236 l-12 8 M496 262 l12 -8 M300 336 l12 4 M360 340 l8 -10 M440 340 l12 6 M500 334 l10 -8') // sprinkles
  + star(130, 140, 36) + star(680, 470, 30) + heart(670, 110, 80) + heart(130, 420, 70),
)

const ICE_CREAM = page(
  p('M290 300 L400 570 L510 300') // cone
  + [345, 400, 455].map(x0 => { const a = (510 - x0) / 220, b = (x0 - 290) / 220; return p(`M${x0} 300 L${f1(x0 + 110 * a)} ${f1(300 + 270 * a)} M${x0} 300 L${f1(x0 - 110 * b)} ${f1(300 + 270 * b)}`) }).join('') // waffle
  + p('M270 300 Q250 240 300 220 Q300 150 380 150 Q430 140 460 180 Q540 170 540 240 Q560 280 530 300 Z') // bottom scoop
  + p('M308 178 Q300 90 380 80 Q450 70 470 130 Q480 160 458 182') // top scoop
  + c(400, 52, 22) + p('M405 32 q10 -25 35 -25') // cherry
  + p('M300 270 q10 15 25 0 M360 280 q10 15 25 0 M430 275 q10 15 25 0 M480 265 q10 15 25 0') // drips
  + star(130, 140, 30) + star(670, 140, 30) + star(160, 470, 22) + star(640, 470, 22) + heart(660, 300, 60) + heart(140, 290, 60),
)

// ---------- Seasons ----------

const PUMPKIN = page(
  ground(540)
  + p('M400 230 C250 200 150 280 160 390 C170 500 280 540 400 530 C520 540 630 500 640 390 C650 280 550 200 400 230 Z') // pumpkin
  + p('M280 231 C220 300 220 460 297 525 M520 231 C580 300 580 460 503 525') // ribs
  + p('M357 225 C325 300 325 460 364 531 M443 225 C475 300 475 460 436 531')
  + p('M380 229 L372 160 Q395 150 420 162 L418 230') // stem
  + p('M419 186 C450 150 500 150 520 175 C490 200 450 205 419 186 Z') // leaf
  + p('M375 190 C340 170 330 140 350 130 C370 122 375 145 360 150') // vine
  + leaf(140, 140, -25) + leaf(680, 110, 20) + leaf(700, 330, -40) + leaf(110, 380, 30), // falling leaves
)

const SNOWMAN = page(
  ground(520)
  + p('M434.3 326 A100 100 0 1 1 365.7 326') // bottom ball
  + p('M420.1 198 A70 70 0 1 1 379.9 198') // middle ball, in front of the bottom one
  + p('M433.2 110 A52 52 0 1 1 366.8 110') // head
  + r(335, 96, 130, 14, 7) + p('M360 96 L362 30 L438 30 L440 96') + p('M361 74 L439 74') // hat
  + dot(382, 138, 7) + dot(418, 138, 7) + p('M398 154 L440 168 L398 170 Z') // eyes, carrot
  + dot(378, 180, 4) + dot(390, 187, 4) + dot(404, 189, 4) + dot(416, 185, 4) // smile
  + dot(400, 240, 8) + dot(400, 274, 8) + dot(400, 306, 8) // buttons
  + p('M332 256 L250 200 M268 213 L262 184 M268 213 L238 222 M468 256 L550 200 M532 213 L538 184 M532 213 L562 222') // stick arms
  + p('M640 520 L700 360 L760 520 Z M700 360 L700 330 M680 440 L720 440') // a little tree
  + [[120, 120], [230, 70], [600, 90], [700, 200], [120, 300], [560, 300]].map(([x, y]) => p(`M${x - 14} ${y} L${x + 14} ${y} M${x - 7} ${y - 12} L${x + 7} ${y + 12} M${x - 7} ${y + 12} L${x + 7} ${y - 12}`)).join(''), // snowflakes
)

export const PAGE_CATEGORIES: PageCategory[] = ['Animals', 'Things that go', 'Places and nature', 'Treats', 'Seasons']
export const COLORING_PAGES: ColoringPage[] = [
  { id: 'cat', name: 'Cat', emoji: '🐱', category: 'Animals', svg: CAT },
  { id: 'dog', name: 'Dog', emoji: '🐶', category: 'Animals', svg: DOG },
  { id: 'dinosaur', name: 'Dinosaur', emoji: '🦕', category: 'Animals', svg: DINO },
  { id: 'unicorn', name: 'Unicorn', emoji: '🦄', category: 'Animals', svg: UNICORN },
  { id: 'fish', name: 'Fish', emoji: '🐟', category: 'Animals', svg: FISH },
  { id: 'butterfly', name: 'Butterfly', emoji: '🦋', category: 'Animals', svg: BUTTERFLY },
  { id: 'car', name: 'Car', emoji: '🚗', category: 'Things that go', svg: CAR },
  { id: 'train', name: 'Train', emoji: '🚂', category: 'Things that go', svg: TRAIN },
  { id: 'rocket', name: 'Rocket', emoji: '🚀', category: 'Things that go', svg: ROCKET },
  { id: 'house', name: 'House', emoji: '🏠', category: 'Places and nature', svg: HOUSE },
  { id: 'castle', name: 'Castle', emoji: '🏰', category: 'Places and nature', svg: CASTLE },
  { id: 'garden', name: 'Rainbow garden', emoji: '🌈', category: 'Places and nature', svg: GARDEN },
  { id: 'cupcake', name: 'Cupcake', emoji: '🧁', category: 'Treats', svg: CUPCAKE },
  { id: 'ice-cream', name: 'Ice cream', emoji: '🍦', category: 'Treats', svg: ICE_CREAM },
  { id: 'pumpkin', name: 'Pumpkin', emoji: '🎃', category: 'Seasons', svg: PUMPKIN },
  { id: 'snowman', name: 'Snowman', emoji: '⛄', category: 'Seasons', svg: SNOWMAN },
]
export const pageUrl = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`
