import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error: a plain .mjs script outside the web app
import { cap, highlights, plain } from '../../scripts/release-discord.mjs'

const md = `# What's new

## 1.2.0

Intro that wraps
onto two lines.

### Highlights

* **Lists**: a thing. See [Lists](using/lists.md).
* **Board**: another thing that wraps
  onto the next line, with [a link](https://example.com).

### Fixes

* Not in the post.

## 1.1.0

* Older.
`

test('the Discord post is the version intro and Highlights as plain text', () => {
  assert.equal(plain(highlights(md, '1.2.0')), 'Intro that wraps onto two lines.\n\n• **Lists**: a thing.\n• **Board**: another thing that wraps onto the next line, with a link.')
})

test('a version without Highlights posts its whole section; an unknown one posts nothing', () => {
  assert.equal(plain(highlights(md, '1.1.0')), '• Older.')
  assert.equal(highlights(md, '9.9.9'), '')
})

test('long notes are cut at a line, not mid-bullet', () => {
  assert.equal(cap('• one\n• two\n• three', 12), '• one\n• two\n…')
})
