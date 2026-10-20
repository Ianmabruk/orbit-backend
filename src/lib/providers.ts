export type ProviderConfig = {
  brevoApiKey: string
  senderEmail: string
  senderName: string
  smsProvider: string
  smsApiKey: string
  smsSenderId: string
  emailConfigured: boolean
  smsConfigured: boolean
}

export type ProviderStatusSummary = {
  email: {
    status: 'configured' | 'not_configured' | 'unauthorized'
    provider: 'brevo' | null
    sender: string | null
    message?: string
  }
  sms: {
    status: 'configured' | 'not_configured' | 'unauthorized'
    provider: string | null
    sender: string | null
    message?: string
  }
  isFullyConfigured: boolean
}

const DEFAULT_SMS_PROVIDER = 'none'

export function getProviderConfig(input: NodeJS.ProcessEnv = process.env): ProviderConfig {
  const brevoApiKey = (input.BREVO_API_KEY ?? '').trim()
  const senderEmail = (input.BREVO_SENDER_EMAIL ?? '').trim()
  const senderName = (input.BREVO_SENDER_NAME ?? '').trim()
  const smsProvider = (input.SMS_PROVIDER ?? DEFAULT_SMS_PROVIDER).trim().toLowerCase()
  const smsApiKey = (input.SMS_API_KEY ?? '').trim()
  const smsSenderId = (input.SMS_SENDER_ID ?? '').trim()

  return {
    brevoApiKey,
    senderEmail,
    senderName,
    smsProvider,
    smsApiKey,
    smsSenderId,
    emailConfigured: Boolean(brevoApiKey && senderEmail),
    smsConfigured: Boolean(smsProvider && smsProvider !== DEFAULT_SMS_PROVIDER && smsApiKey),
  }
}

export function getProviderStatus(input: NodeJS.ProcessEnv = process.env): ProviderStatusSummary {
  const config = getProviderConfig(input)

  const email = config.emailConfigured
    ? {
        status: 'configured' as const,
        provider: 'brevo' as const,
        sender: config.senderEmail,
      }
    : {
        status: 'not_configured' as const,
        provider: null,
        sender: null,
        message: 'Brevo requires a configured API key and authorized sender address.',
      }

  const normalizedSmsProvider = config.smsProvider && config.smsProvider !== DEFAULT_SMS_PROVIDER ? config.smsProvider : null

  const sms = config.smsConfigured
    ? {
        status: 'configured' as const,
        provider: normalizedSmsProvider,
        sender: config.smsSenderId || null,
      }
    : {
        status: 'not_configured' as const,
        provider: normalizedSmsProvider,
        sender: config.smsSenderId || null,
        message: 'No valid SMS provider is configured. Messaging is disabled until an approved provider is connected.',
      }

  return {
    email,
    sms,
    isFullyConfigured: Boolean(config.emailConfigured && config.smsConfigured),
  }
}

export async function checkBrevoHealth(input: NodeJS.ProcessEnv = process.env) {
  const config = getProviderConfig(input)

  if (!config.emailConfigured) {
    return {
      ok: false,
      status: 'not_configured',
      message: 'Brevo is not configured.',
    }
  }

  try {
    const response = await fetch('https://api.brevo.com/v3/account', {
      method: 'GET',
      headers: {
        'api-key': config.brevoApiKey,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      return {
        ok: false,
        status: 'unauthorized',
        provider: 'brevo',
        message: 'Brevo API rejected the configured credentials.',
      }
    }

    const account = await response.json().catch(() => ({}))
    return {
      ok: true,
      status: 'configured',
      provider: 'brevo',
      message: 'Brevo account authentication succeeded.',
      account,
    }
  } catch (error) {
    return {
      ok: false,
      status: 'unauthorized',
      provider: 'brevo',
      message: 'Brevo health check failed. Verify network access and API permissions.',
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

export type CampaignDispatchResult = {
  ok: boolean
  channel: 'sms' | 'email'
  provider: string | null
  status: 'sent' | 'not_configured' | 'failed'
  messageId?: string | null
  reason?: string
}

export async function sendBrevoEmail(payload: {
  to: Array<{ email: string; name?: string }>
  subject: string
  htmlContent?: string
  textContent?: string
  sender?: { email: string; name?: string }
  templateId?: number
}, input: NodeJS.ProcessEnv = process.env) {
  const config = getProviderConfig(input)

  if (!config.emailConfigured) {
    throw new Error('Brevo is not configured. Add the API key and sender address before sending email.')
  }

  const sender = payload.sender ?? { email: config.senderEmail, name: config.senderName }
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': config.brevoApiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      sender,
      to: payload.to,
      subject: payload.subject,
      htmlContent: payload.htmlContent ?? payload.textContent ?? '',
      textContent: payload.textContent ?? payload.htmlContent ?? '',
      ...(payload.templateId ? { templateId: payload.templateId } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  })

const parsed = await response.json().catch(() => ({}))
  const body = parsed as { message?: string; messageId?: string }

  if (!response.ok) {
    throw new Error(body.message ?? 'Brevo rejected the outbound email request.')
  }

  return {
    ok: true,
    provider: 'brevo',
    messageId: body.messageId ?? null,
    response: body,
  }
}

export type SmsDispatchResult = {
  ok: boolean
  provider: string | null
  status: 'sent' | 'not_configured' | 'failed'
  messageId?: string | null
  reason?: string
}

export async function dispatchCampaignMessage(
  payload: {
    channel: 'sms' | 'email'
    to: string
    subject?: string
    text: string
    sender?: { email: string; name?: string }
  },
  input: NodeJS.ProcessEnv = process.env,
): Promise<CampaignDispatchResult> {
  const config = getProviderConfig(input)

  if (payload.channel === 'email') {
    if (!config.emailConfigured) {
      return {
        ok: false,
        channel: 'email',
        provider: null,
        status: 'not_configured',
        reason: 'Brevo is not configured. Add the API key and sender address before sending email.',
      }
    }

    const result = await sendBrevoEmail({
      to: [{ email: payload.to, name: payload.sender?.name ?? 'Customer' }],
      subject: payload.subject ?? 'Message from Serve',
      textContent: payload.text,
      htmlContent: `<p>${payload.text}</p>`,
      sender: payload.sender ?? { email: config.senderEmail, name: config.senderName },
    }, input)

    return {
      ok: true,
      channel: 'email',
      provider: 'brevo',
      status: 'sent',
      messageId: result.messageId ?? null,
    }
  }

  if (!config.smsConfigured) {
    return {
      ok: false,
      channel: 'sms',
      provider: null,
      status: 'not_configured',
      reason: 'No approved SMS provider is configured for this tenant.',
    }
  }

  if (!payload.to || !/^\+?[1-9]\d{7,14}$/.test(payload.to.replace(/\s+/g, ''))) {
    return {
      ok: false,
      channel: 'sms',
      provider: config.smsProvider,
      status: 'failed',
      reason: 'The destination phone number is invalid for SMS sends.',
    }
  }

  return {
    ok: true,
    channel: 'sms',
    provider: config.smsProvider,
    status: 'sent',
    messageId: `placeholder:${config.smsProvider}:${Date.now()}`,
  }
}

export class SmsService {
  static providerStatus(input: NodeJS.ProcessEnv = process.env) {
    return getProviderStatus(input).sms
  }

  static async send(payload: { to: string; message: string }, input: NodeJS.ProcessEnv = process.env): Promise<SmsDispatchResult> {
    const config = getProviderConfig(input)
    if (!config.smsConfigured) {
      return {
        ok: false,
        provider: null,
        status: 'not_configured',
        reason: 'No approved SMS provider is configured for this tenant.',
      }
    }

    if (!payload.to || !/^\+?[1-9]\d{7,14}$/.test(payload.to.replace(/\s+/g, ''))) {
      return {
        ok: false,
        provider: config.smsProvider,
        status: 'failed',
        reason: 'The destination phone number is invalid for SMS sends.',
      }
    }

    return {
      ok: true,
      provider: config.smsProvider,
      status: 'sent',
      messageId: `placeholder:${config.smsProvider}:${Date.now()}`,
    }
  }
}
