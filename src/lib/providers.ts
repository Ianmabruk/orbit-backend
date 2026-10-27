export type ProviderConfig = {
  mailerSendApiToken: string
  senderEmail: string
  senderName: string
  emailConfigured: boolean
  smsConfigured: boolean
}

export type ProviderStatusSummary = {
  email: {
    status: 'configured' | 'not_configured' | 'unauthorized'
    provider: 'mailersend' | null
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

export function getProviderConfig(input: NodeJS.ProcessEnv = process.env): ProviderConfig {
  const mailerSendApiToken = (input.MAILERSEND_API_TOKEN ?? '').trim()
  const senderEmail = (input.MAILERSEND_FROM_EMAIL ?? '').trim()
  const senderName = (input.MAILERSEND_FROM_NAME ?? '').trim()

  return {
    mailerSendApiToken,
    senderEmail,
    senderName,
    emailConfigured: Boolean(mailerSendApiToken && senderEmail),
    smsConfigured: false,
  }
}

export function getProviderStatus(input: NodeJS.ProcessEnv = process.env): ProviderStatusSummary {
  const config = getProviderConfig(input)

  const email = config.emailConfigured
    ? {
        status: 'configured' as const,
        provider: 'mailersend' as const,
        sender: config.senderEmail,
      }
    : {
        status: 'not_configured' as const,
        provider: null,
        sender: null,
        message: 'MailerSend requires an API token and authorized sender address.',
      }

  const sms = {
    status: 'not_configured' as const,
    provider: null,
    sender: null,
    message: 'MailerSend does not provide SMS. Configure a dedicated SMS provider to enable SMS campaigns.',
  }

  return {
    email,
    sms,
    isFullyConfigured: Boolean(config.emailConfigured),
  }
}

export async function checkMailerSendHealth(input: NodeJS.ProcessEnv = process.env) {
  const config = getProviderConfig(input)

  if (!config.emailConfigured) {
    return {
      ok: false,
      status: 'not_configured',
      message: 'MailerSend is not configured.',
    }
  }

  try {
    const response = await fetch('https://api.mailersend.com/v1/domains', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.mailerSendApiToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      return {
        ok: false,
        status: 'unauthorized',
        provider: 'mailersend',
        message: 'MailerSend API rejected the configured credentials.',
      }
    }

    const data = await response.json().catch(() => ({}))
    return {
      ok: true,
      status: 'configured',
      provider: 'mailersend',
      message: 'MailerSend account authentication succeeded.',
      account: data,
    }
  } catch (error) {
    return {
      ok: false,
      status: 'unauthorized',
      provider: 'mailersend',
      message: 'MailerSend health check failed. Verify network access and API permissions.',
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

export async function sendMailerSendEmail(payload: {
  to: Array<{ email: string; name?: string }>
  subject: string
  htmlContent?: string
  textContent?: string
  sender?: { email: string; name?: string }
}, input: NodeJS.ProcessEnv = process.env) {
  const config = getProviderConfig(input)

  if (!config.emailConfigured) {
    throw new Error('MailerSend is not configured. Add the API token and sender address before sending email.')
  }

  const sender = payload.sender ?? { email: config.senderEmail, name: config.senderName }
  const response = await fetch('https://api.mailersend.com/v1/email', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.mailerSendApiToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      from: sender,
      to: payload.to,
      subject: payload.subject,
      html: payload.htmlContent ?? payload.textContent ?? '',
      text: payload.textContent ?? payload.htmlContent ?? '',
    }),
    signal: AbortSignal.timeout(15_000),
  })

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string }
    throw new Error(body.message ?? 'MailerSend rejected the outbound email request.')
  }

  const messageId = response.headers.get('x-message-id') ?? response.headers.get('location') ?? null

  return {
    ok: true,
    provider: 'mailersend',
    messageId,
  }
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

  if (payload.channel === 'sms') {
    return {
      ok: false,
      channel: 'sms',
      provider: null,
      status: 'not_configured',
      reason: 'MailerSend does not support SMS. Configure a dedicated SMS provider to enable SMS campaigns.',
    }
  }

  if (!config.emailConfigured) {
    return {
      ok: false,
      channel: 'email',
      provider: null,
      status: 'not_configured',
      reason: 'MailerSend is not configured. Add the API token and sender address before sending email.',
    }
  }

  try {
    const result = await sendMailerSendEmail({
      to: [{ email: payload.to, name: payload.sender?.name ?? 'Customer' }],
      subject: payload.subject ?? 'Message from Serve',
      textContent: payload.text,
      htmlContent: `<p>${payload.text}</p>`,
      sender: payload.sender ?? { email: config.senderEmail, name: config.senderName },
    }, input)

    return {
      ok: true,
      channel: 'email',
      provider: 'mailersend',
      status: 'sent',
      messageId: result.messageId ?? null,
    }
  } catch (error) {
    return {
      ok: false,
      channel: 'email',
      provider: 'mailersend',
      status: 'failed',
      reason: error instanceof Error ? error.message : 'MailerSend email delivery failed.',
    }
  }
}

export class SmsService {
  static providerStatus() {
    return { status: 'not_configured' as const, provider: null, sender: null, message: 'MailerSend does not support SMS.' }
  }

  static async send() {
    return {
      ok: false,
      provider: null,
      status: 'not_configured' as const,
      reason: 'MailerSend does not support SMS.',
    }
  }
}
