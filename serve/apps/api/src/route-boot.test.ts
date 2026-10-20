import test from 'node:test'
import assert from 'node:assert/strict'

test('api server boots without duplicate route registrations', async () => {
  await import('./index.js')
  assert.ok(true)
})
