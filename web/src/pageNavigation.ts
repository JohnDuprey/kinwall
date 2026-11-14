interface PageBrowser {
  location: { hash: string; replace(hash: string): void }
  history: { state: unknown; replaceState(state: unknown, unused: string): void; back(): void }
}
interface PageClick {
  button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean
  currentTarget: { hash: string }
  preventDefault(): void
}

// These secondary pages return through an entry made in this tab, like Lists. No return
// URL is accepted, and direct links replace themselves with Home rather than making a loop.
function pageNavigation(page: 'routine' | 'journal') {
  const mark = page === 'routine' ? 'kinwallRoutineFrom' : 'kinwallJournalFrom'
  const accepts = (hash: string) => hash.split('?')[0].split('/')[1] === page && hash.startsWith('#/')
  const enter = (hash: string, browser: PageBrowser = window) => {
    if (!accepts(hash) || hash === browser.location.hash) return
    browser.location.hash = hash
    browser.history.replaceState({ ...browser.history.state as object, [mark]: true }, '')
  }
  const open = (event: PageClick, browser: PageBrowser = window) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !accepts(event.currentTarget.hash)) return
    event.preventDefault()
    enter(event.currentTarget.hash, browser)
  }
  const leave = (browser: PageBrowser = window) => {
    if ((browser.history.state as Record<string, unknown> | null)?.[mark] === true) browser.history.back()
    else browser.location.replace('#/home')
  }
  return { enter, open, leave }
}

export const { open: openRoutine, leave: leaveRoutine } = pageNavigation('routine')
export const { enter: enterJournal, open: openJournal, leave: leaveJournal } = pageNavigation('journal')
