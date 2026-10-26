export type ProviderConfig = {
  emailProvider: 'mailtrap' | 'gmass' | 'brevo'
  mailtrapApiKey: string
  brevoApiKey: string
  gmassApiKey: string
  senderEmail: string
  senderName: string
  smsProvider: string
  smsApiKey: string
  sendAfricaApiKey: string
  smsAccountSid: string
  smsAuthToken: string
  smsSenderId: string
  emailConfigured: boolean
  smsConfigured: boolean
}

export type ProviderStatusSummary = {
  email: {
    status: 'configured' | 'not_configured' | 'unauthorized'
    provider: 'mailtrap' | 'gmass' | 'brevo' | null
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
const EMAIL_ADDRESS_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normalizeEmail(value: string): string {
  const normalized = (value ?? '').trim()
  return EMAIL_ADDRESS_RE.test(normalized) ? normalized : ''
}

export function getProviderConfig(input: NodeJS.ProcessEnv = process.env): ProviderConfig {
  const requestedProvider = ((input.EMAIL_PROVIDER ?? (input.MAILTRAP_API_KEY ? 'mailtrap' : input.GMASS_API_KEY ? 'gmass' : 'brevo')) as string).trim().toLowerCase()
  const emailProvider = requestedProvider === 'gmass' ? 'gmass' : requestedProvider === 'mailtrap' ? 'mailtrap' : 'brevo'
  const mailtrapApiKey = (input.MAILTRAP_API_KEY ?? '').trim()
  const brevoApiKey = (input.BREVO_API_KEY ?? '').trim()
  const gmassApiKey = (input.GMASS_API_KEY ?? '').trim()
  const senderEmail = normalizeEmail((emailProvider === 'gmass'
    ? (input.GMASS_SENDER_EMAIL ?? input.BREVO_SENDER_EMAIL ?? input.MAILTRAP_SENDER_EMAIL ?? '')
    : emailProvider === 'mailtrap'
      ? (input.MAILTRAP_SENDER_EMAIL ?? input.BREVO_SENDER_EMAIL ?? '')
      : (input.BREVO_SENDER_EMAIL ?? input.MAILTRAP_SENDER_EMAIL ?? '')))
  const senderName = (emailProvider === 'mailtrap'
    ? (input.MAILTRAP_SENDER_NAME ?? input.GMASS_SENDER_NAME ?? input.BREVO_SENDER_NAME ?? '')
    : emailProvider === 'gmass'
      ? (input.GMASS_SENDER_NAME ?? input.BREVO_SENDER_NAME ?? input.MAILTRAP_SENDER_NAME ?? '')
      : (input.BREVO_SENDER_NAME ?? input.MAILTRAP_SENDER_NAME ?? input.GMASS_SENDER_NAME ?? '')).trim()
  const smsProvider = (input.SMS_PROVIDER ?? DEFAULT_SMS_PROVIDER).trim().toLowerCase()
  const smsApiKey = (input.SMS_API_KEY ?? '').trim()
  const sendAfricaApiKey = (input.SENDAFRICA_API_KEY ?? '').trim()
  const smsAccountSid = ((input.SMS_ACCOUNT_SID ?? input.TWILIO_ACCOUNT_SID ?? '').trim())
  const smsAuthToken = ((input.SMS_AUTH_TOKEN ?? input.TWILIO_AUTH_TOKEN ?? '').trim())
  const smsSenderId = (input.SMS_SENDER_ID ?? '').trim()

  const twilioAccountSid = smsAccountSid || (smsApiKey.includes(':') ? smsApiKey.split(':', 1)[0] : '')
  const twilioAuthToken = smsAuthToken || (smsApiKey.includes(':') ? smsApiKey.slice(smsApiKey.indexOf(':') + 1) : smsApiKey)
  const activeKey = emailProvider === 'gmass' ? gmassApiKey : emailProvider === 'mailtrap' ? mailtrapApiKey : brevoApiKey

  return {
    emailProvider,
    mailtrapApiKey,
    brevoApiKey,
    gmassApiKey,
    senderEmail,
    senderName,
    smsProvider,
    smsApiKey,
    sendAfricaApiKey,
    smsAccountSid: twilioAccountSid,
    smsAuthToken: twilioAuthToken,
    smsSenderId,
    emailConfigured: Boolean(activeKey && senderEmail),
    smsConfigured: Boolean(
      smsProvider &&
      smsProvider !== DEFAULT_SMS_PROVIDER &&
      smsSenderId &&
      (
        (smsProvider === 'twilio' && twilioAccountSid && twilioAuthToken) ||
        (smsProvider === 'sendafrica' && sendAfricaApiKey) ||
        smsApiKey
      ),
    ),
  }
}

export function getProviderStatus(input: NodeJS.ProcessEnv = process.env): ProviderStatusSummary {
  const config = getProviderConfig(input)
  const providerLabel = config.emailProvider === 'gmass' ? 'GMass' : config.emailProvider === 'mailtrap' ? 'Mailtrap' : 'Brevo'

  const email = config.emailConfigured
    ? {
        status: 'configured' as const,
        provider: config.emailProvider,
        sender: config.senderEmail,
      }
    : {
        status: 'not_configured' as const,
        provider: config.emailProvider,
        sender: null,
        message: `${providerLabel} email is not configured. Add a valid API key and sender email before sending campaigns.`,
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
      provider: config.emailProvider,
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

export async function sendMailtrapEmail(payload: {
  to: Array<{ email: string; name?: string }>
  subject: string
  htmlContent?: string
  textContent?: string
  sender?: { email: string; name?: string }
}, input: NodeJS.ProcessEnv = process.env) {
  const config = getProviderConfig(input)

  if (!config.emailConfigured) {
    throw new Error('Mailtrap is not configured. Add the API key and sender address before sending email.')
  }

  const senderEmail = normalizeEmail(payload.sender?.email ?? config.senderEmail)
  if (!senderEmail) {
    throw new Error('The configured Mailtrap sender email is invalid. Add a verified sender email before sending email.')
  }

  const sender = payload.sender ?? { email: config.senderEmail, name: config.senderName }
  const response = await fetch('https://send.api.mailtrap.io/api/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.mailtrapApiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      from: { email: sender.email, name: sender.name || 'Serve Platform' },
      to: payload.to.map(({ email, name }) => ({ email, name: name || email })),
      subject: payload.subject,
      html: payload.htmlContent ?? payload.textContent ?? '',
      text: payload.textContent ?? payload.htmlContent ?? '',
      category: 'serve-campaign',
    }),
    signal: AbortSignal.timeout(15_000),
  })

  const parsed = await response.json().catch(() => ({}))
  const body = parsed as { message?: string; errors?: Array<{ message?: string }>; id?: string }

  if (!response.ok) {
    throw new Error(body.message ?? body.errors?.[0]?.message ?? 'Mailtrap rejected the outbound email request.')
  }

  return {
    ok: true,
    provider: 'mailtrap',
    messageId: body.id ?? null,
    response: body,
  }
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
    throw new Error('Email provider is not configured. Add the API key and sender address before sending email.')
  }

  const senderEmail = normalizeEmail(payload.sender?.email ?? config.senderEmail)
  if (!senderEmail) {
    throw new Error('The configured sender email is invalid. Add a verified sender email before sending email.')
  }

  if (config.emailProvider === 'gmass') {
    const gmassUrl = (input.GMASS_API_URL ?? 'https://api.gmass.co/v1/send').trim()
    const gmResponse = await fetch(gmassUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${config.gmassApiKey}`,
      },
      body: JSON.stringify({
        from: senderEmail,
        fromName: config.senderName || 'Serve Platform',
        to: payload.to.map(({ email, name }) => ({ email, name })),
        subject: payload.subject,
        html: payload.htmlContent ?? payload.textContent ?? '',
        text: payload.textContent ?? payload.htmlContent ?? '',
      }),
      signal: AbortSignal.timeout(15_000),
    })

    const parsed = await gmResponse.json().catch(() => ({}))
    const body = parsed as { message?: string; messageId?: string; id?: string }

    if (!gmResponse.ok) {
      throw new Error(body.message ?? body.id ?? 'GMass rejected the outbound email request.')
    }

    return {
      ok: true,
      provider: 'gmass',
      messageId: body.messageId ?? body.id ?? null,
      response: body,
    }
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

async function sendTwilioSms(payload: { to: string; text: string; from: string }, input: NodeJS.ProcessEnv = process.env) {
  const config = getProviderConfig(input)

  if (config.smsProvider !== 'twilio') {
    throw new Error('Twilio SMS is not the configured provider.')
  }

  if (!config.smsAccountSid || !config.smsAuthToken) {
    throw new Error('Twilio account SID and auth token are required for SMS sends.')
  }

  const auth = Buffer.from(`${config.smsAccountSid}:${config.smsAuthToken}`).toString('base64')

  const form = new URLSearchParams({
    To: payload.to,
    From: payload.from,
    Body: payload.text,
  })

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.smsAccountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: form.toString(),
    signal: AbortSignal.timeout(15_000),
  })

  const body = (await response.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number; more_info?: string }

  if (!response.ok) {
    throw new Error(body.message ?? 'Twilio rejected the outbound SMS request.')
  }

  return {
    ok: true,
    provider: 'twilio',
    status: 'sent' as const,
    messageId: body.sid ?? null,
  }
}

async function sendBrevoSms(payload: { to: string; text: string; from: string }, input: NodeJS.ProcessEnv = process.env) {
  const config = getProviderConfig(input)

  if (config.smsProvider !== 'brevo') {
    throw new Error('Brevo SMS is not the configured provider.')
  }

  const apiKey = config.brevoApiKey
  if (!apiKey) {
    throw new Error('Brevo API key is required for SMS sends.')
  }

  const sender = payload.from || config.smsSenderId || config.senderName || 'Serve'

  const response = await fetch('https://api.brevo.com/v3/transactionalSMS/sms', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      sender,
      recipient: payload.to,
      content: payload.text,
      type: 'transactional',
    }),
    signal: AbortSignal.timeout(15_000),
  })

  const body = (await response.json().catch(() => ({}))) as {
    id?: string
    messageId?: string
    status?: string
    message?: string
    error?: string
  }

  if (!response.ok) {
    throw new Error(body.message ?? body.error ?? 'Brevo rejected the outbound SMS request.')
  }

  return {
    ok: true,
    provider: 'brevo',
    status: 'sent' as const,
    messageId: body.id ?? body.messageId ?? null,
  }
}

async function sendSendAfricaSms(payload: { to: string; text: string; from: string }, input: NodeJS.ProcessEnv = process.env) {
  const config = getProviderConfig(input)

  if (config.smsProvider !== 'sendafrica') {
    throw new Error('SendAfrica SMS is not the configured provider.')
  }

  const apiKey = config.sendAfricaApiKey || config.smsApiKey
  if (!apiKey) {
    throw new Error('SendAfrica API key is required for SMS sends.')
  }

  const sender = payload.from || config.smsSenderId || config.senderName || 'Serve'

  const response = await fetch('https://api.sendafrica.com/v1/sms/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      to: payload.to,
      sender,
      message: payload.text,
      from: sender,
    }),
    signal: AbortSignal.timeout(15_000),
  })

  const body = (await response.json().catch(() => ({}))) as {
    id?: string
    messageId?: string
    status?: string
    message?: string
    error?: string
    data?: { id?: string; messageId?: string }
  }

  if (!response.ok) {
    throw new Error(body.message ?? body.error ?? 'SendAfrica rejected the outbound SMS request.')
  }

  return {
    ok: true,
    provider: 'sendafrica',
    status: 'sent' as const,
    messageId: body.id ?? body.messageId ?? body.data?.id ?? body.data?.messageId ?? null,
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

  if (payload.channel === 'email') {
    if (!config.emailConfigured) {
      const providerLabel = config.emailProvider === 'gmass' ? 'GMass' : config.emailProvider === 'mailtrap' ? 'Mailtrap' : 'Brevo'
      return {
        ok: false,
        channel: 'email',
        provider: config.emailProvider,
        status: 'not_configured',
        reason: `${providerLabel} is not configured. Add the API key and sender address before sending email.`,
      }
    }

    const result = config.emailProvider === 'mailtrap'
      ? await sendMailtrapEmail({
          to: [{ email: payload.to, name: payload.sender?.name ?? 'Customer' }],
          subject: payload.subject ?? 'Message from Serve',
          textContent: payload.text,
          htmlContent: `<p>${payload.text}</p>`,
          sender: payload.sender ?? { email: config.senderEmail, name: config.senderName },
        }, input)
      : await sendBrevoEmail({
          to: [{ email: payload.to, name: payload.sender?.name ?? 'Customer' }],
          subject: payload.subject ?? 'Message from Serve',
          textContent: payload.text,
          htmlContent: `<p>${payload.text}</p>`,
          sender: payload.sender ?? { email: config.senderEmail, name: config.senderName },
        }, input)

    return {
      ok: true,
      channel: 'email',
      provider: config.emailProvider,
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

  if (config.smsProvider === 'twilio') {
    try {
      const result = await sendTwilioSms({
        to: payload.to,
        text: payload.text,
        from: config.smsSenderId,
      }, input)

      return {
        ok: true,
        channel: 'sms',
        provider: 'twilio',
        status: result.status,
        messageId: result.messageId ?? null,
      }
    } catch (error) {
      return {
        ok: false,
        channel: 'sms',
        provider: 'twilio',
        status: 'failed',
        reason: error instanceof Error ? error.message : 'Twilio SMS delivery failed.',
      }
    }
  }

  if (config.smsProvider === 'brevo') {
    try {
      const result = await sendBrevoSms({
        to: payload.to,
        text: payload.text,
        from: config.smsSenderId || config.senderName || 'Serve',
      }, input)

      return {
        ok: true,
        channel: 'sms',
        provider: 'brevo',
        status: result.status,
        messageId: result.messageId ?? null,
      }
    } catch (error) {
      return {
        ok: false,
        channel: 'sms',
        provider: 'brevo',
        status: 'failed',
        reason: error instanceof Error ? error.message : 'Brevo SMS delivery failed.',
      }
    }
  }

  if (config.smsProvider === 'sendafrica') {
    try {
      const result = await sendSendAfricaSms({
        to: payload.to,
        text: payload.text,
        from: config.smsSenderId || config.senderName || 'Serve',
      }, input)

      return {
        ok: true,
        channel: 'sms',
        provider: 'sendafrica',
        status: result.status,
        messageId: result.messageId ?? null,
      }
    } catch (error) {
      return {
        ok: false,
        channel: 'sms',
        provider: 'sendafrica',
        status: 'failed',
        reason: error instanceof Error ? error.message : 'SendAfrica SMS delivery failed.',
      }
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

    if (config.smsProvider === 'twilio') {
      try {
        const result = await sendTwilioSms({
          to: payload.to,
          text: payload.message,
          from: config.smsSenderId,
        }, input)

        return {
          ok: true,
          provider: 'twilio',
          status: result.status,
          messageId: result.messageId ?? null,
        }
      } catch (error) {
        return {
          ok: false,
          provider: 'twilio',
          status: 'failed',
          reason: error instanceof Error ? error.message : 'Twilio SMS delivery failed.',
        }
      }
    }

    if (config.smsProvider === 'brevo') {
      try {
        const result = await sendBrevoSms({
          to: payload.to,
          text: payload.message,
          from: config.smsSenderId || config.senderName || 'Serve',
        }, input)

        return {
          ok: true,
          provider: 'brevo',
          status: result.status,
          messageId: result.messageId ?? null,
        }
      } catch (error) {
        return {
          ok: false,
          provider: 'brevo',
          status: 'failed',
          reason: error instanceof Error ? error.message : 'Brevo SMS delivery failed.',
        }
      }
    }

    if (config.smsProvider === 'sendafrica') {
      try {
        const result = await sendSendAfricaSms({
          to: payload.to,
          text: payload.message,
          from: config.smsSenderId || config.senderName || 'Serve',
        }, input)

        return {
          ok: true,
          provider: 'sendafrica',
          status: result.status,
          messageId: result.messageId ?? null,
        }
      } catch (error) {
        return {
          ok: false,
          provider: 'sendafrica',
          status: 'failed',
          reason: error instanceof Error ? error.message : 'SendAfrica SMS delivery failed.',
        }
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
