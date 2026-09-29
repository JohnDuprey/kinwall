// node --test test/ (npm test). Which typeface a device shows: its own pick, else the family's.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deviceTypeface, resolveTypeface } from '../src/typeface.ts'

test('resolveTypeface: the device override, then the family setting, then Default', () => {
  assert.equal(resolveTypeface('storybook', 'playful'), 'playful')
  assert.equal(resolveTypeface('storybook', undefined), 'storybook')
  assert.equal(resolveTypeface(undefined, undefined), 'default')
  // A device can pick Default (Nunito) on purpose while the family uses another typeface.
  assert.equal(resolveTypeface('storybook', 'default'), 'default')
})

test('deviceTypeface: a device that picked a typeface keeps it as an override', () => {
  for (const t of ['hyperlegible', 'dyslexia', 'modern', 'playful', 'storybook', 'handwritten'] as const) assert.equal(deviceTypeface(t), t)
})

test('deviceTypeface: a device that stayed on Default (saved before family typefaces) follows the family', () => {
  // Older builds saved nothing for Default; guard the empty and unknown shapes too.
  for (const raw of [undefined, null, '', 'nunito', 42]) assert.equal(deviceTypeface(raw), undefined, String(raw))
  assert.equal(resolveTypeface('storybook', deviceTypeface(undefined)), 'storybook')
})
