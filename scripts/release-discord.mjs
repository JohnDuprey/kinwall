#!/usr/bin/env node
// Posts a release's highlights to Discord (.github/workflows/discord.yml, after release-please makes a
// release). The text is that version's section of docs/whats-new.md: its intro and Highlights (or the
// whole section if it has none), as plain text with "See [docs](…)." pointers dropped, plus a link to
// the full notes on the GitHub Release.
//   node scripts/release-discord.mjs v1.2.0            posts to $DISCORD_RELEASE_WEBHOOK
//   node scripts/release-discord.mjs v1.2.0 --dry-run  prints the payload instead
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** The `## X.Y.Z` section of What's new, intro plus Highlights when it has them. */
export function highlights(md, version) {
  const start = md.indexOf(`\n## ${version}\n`)
  if (start < 0) return ''
  const rest = md.slice(start + version.length + 5)
  const section = rest.slice(0, rest.search(/\n## |$/))
  const h = section.indexOf('### Highlights')
  if (h < 0) return section
  const intro = section.slice(0, section.indexOf('\n### '))
  const after = section.slice(h + '### Highlights'.length)
  const next = after.search(/\n### /)
  return intro + '\n' + (next < 0 ? after : after.slice(0, next))
}

/** Markdown to Discord-friendly text: unwrap lines, bullets as •, links as their text, no doc pointers. */
export function plain(text) {
  const out = []
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim() || line.startsWith('#') || line.startsWith('<!--')) { if (out.length && out.at(-1) !== '') out.push(''); continue }
    if (!/^\* /.test(line) && out.length && out.at(-1) !== '') out[out.length - 1] += ' ' + line.trim() // a wrapped line
    else out.push(line.replace(/^\* /, '• '))
  }
  return out.join('\n').trim()
    .replace(/ See \[[^\]]+\]\([^)]+\)( and \[[^\]]+\]\([^)]+\))*\./g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
}

/** Cap at Discord's embed limit, cutting at a line, never mid-bullet. */
export function cap(text, max = 3600) {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  return cut.slice(0, cut.lastIndexOf('\n')).trimEnd() + '\n…'
}

const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const [tag, flag] = process.argv.slice(2)
  const version = (tag || '').replace(/^v/, '')
  if (!/^\d+\.\d+\.\d+$/.test(version)) { console.error('usage: release-discord.mjs vX.Y.Z [--dry-run]'); process.exit(2) }
  const releaseUrl = `https://github.com/${process.env.GITHUB_REPOSITORY || 'JohnDuprey/kinwall'}/releases/tag/v${version}`
  const body = plain(highlights(readFileSync('docs/whats-new.md', 'utf8'), version))
  const description = cap(body || `Kinwall ${version} is out.`) + `\n\nFull notes: ${releaseUrl}`
  const payload = { embeds: [{ title: `Kinwall ${version} is out`, url: releaseUrl, description, color: 0x123857 }] }
  if (flag === '--dry-run') { console.log(JSON.stringify(payload, null, 2)); process.exit(0) }
  const hook = process.env.DISCORD_RELEASE_WEBHOOK
  if (!hook) { console.log('DISCORD_RELEASE_WEBHOOK is not set; skipping the Discord post.'); process.exit(0) }
  const res = await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
  if (!res.ok) { console.error(`Discord answered ${res.status}: ${await res.text()}`); process.exit(1) }
  console.log(`Posted Kinwall ${version} to Discord.`)
}
