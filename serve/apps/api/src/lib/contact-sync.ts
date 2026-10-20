export type ContactImportRow = {
  name: string
  email?: string | null
  phone?: string | null
  status?: string
  consent?: string
}

export function normalizePhone(value?: string | null) {
  if (!value) return null
  const digits = value.replace(/\D/g, '')
  if (!digits) return null
  return `+${digits}`
}

export function normalizeEmail(value?: string | null) {
  if (!value) return null
  const email = value.trim().toLowerCase()
  return email || null
}

export function normalizeContactRow(row: ContactImportRow) {
  const name = row.name.trim()
  const email = normalizeEmail(row.email)
  const phone = normalizePhone(row.phone)
  const consent = ['opted_in', 'opted_out', 'unknown'].includes((row.consent ?? '').toLowerCase())
    ? (row.consent ?? '').toLowerCase()
    : 'unknown'

  return {
    name,
    email,
    phone,
    status: row.status && row.status.trim() ? row.status.trim() : 'active',
    consent,
  }
}

export function mergeContactRows(rows: Array<ContactImportRow>) {
  const normalized = rows.map(normalizeContactRow)
  const deduped = new Map<string, typeof normalized[number]>()

  for (const row of normalized) {
    const key = row.email ?? row.phone ?? row.name
    const current = deduped.get(key)

    if (!current) {
      deduped.set(key, row)
      continue
    }

    deduped.set(key, {
      ...current,
      name: current.name || row.name,
      email: current.email || row.email || null,
      phone: current.phone || row.phone || null,
      consent: current.consent === 'unknown' && row.consent !== 'unknown' ? row.consent : current.consent,
      status: current.status || row.status || 'active',
    })
  }

  return Array.from(deduped.values())
}
