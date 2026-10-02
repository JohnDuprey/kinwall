// node --test test/ (npm test). What an API failure says to the person.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { failureMessage, SERVER_TROUBLE_MESSAGE } from '../src/failureMessage.ts'

test('failureMessage: a server error with no words of its own is calm and plain', () => {
  for (const m of ['', undefined, 'HTTP 500', 'Bad Gateway', 'Internal Server Error', 'Service Unavailable']) {
    assert.equal(failureMessage(502, m), SERVER_TROUBLE_MESSAGE)
  }
})

test('failureMessage: the server\'s own words are shown as they are (4xx, and 5xx a parent needs)', () => {
  assert.equal(failureMessage(400, 'name: Required'), 'name: Required')
  assert.equal(failureMessage(404, 'Not Found'), 'Not Found')
  assert.equal(failureMessage(502, 'Google said invalid_grant'), 'Google said invalid_grant')
  assert.equal(failureMessage(500, SERVER_TROUBLE_MESSAGE), SERVER_TROUBLE_MESSAGE)
})
