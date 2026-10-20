import test from 'node:test'
import assert from 'node:assert/strict'

import { buildAiFallbackReply, generateChatbotReply } from './ai.js'

test('builds a helpful fallback response with real tenant context', () => {
  const result = buildAiFallbackReply('Help me create a promotion', {
    tenantName: 'Northwind',
    contactsCount: 42,
    campaignsCount: 3,
    messageLogsCount: 8,
    recentCampaigns: [{ name: 'Welcome blast', channel: 'email', status: 'sent' }],
  })

  assert.match(result, /Northwind/)
  assert.match(result, /42/)
})

test('falls back to server-side guidance when no AI key is configured', async () => {
  const result = await generateChatbotReply({
    message: 'How should I import contacts?',
    context: {
      tenantName: 'Northwind',
      contactsCount: 12,
      campaignsCount: 1,
      messageLogsCount: 4,
      recentCampaigns: [{ name: 'Welcome', channel: 'email', status: 'sent' }],
    },
  })

  assert.equal(result.mode, 'fallback')
  assert.match(result.answer, /12|contacts/i)
})
