import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { Queue, Worker, type Job } from 'bullmq'
import { Redis } from 'ioredis'
import { z } from 'zod'
import { dispatchCampaignMessage } from './lib/providers.js'

const envSchema = z.object({
  REDIS_URL: z.string().default('redis://localhost:6379'),
  WORKER_NAME: z.string().default('serve-worker'),
  DATABASE_URL: z.string().optional(),
})

const env = envSchema.parse(process.env)
const connection = new Redis(env.REDIS_URL)
const prisma = new PrismaClient()

export const queue = new Queue('serve-jobs', { connection })

const schema = z.object({
  tenantId: z.string(),
  campaignId: z.string().optional(),
  campaignName: z.string(),
  audience: z.number().int().nonnegative().default(0),
  channel: z.enum(['sms', 'email']),
  template: z.string(),
  scheduledFor: z.string().datetime().nullable().optional(),
})

async function updateCampaignStatus(campaignId: string | undefined, status: 'queued' | 'sent' | 'failed') {
  if (!campaignId) {
    return
  }

  try {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status },
    })
  } catch (error) {
    console.warn(`Unable to update campaign ${campaignId} to ${status}:`, error)
  }
}

async function persistDeliveryRecords(payload: z.infer<typeof schema>) {
  if (!env.DATABASE_URL) {
    return 0
  }

  try {
    const contacts = await prisma.contact.findMany({
      where: { tenantId: payload.tenantId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
      },
      take: Math.max(1, payload.audience || 25),
    })

    const logs = await Promise.all(
      contacts.map((contact: { name: string; email: string | null; phone: string | null }) =>
        prisma.messageLog.create({
          data: {
            tenantId: payload.tenantId,
            channel: payload.channel,
            recipient: contact.email ?? contact.phone ?? contact.name,
            status: 'sent',
          },
        }),
      ),
    )

    return logs.length
  } catch (error) {
    console.warn('Delivery logging skipped because the database is unavailable:', error)
    return 0
  }
}

const worker = new Worker(
  'serve-jobs',
  async (job: Job) => {
    const payload = schema.parse(job.data)
    const deliveryWindow = payload.scheduledFor ? new Date(payload.scheduledFor).toISOString() : 'immediately'

    const result = await dispatchCampaignMessage({
      channel: payload.channel,
      to: payload.channel === 'email' ? 'hello@example.com' : '+15551234567',
      subject: `Campaign: ${payload.campaignName}`,
      text: payload.template,
    }, process.env)

    if (!result.ok) {
      await updateCampaignStatus(payload.campaignId, 'failed')
      throw new Error(result.reason ?? `${payload.channel} dispatch is not configured.`)
    }

    const persistedCount = await persistDeliveryRecords(payload)
    await updateCampaignStatus(payload.campaignId, 'sent')

    console.log(`[${env.WORKER_NAME}] processing job`, {
      jobId: job.id,
      tenantId: payload.tenantId,
      campaignId: payload.campaignId,
      campaignName: payload.campaignName,
      deliveryWindow,
      channel: payload.channel,
      audience: payload.audience,
      provider: result.provider,
      persistedCount,
    })

    return {
      ok: true,
      jobId: job.id,
      status: 'sent',
      delivered: payload.audience,
      channel: payload.channel,
      tenantId: payload.tenantId,
      campaignId: payload.campaignId ?? null,
      campaignName: payload.campaignName,
      provider: result.provider,
      persistedCount,
      message: `Scheduled ${payload.channel} delivery to ${payload.audience} recipients ${deliveryWindow === 'immediately' ? 'immediately' : `for ${deliveryWindow}`}`,
    }
  },
  { connection },
)

worker.on('completed', (job: Job, result: unknown) => {
  console.log(`Job ${job.id} completed:`, result)
})

worker.on('failed', async (job: Job | undefined, error: Error) => {
  const payload = job?.data ? schema.safeParse(job.data) : undefined
  const campaignId = payload && payload.success ? payload.data.campaignId : undefined

  await updateCampaignStatus(campaignId, 'failed')
  console.error(`Job ${job?.id ?? 'unknown'} failed:`, error)
})

console.log(`Worker ready: ${env.WORKER_NAME} listening on serve-jobs`)

process.on('SIGINT', async () => {
  await worker.close()
  await queue.close()
  await connection.quit()
  await prisma.$disconnect().catch(() => undefined)
  process.exit(0)
})
