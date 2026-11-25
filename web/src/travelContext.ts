// Today on a trip and its plan checks: the server's own pure helpers (server/src/travel-context.ts),
// so the trip page, the Board and the API agree on whose clock "today" follows.
export { planChecks, tripClock, zonedInstant as exactInstant } from '../../server/src/travel-context.ts'
export type { TravelDay } from '../../server/src/travel-context.ts'
