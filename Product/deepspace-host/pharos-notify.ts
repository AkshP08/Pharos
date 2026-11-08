import type { ResidentAlert } from './pharos-domain'

export interface SmsConfig {
  enabled?: string
  projectId?: string
  apiKey?: string
  senderId?: string
  senderNumber?: string
  recipient?: string
}

export type SmsOutcome = { status: 'not-configured' | 'accepted' | 'failed'; reason?: string }

/** One fixed, opted-in test recipient. Never accepts a recipient from a public request. */
export async function sendWarningSms(alert: ResidentAlert, config: SmsConfig, fetcher: typeof fetch = fetch): Promise<SmsOutcome> {
  if (config.enabled !== 'true' || !config.apiKey || !config.projectId || !config.recipient || (!config.senderId && !config.senderNumber)) return { status: 'not-configured' }
  const e164 = /^\+[1-9]\d{7,14}$/
  if (!/^pho_prj_[a-zA-Z0-9]+$/.test(config.projectId) || !e164.test(config.recipient) || (config.senderNumber && !e164.test(config.senderNumber))) return { status: 'failed', reason: 'invalid-configuration' }
  const base = `https://api.photon.codes/v1/projects/${config.projectId}`
  async function post(path: string, body: object, operation: string): Promise<{ id: string; status?: string }> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let response: Response
      try {
        response = await fetcher(`${base}${path}`, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
          headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `${alert.id}:${operation}` },
          body: JSON.stringify(body),
        })
      } catch {
        if (attempt === 2) throw new Error('provider-unavailable')
        await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)))
        continue
      }
      if (!response.ok) {
        if ((response.status === 429 || response.status >= 500) && attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)))
          continue
        }
        throw new Error(`provider-${response.status}`)
      }
      const value = await response.json() as { id?: unknown; status?: unknown }
      if (typeof value.id !== 'string' || !value.id) throw new Error('invalid-provider-response')
      return { id: value.id, status: typeof value.status === 'string' ? value.status : undefined }
    }
    throw new Error('provider-unavailable')
  }

  try {
    const senderId = config.senderId || (await post('/users', { platform: 'sms', handle: config.senderNumber }, 'sender')).id
    const recipient = await post('/users', { platform: 'sms', handle: config.recipient }, 'recipient')
    const space = await post('/spaces', { platform: 'sms', participantIds: [senderId, recipient.id] }, 'space')
    // ASCII and under 160 characters: avoid accidental multipart charges or private transcript snippets.
    const text = 'Pharos: Possible scam pressure detected. Pause payments and do not share codes. Verify using an official number found independently.'
    const message = await post('/messages', { spaceId: space.id, senderId, content: { type: 'text', format: 'plain', text } }, 'warning')
    return message.status === 'failed' ? { status: 'failed', reason: 'provider-rejected-message' } : { status: 'accepted' }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    return { status: 'failed', reason: /^provider-\d+$/.test(message) ? message : 'delivery-unavailable' }
  }
}
