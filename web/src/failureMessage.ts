/** A server error with no words of its own (a proxy's 502 page, a bare status line): calm and plain,
 * never "Bad Gateway" or "HTTP 500". The server's own 500s already say this (server/src/redact.ts). */
export const SERVER_TROUBLE_MESSAGE = 'Something went wrong. Please try again.'
export function failureMessage(status: number, message: string | undefined): string {
  const bare = !message || /^HTTP \d+$/.test(message) || BARE.includes(message)
  return status >= 500 && bare ? SERVER_TROUBLE_MESSAGE : message || `HTTP ${status}`
}
const BARE = ['Internal Server Error', 'Bad Gateway', 'Service Unavailable', 'Gateway Timeout']
