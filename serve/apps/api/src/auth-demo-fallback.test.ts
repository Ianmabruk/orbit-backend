import test from 'node:test'
import assert from 'node:assert/strict'

import { app } from './index.js'
import { prisma } from './lib/prisma.js'

test('demo login succeeds when the database is unavailable', async () => {
  const originalFindUnique = prisma.user.findUnique
  prisma.user.findUnique = async () => {
    throw new Error('ECONNREFUSED')
  }

  try {
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'demo@example.com',
        password: 'DemoPass123',
      },
    })

    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json(), {
      token: response.json().token,
      user: {
        email: 'demo@example.com',
        fullName: 'Demo User',
        businessName: 'Northwind Services',
      },
      server: 'server-1',
    })
    assert.equal(typeof response.json().token, 'string')
  } finally {
    prisma.user.findUnique = originalFindUnique
  }
})
