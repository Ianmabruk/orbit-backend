import test from 'node:test'
import assert from 'node:assert/strict'

import { getProviderStatus, getProviderConfig, dispatchCampaignMessage } from './providers.js'

test('returns configured when MailerSend token and sender are present', () => {
  const config = {
    MAILERSEND_API_TOKEN: 'test-token',
    MAILERSEND_FROM_EMAIL: 'hello@example.com',
    MAILERSEND_FROM_NAME: 'Example Business',
  }

  const status = getProviderStatus(config)
  assert.equal(status.email.status, 'configured')
  assert.equal(status.email.provider, 'mailersend')
  assert.equal(status.email.sender, 'hello@example.com')
  assert.equal(status.isFullyConfigured, true)
  assert.equal(getProviderConfig(config).emailConfigured, true)
})

test('SMS is not configured because MailerSend does not support SMS', () => {
  const status = getProviderStatus({
    MAILERSEND_API_TOKEN: 'test-token',
    MAILERSEND_FROM_EMAIL: 'hello@example.com',
    MAILERSEND_FROM_NAME: 'Example Business',
  })
  assert.equal(status.sms.status, 'not_configured')
})

test('dispatches email through MailerSend and rejects SMS', async () => {
  const unconfigured = await dispatchCampaignMessage({
    channel: 'email',
    to: 'hello@example.com',
    subject: 'Welcome',
    text: 'Hello there',
  }, {
    MAILERSEND_API_TOKEN: '',
    MAILERSEND_FROM_EMAIL: '',
    MAILERSEND_FROM_NAME: '',
  })

  assert.equal(unconfigured.status, 'not_configured')

  const smsResult = await dispatchCampaignMessage({
    channel: 'sms',
    to: '+254712345678',
    text: 'Reminder',
  }, {
    MAILERSEND_API_TOKEN: 'test-token',
    MAILERSEND_FROM_EMAIL: 'hello@example.com',
    MAILERSEND_FROM_NAME: 'Example Business',
  })

  assert.equal(smsResult.status, 'not_configured')

  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(null, {
      status: 202,
      headers: { 'x-message-id': 'MS-123456' },
    })

  try {
    const configuredEmail = await dispatchCampaignMessage({
      channel: 'email',
      to: 'hello@example.com',
      subject: 'Welcome',
      text: 'Reminder',
    }, {
      MAILERSEND_API_TOKEN: 'test-token',
      MAILERSEND_FROM_EMAIL: 'hello@example.com',
      MAILERSEND_FROM_NAME: 'Example Business',
    })

    assert.equal(configuredEmail.provider, 'mailersend')
    assert.equal(configuredEmail.status, 'sent')
    assert.equal(configuredEmail.messageId, 'MS-123456')
  } finally {
    globalThis.fetch = originalFetch
  }
})
