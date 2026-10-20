import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeContactRow, mergeContactRows } from './contact-sync.js'

test('normalizes contact rows and removes duplicates by email or phone', () => {
  const rows = [
    { name: 'Jane Doe', email: 'Jane@Example.com ', phone: '+1 (555) 123-4567', consent: 'unknown' },
    { name: 'Jane Doe', email: 'jane@example.com', phone: '+15551234567', consent: 'opted_in' },
    { name: 'John Smith', email: 'john@example.com', phone: '', consent: 'opted_out' },
  ]

  const normalized = rows.map(normalizeContactRow)
  const merged = mergeContactRows(normalized)

  assert.equal(normalized[0].email, 'jane@example.com')
  assert.equal(normalized[0].phone, '+15551234567')
  assert.equal(normalized[0].status, 'active')
  assert.equal(merged.length, 2)
  assert.equal(merged[0].consent, 'opted_in')
})
