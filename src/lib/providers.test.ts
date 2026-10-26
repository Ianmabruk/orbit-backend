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

test('treats invalid Brevo sender emails as unconfigured', () => {
  const status = getProviderStatus({
    BREVO_API_KEY: 'test-key',
    BREVO_SENDER_EMAIL: 'mabrixel tech',
    BREVO_SENDER_NAME: 'Serve Platform',
    SMS_PROVIDER: '',
    SMS_API_KEY: '',
    SMS_SENDER_ID: '',
  })

  assert.equal(status.email.status, 'not_configured')
  assert.equal(status.email.provider, null)
  assert.equal(getProviderConfig({ BREVO_API_KEY: 'test-key', BREVO_SENDER_EMAIL: 'mabrixel tech' }).emailConfigured, false)
})

test('accepts Mailtrap configuration when EMAIL_PROVIDER is mailtrap', () => {
  const status = getProviderStatus({
    EMAIL_PROVIDER: 'mailtrap',
    MAILTRAP_API_KEY: 'test-key',
    MAILTRAP_SENDER_EMAIL: 'hello@example.com',
    MAILTRAP_SENDER_NAME: 'Serve Platform',
    SMS_PROVIDER: '',
    SMS_API_KEY: '',
    SMS_SENDER_ID: '',
  })

  assert.equal(status.email.status, 'configured')
  assert.equal(status.email.provider, 'mailtrap')
  assert.equal(getProviderConfig({
    EMAIL_PROVIDER: 'mailtrap',
    MAILTRAP_API_KEY: 'test-key',
    MAILTRAP_SENDER_EMAIL: 'hello@example.com',
  }).emailConfigured, true)
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

  const configuredSms = await dispatchCampaignMessage({
    channel: 'sms',
    to: '+15551234567',
    text: 'Reminder',
  }, {
    BREVO_API_KEY: '',
    BREVO_SENDER_EMAIL: '',
    BREVO_SENDER_NAME: '',
    SMS_PROVIDER: 'twilio',
    SMS_API_KEY: 'secret',
    SMS_SENDER_ID: 'Serve',
  })

  assert.equal(configuredSms.provider, 'twilio')
  assert.equal(configuredSms.status, 'sent')
})
