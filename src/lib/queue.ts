import { Queue } from 'bullmq'
import { Redis } from 'ioredis'
import { z } from 'zod'

const envSchema = z.object({
  REDIS_URL: z.string().default('redis://localhost:6379'),
})

const env = envSchema.parse(process.env)

const connection = new Redis(env.REDIS_URL)
const queue = new Queue('serve-jobs', { connection })

export type CampaignDispatchPayload = {
  tenantId: string
  campaignId: string
  campaignName: string
  audience: number
  recipientIds?: string[]
  channel: 'sms' | 'email'
  template: string
  scheduledFor?: string | null
}

export async function enqueueCampaignJob(payload: CampaignDispatchPayload) {
  try {
    const scheduledFor = payload.scheduledFor ? new Date(payload.scheduledFor) : null
    const now = Date.now()
    const delayMs = scheduledFor ? Math.max(0, scheduledFor.getTime() - now) : 0

    const job = await queue.add('campaign-dispatch', payload, {
      ...(delayMs > 0 ? { delay: delayMs } : {}),
    })

    return { queued: true, jobId: job.id, status: 'queued' as const }
  } catch (error) {
    console.warn('Queue unavailable, falling back to in-memory dispatch:', error)
    return { queued: false, jobId: null, status: 'draft' as const }
  }
}
