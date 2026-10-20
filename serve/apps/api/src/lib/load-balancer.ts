import { Redis } from 'ioredis'

export const SERVER_COUNT = 4
export const MAX_CONCURRENT_LOGINS_PER_SERVER = 3

export type SchedulerStore = {
  get(key: string): Promise<string | null>
  set(key: string, value: number): Promise<number>
  incr(key: string): Promise<number>
  decr(key: string): Promise<number>
  rpush?(key: string, value: string): Promise<number>
}

export type LoginSchedulerOptions = {
  store?: SchedulerStore
  redis?: Redis
  serverCount?: number
  maxConcurrentPerServer?: number
  instanceId?: string
}

const defaultServerNames = Array.from({ length: SERVER_COUNT }, (_, index) => `server-${index + 1}`)

export class LoginScheduler {
  private readonly serverNames: string[]
  private readonly maxConcurrentPerServer: number
  private readonly store: SchedulerStore
  private readonly instanceId: string

  constructor(options: LoginSchedulerOptions = {}) {
    this.serverNames = Array.from({ length: options.serverCount ?? SERVER_COUNT }, (_, index) => `server-${index + 1}`)
    this.maxConcurrentPerServer = options.maxConcurrentPerServer ?? MAX_CONCURRENT_LOGINS_PER_SERVER
    this.store = options.store ?? createRedisStore(options.redis)
    this.instanceId = options.instanceId ?? process.env.SERVER_NAME ?? 'server-1'
  }

  private getServerKey(server: string) {
    return `login-scheduler:${server}:inflight`
  }

  private getQueueKey() {
    return 'login-scheduler:queue'
  }

  async selectServerForLogin(): Promise<string> {
    const counter = await this.store.incr('login-scheduler:counter')
    const startIndex = ((counter - 1) % this.serverNames.length + this.serverNames.length) % this.serverNames.length

    for (let offset = 0; offset < this.serverNames.length; offset += 1) {
      const server = this.serverNames[(startIndex + offset) % this.serverNames.length]
      const current = Number(await this.store.get(this.getServerKey(server)) ?? '0')
      if (current < this.maxConcurrentPerServer) {
        return server
      }
    }

    return this.serverNames[startIndex % this.serverNames.length]
  }

  async reserveSlot(server: string): Promise<boolean> {
    const key = this.getServerKey(server)
    const current = Number(await this.store.get(key) ?? '0')

    if (current >= this.maxConcurrentPerServer) {
      return false
    }

    await this.store.set(key, current + 1)
    return true
  }

  async releaseSlot(server: string): Promise<boolean> {
    const key = this.getServerKey(server)
    const current = Number(await this.store.get(key) ?? '0')
    if (current <= 0) {
      return false
    }
    await this.store.set(key, current - 1)
    return true
  }

  async queueLoginRequest(requestId: string): Promise<number> {
    if (!this.store.rpush) {
      return 0
    }

    return this.store.rpush(this.getQueueKey(), requestId)
  }

  getServerNames(): string[] {
    return [...this.serverNames]
  }

  getCurrentInstanceId(): string {
    return this.instanceId
  }

  static defaultServers(): string[] {
    return [...defaultServerNames]
  }
}

export function createRedisStore(redis: Redis | undefined): SchedulerStore {
  const memory = new Map<string, string>()

  const fallback = {
    async get(key: string) {
      return memory.get(key) ?? null
    },
    async set(key: string, value: number) {
      memory.set(key, String(value))
      return value
    },
    async incr(key: string) {
      const current = Number(memory.get(key) ?? '0')
      const next = current + 1
      memory.set(key, String(next))
      return next
    },
    async decr(key: string) {
      const current = Number(memory.get(key) ?? '0')
      const next = Math.max(0, current - 1)
      memory.set(key, String(next))
      return next
    },
    async rpush(key: string, value: string) {
      const existing = memory.get(key)
      const next = (existing ? Number(existing) : 0) + 1
      memory.set(key, String(next))
      return next
    },
  }

  if (!redis) {
    return fallback
  }

  return {
    async get(key: string) {
      try {
        return await redis.get(key)
      } catch {
        return fallback.get(key)
      }
    },
    async set(key: string, value: number) {
      try {
        await redis.set(key, String(value))
        return value
      } catch {
        return fallback.set(key, value)
      }
    },
    async incr(key: string) {
      try {
        return await redis.incr(key)
      } catch {
        return fallback.incr(key)
      }
    },
    async decr(key: string) {
      try {
        return await redis.decr(key)
      } catch {
        return fallback.decr(key)
      }
    },
    async rpush(key: string, value: string) {
      try {
        return await redis.rpush(key, value)
      } catch {
        return fallback.rpush(key, value)
      }
    },
  }
}
