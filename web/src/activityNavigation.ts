/** The activity's extra history entry catches Back while its leave dialog is open. */
export function activityBackAction(leaving: boolean, hash: string, openedHash: string, atActivityEntry: boolean): 'leave' | 'ask' | 'none' {
  // A dialog resolves during its own popstate, before this listener runs. Confirming
  // Leave queues another Back; wait for that traversal before changing the route.
  if (atActivityEntry) return 'none'
  // replace('#/activities') can itself emit popstate. Replacing that same destination
  // again traps WebKit in navigation instead of letting the route finish changing.
  if (leaving) return hash === '#/activities' ? 'none' : 'leave'
  return hash === openedHash ? 'ask' : 'none'
}
