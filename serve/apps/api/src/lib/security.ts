import { createHash, pbkdf2Sync, randomBytes } from 'node:crypto'

const KEY_LENGTH = 64
const ITERATIONS = 100_000
const DIGEST = 'sha512'

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex')
  const hash = pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, storedPassword: string) {
  const [salt, hash] = storedPassword.split(':')
  if (!salt || !hash) {
    return false
  }

  const candidate = pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString('hex')
  return createHash('sha512').update(candidate).digest('hex') === createHash('sha512').update(hash).digest('hex')
}
