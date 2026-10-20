import type { PrismaClient } from '@prisma/client'

export type TenantAiContext = {
  tenantName: string
  contactsCount: number
  campaignsCount: number
  messageLogsCount: number
  recentCampaigns: Array<{
    name: string
    channel: string
    status: string
  }>
}

export async function getTenantAiContext(prisma: PrismaClient, tenantId: string): Promise<TenantAiContext> {
  const [contactsCount, campaignsCount, messageLogsCount, recentCampaigns] = await Promise.all([
    prisma.contact.count({ where: { tenantId } }),
    prisma.campaign.count({ where: { tenantId } }),
    prisma.messageLog.count({ where: { tenantId } }),
    prisma.campaign.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { name: true, channel: true, status: true },
    }),
  ])

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true },
  })

  return {
    tenantName: tenant?.name ?? 'your business',
    contactsCount,
    campaignsCount,
    messageLogsCount,
    recentCampaigns: recentCampaigns.map((campaign) => ({
      name: campaign.name,
      channel: campaign.channel,
      status: campaign.status,
    })),
  }
}

export function buildAiFallbackReply(message: string, context: TenantAiContext) {
  const lower = message.toLowerCase()

  if (lower.includes('campaign') || lower.includes('send') || lower.includes('schedule')) {
    return `I can help you prepare a campaign for ${context.tenantName}. Right now you have ${context.campaignsCount} campaign records, ${context.contactsCount} contacts, and ${context.messageLogsCount} sent messages logged. A safe next step is to create a draft, review audience consent, and confirm the send window before dispatching.`
  }

  if (lower.includes('contact') || lower.includes('import')) {
    return `Your tenant currently has ${context.contactsCount} saved contacts. To keep the list clean, import only validated rows, deduplicate by email or phone, and confirm consent before opting recipients into email or SMS.`
  }

  if (lower.includes('email') || lower.includes('sms') || lower.includes('brevo')) {
    return `For ${context.tenantName}, the platform is set up to send email through Brevo and SMS through the configured provider. Check that your sender identity, API key, and consent rules are valid before launching a campaign.`
  }

  return `I can help you with email, SMS, contact hygiene, and campaign planning for ${context.tenantName}. Based on your current workspace, you have ${context.contactsCount} contacts, ${context.campaignsCount} campaigns, and ${context.messageLogsCount} message events tracked. If you want, I can draft a renewal reminder, holiday announcement, or a campaign follow-up in your brand voice.`
}

export async function generateChatbotReply({
  message,
  context,
  apiKey,
  model,
}: {
  message: string
  context: TenantAiContext
  apiKey?: string
  model?: string
}) {
  const prompt = `You are a helpful business messaging assistant for ${context.tenantName}. Use only the information in the following tenant context and do not invent data. Context: contacts=${context.contactsCount}; campaigns=${context.campaignsCount}; messageLogs=${context.messageLogsCount}; recentCampaigns=${JSON.stringify(context.recentCampaigns)}. User question: ${message}. Give concise, actionable business guidance. Recommend a confirmation step before sending any real campaign.`

  if (!apiKey) {
    return {
      answer: buildAiFallbackReply(message, context),
      mode: 'fallback' as const,
    }
  }

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model ?? 'gemini-2.0-flash'}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text: prompt }],
        }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 400,
        },
      }),
    })

    if (!response.ok) {
      throw new Error(`AI provider rejected the request: ${response.status}`)
    }

    const payload = await response.json() as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>
        }
      }>
    }

    const answer = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('')?.trim() || buildAiFallbackReply(message, context)

    return {
      answer,
      mode: 'ai' as const,
    }
  } catch {
    return {
      answer: buildAiFallbackReply(message, context),
      mode: 'fallback' as const,
    }
  }
}
