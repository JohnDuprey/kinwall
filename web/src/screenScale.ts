// "Screen scale" (Settings → General → This display): how big the whole app is drawn on this device.
// It rewrites the viewport meta tag's initial-scale, which resizes the layout viewport itself, so the
// CSS breakpoints (phone ≤ 600px, rail ≥ 900px…) follow the scaled size, in the Android app's web
// view and in browsers alike. CSS `zoom` would shrink the drawing but leave the media queries on the
// device's own size. Pure apart from applyScreenScale, so node tests load it.

/** The choices, in percent; absent (Auto) is autoScale. */
export const SCREEN_SCALES = [75, 80, 90, 100, 110, 125] as const

/** Auto: a 10" Android tablet (shortest side 560–719 CSS px: 600 for 1200×1920 at density 320) is
 * drawn so its shortest side counts as 720, which gets it the tablet layout instead of the phone's.
 * Phones (≤ ~440), iPads (744 and up) and wall screens stay at 100%. `shortest`: the screen's shortest
 * side, not the window's, so it doesn't change with the keyboard, the system bars or rotation. */
export function autoScale(shortest: number): number {
  return shortest >= 560 && shortest < 720 ? shortest / 720 : 1
}

/** The scale in effect: this device's pick (percent), else Auto. */
export function screenScale(pick: number | undefined, shortest: number): number {
  return pick && (SCREEN_SCALES as readonly number[]).includes(pick) ? pick / 100 : autoScale(shortest)
}

/** The viewport meta tag for a scale. At 100% it's exactly the tag the app always had. Scaled, it has
 * no width: initial-scale alone makes the layout viewport the device's width divided by the scale,
 * and keeps doing so on rotation. `locked` (a paired wall display) pins the zoom to the scale so it
 * can't be pinched; other devices keep pinch-zoom. The Android web view doesn't zoom into a field on
 * focus at any of the scales. */
export function viewportContent(scale: number, locked: boolean): string {
  if (scale === 1) {
    return locked
      ? 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover'
      : 'width=device-width, initial-scale=1.0, viewport-fit=cover'
  }
  const s = String(Math.round(scale * 10000) / 10000)
  return locked
    ? `initial-scale=${s}, minimum-scale=${s}, maximum-scale=${s}, user-scalable=no, viewport-fit=cover`
    : `initial-scale=${s}, viewport-fit=cover`
}

let current = 1
/** The scale applied last (1 until applyScreenScale runs). */
export const appliedScale = () => current

/** Sets the viewport tag for this device's pick (percent, absent = Auto). Called before the first
 * render (main.tsx) and whenever the pick or the display lock changes (App.tsx). */
export function applyScreenScale(pick: number | undefined, locked: boolean) {
  current = screenScale(pick, Math.min(screen.width, screen.height))
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  const content = viewportContent(current, locked)
  if (meta && meta.content !== content) meta.content = content
}
