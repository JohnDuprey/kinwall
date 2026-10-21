import { msg, t, tm } from './i18n.ts'

/** A server error with no words of its own (a proxy's 502 page, a bare status line): calm and plain,
 * never "Bad Gateway" or "HTTP 500". The server's own 500s already say this (server/src/redact.ts). */
export const SERVER_TROUBLE_MESSAGE = msg('Something went wrong. Please try again.')
export function failureMessage(status: number, message: string | undefined): string {
  const bare = !message || /^HTTP \d+$/.test(message) || BARE.includes(message) || message === SERVER_TROUBLE_MESSAGE
  return status >= 500 && bare ? tm(SERVER_TROUBLE_MESSAGE) : message || `HTTP ${status}`
}
const BARE = ['Internal Server Error', 'Bad Gateway', 'Service Unavailable', 'Gateway Timeout']

/** A screen or section that didn't load (LoadError in a11y.tsx): the same plain words everywhere,
 * never the server's own message. */
export const loadErrorText = (what: string) => LOAD_ERRORS[what] ? tm(LOAD_ERRORS[what]) : t("Couldn't load {what}. Check your connection.", { what })
// Each screen's own sentence, so a language can say it its own way (not a glued-in noun).
const LOAD_ERRORS: Record<string, string> = {
  contacts: msg("Couldn't load contacts. Check your connection."),
  events: msg("Couldn't load events. Check your connection."),
  Newscast: msg("Couldn't load Newscast. Check your connection."),
  outings: msg("Couldn't load outings. Check your connection."),
  upkeep: msg("Couldn't load home upkeep. Check your connection."),
  recipes: msg("Couldn't load recipes. Check your connection."),
  restaurants: msg("Couldn't load restaurants. Check your connection."),
  'the board': msg("Couldn't load the board. Check your connection."),
  'the meal plan': msg("Couldn't load the meal plan. Check your connection."),
}
