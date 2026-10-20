import test from 'node:test'
import assert from 'node:assert/strict'

import { getProviderStatus, getProviderConfig, type ProviderStatusSummary, dispatchCampaignMessage } from './providers.js'

test('returns a truthful status when email is configured and SMS is not', () => {
  const config = {
    BREVO_API_KEY: 'test-key',
    BREVO_SENDER_EMAIL: 'hello@example.com',
    BREVO_SENDER_NAME: 'Example Business',
    SMS_PROVIDER: '',
    SMS_API_KEY: '',
    SMS_SENDER_ID: '',
  }

  const status = getProviderStatus(config)
  const summary: ProviderStatusSummary = {
    email: { status: 'configured', provider: 'brevo', sender: 'hello@example.com' },
    sms: {
      status: 'not_configured',
      provider: null,
      sender: null,
      message: 'No valid SMS provider is configured. Messaging is disabled until an approved provider is connected.',
    },
    isFullyConfigured: false,
  }

  assert.deepEqual(status, summary)
  assert.equal(getProviderConfig(config).emailConfigured, true)
})

test('dispatches through the configured channel and rejects unconfigured ones', async () => {
  const unconfiguredEmail = await dispatchCampaignMessage({
    channel: 'email',
    to: 'hello@example.com',
    subject: 'Welcome',
    text: 'Hello there',
  }, {
    BREVO_API_KEY: '',
    BREVO_SENDER_EMAIL: '',
    BREVO_SENDER_NAME: '',
    SMS_PROVIDER: '',
    SMS_API_KEY: '',
    SMS_SENDER_ID: '',
  })

  assert.equal(unconfiguredEmail.status, 'not_configured')

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    assert.match(url, /api.sendafrica.com\/v1\/sms\/send/)
    assert.equal(init?.method, 'POST')

    const headers = new Headers(init?.headers)
    assert.match(headers.get('Authorization') ?? '', /Bearer /)

    return new Response(JSON.stringify({ id: 'SA-123456' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const configuredSms = await dispatchCampaignMessage({
      channel: 'sms',
      to: '+254712345678',
      text: 'Reminder',
    }, {
      BREVO_API_KEY: '',
      BREVO_SENDER_EMAIL: '',
      BREVO_SENDER_NAME: '',
      SMS_PROVIDER: 'sendafrica',
      SENDAFRICA_API_KEY: 'sendafrica-key',
      SMS_API_KEY: 'sendafrica-key',
      SMS_SENDER_ID: 'Mabrixel',
    })

    assert.equal(configuredSms.provider, 'sendafrica')
    assert.equal(configuredSms.status, 'sent')
    assert.equal(configuredSms.messageId, 'SA-123456')
  } finally {
    globalThis.fetch = originalFetch
  }
})
