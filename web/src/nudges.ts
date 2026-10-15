// The nudge lines (a transition reminder's headline, the leave-by / start-prep Live Activity's) are
// written in one place, server/src/nudges.ts, which the server's pushes use too. The Docker web
// stage copies that one file in (Dockerfile); it imports nothing.
export * from '../../server/src/nudges.ts'
