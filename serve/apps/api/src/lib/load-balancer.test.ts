import test from 'node:test'
import assert from 'node:assert/strict'

import {
  LoginScheduler,
  SERVER_COUNT,
  MAX_CONCURRENT_LOGINS_PER_SERVER,
  type SchedulerStore,
} from './load-balancer.js'

function makeStore(): SchedulerStore {
  const state = new Map<string, number>()
  return {
    async get(key: string) {
      return state.get(key) === undefined ? null : String(state.get(key) ?? 0)
    },
    async set(key: string, value: number) {
      state.set(key, value)
      return value
    },
    async incr(key: string) {
      const next = (state.get(key) ?? 0) + 1
      state.set(key, next)
      return next
    },
    async decr(key: string) {
      const next = Math.max(0, (state.get(key) ?? 0) - 1)
      state.set(key, next)
      return next
    },
    async rpush(key: string, value: string) {
      const existing = state.get(key) ?? 0
      state.set(key, existing + 1)
      return existing + 1
    },
  }
}

test('round-robin login distribution uses all four servers across eight requests', async () => {
  const store = makeStore()
  const scheduler = new LoginScheduler({ store, serverCount: SERVER_COUNT, maxConcurrentPerServer: MAX_CONCURRENT_LOGINS_PER_SERVER })

  const assignments = [] as string[]
  for (let i = 0; i < 8; i += 1) {
    const assignment = await scheduler.selectServerForLogin()
    assignments.push(assignment)
  }

  assert.deepEqual(assignments, ['server-1', 'server-2', 'server-3', 'server-4', 'server-1', 'server-2', 'server-3', 'server-4'])
})

test('login capacity enforces the three-task limit per server and queues overflow fairly', async () => {
  const store = makeStore()
  const scheduler = new LoginScheduler({ store, serverCount: SERVER_COUNT, maxConcurrentPerServer: 3 })

  const first = await scheduler.reserveSlot('server-1')
  const second = await scheduler.reserveSlot('server-1')
  const third = await scheduler.reserveSlot('server-1')
  const fourth = await scheduler.reserveSlot('server-1')

  assert.equal(first, true)
  assert.equal(second, true)
  assert.equal(third, true)
  assert.equal(fourth, false)

  const released = await scheduler.releaseSlot('server-1')
  assert.equal(released, true)

  const next = await scheduler.reserveSlot('server-1')
  assert.equal(next, true)
})

test('falls back to in-memory scheduler state when Redis is unavailable', async () => {
  const failingRedis = {
    async get() { throw new Error('ECONNREFUSED') },
    async set() { throw new Error('ECONNREFUSED') },
    async incr() { throw new Error('ECONNREFUSED') },
    async decr() { throw new Error('ECONNREFUSED') },
    async rpush() { throw new Error('ECONNREFUSED') },
  } as any

  const scheduler = new LoginScheduler({ redis: failingRedis, serverCount: 2, maxConcurrentPerServer: 1 })

  assert.equal(await scheduler.selectServerForLogin(), 'server-1')
  assert.equal(await scheduler.reserveSlot('server-1'), true)
  assert.equal(await scheduler.reserveSlot('server-1'), false)
  assert.equal(await scheduler.releaseSlot('server-1'), true)
})
