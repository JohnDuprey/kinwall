import { test } from 'node:test'
import assert from 'node:assert/strict'
import { routineDeviceError } from '../src/routineDeviceError.ts'

test('adult Apple account errors explain which device needs setup without framework details', () => {
  const raw = 'UnexpectedException: Family Controls is only available for child and teen iCloud accounts. (at ExpoModulesCore/ConcurrentFunctionDefinition.swift:123)'
  assert.equal(routineDeviceError(raw), 'This device needs to be signed into a child or teen Apple Account. Continue setup on the child’s iPhone or iPad.')
})

test('other native failures do not display exception names or stack traces', () => {
  assert.equal(routineDeviceError('UnexpectedException: ' + 'ConcurrentFunctionDefinition'.repeat(100)), 'Could not finish device setup. On the child’s device, check Screen Time access and try again.')
})
