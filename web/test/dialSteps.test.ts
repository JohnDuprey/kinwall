// node --test test/ (npm test). A contact phone's menu: steps to a dial string and words, and back.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dialToSteps, stepsToDial, stepsToWords, telUri, type DialStep } from '../src/dialSteps.ts'

test('dialSteps: waits become 2-second commas (rounded up), presses their keys, "wait for me" a semicolon', () => {
  const steps: DialStep[] = [{ kind: 'wait', seconds: 3 }, { kind: 'press', digits: '2', label: 'Prescriptions' }, { kind: 'wait', seconds: 2 }, { kind: 'press', digits: '1' }, { kind: 'confirm' }, { kind: 'press', digits: '1234#' }]
  assert.equal(stepsToDial(steps), ',,2,1;1234#')
  assert.equal(stepsToWords(steps), 'Wait 3 seconds, press 2 (Prescriptions), wait 2 seconds, press 1, wait until you are ready to go on, then press 1234#.')
  assert.equal(stepsToWords([{ kind: 'wait', seconds: 1 }]), 'Wait 1 second.')
  assert.equal(stepsToWords([]), '')
  assert.equal(telUri('+1 (555) 555-0123', stepsToDial(steps)), 'tel:+15555550123,,2,1;1234%23')
  assert.equal(telUri('', ','), null)
})

test('dialSteps: a raw dial string back into steps', () => {
  assert.deepEqual(dialToSteps(',,2,1;*9#'), [{ kind: 'wait', seconds: 4 }, { kind: 'press', digits: '2' }, { kind: 'wait', seconds: 2 }, { kind: 'press', digits: '1' }, { kind: 'confirm' }, { kind: 'press', digits: '*9#' }])
  assert.deepEqual(dialToSteps(''), [])
  assert.equal(stepsToDial(dialToSteps(',,2,,1;3')), ',,2,,1;3')
})
