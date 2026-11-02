/** Recipient rows: parsing, validation and CSV import for the payroll wizard. Pure functions, no network. */
import { getAddress, isAddress, zeroAddress, type Address } from 'viem'
import { AmountError, parseUsdc } from '../../onchain-money'

export const MAX_RECIPIENTS = 100
export const MAX_UINT96 = (1n << 96n) - 1n
const NAME_MAX = 60

export interface RecipientRow { id: string; name: string; address: string; amount: string }

let counter = 0
export function newRow(partial: Partial<Omit<RecipientRow, 'id'>> = {}): RecipientRow {
  counter += 1
  return { id: `r${Date.now().toString(36)}${counter}`, name: '', address: '', amount: '', ...partial }
}

export function parseAmount(text: string, max: bigint = MAX_UINT96): { value?: bigint; error?: string } {
  if (!text.trim()) return { error: 'Enter an amount.' }
  let value: bigint
  try {
    value = parseUsdc(text)
  } catch (e) {
    if (e instanceof AmountError && e.code === 'TOO_MANY_FRACTION_DIGITS') return { error: 'USDC allows at most 6 decimal places.' }
    return { error: 'Enter a plain number such as 1250.50 (digits and one dot only).' }
  }
  if (value <= 0n) return { error: 'The amount must be greater than zero.' }
  if (value > max) return { error: 'This amount is too large.' }
  return { value }
}

export function checkAddress(text: string, blocked: { address: string | null; message: string }[] = []): { address?: Address; error?: string } {
  const t = text.trim()
  if (!t) return { error: 'Enter a wallet address.' }
  if (!isAddress(t)) return { error: 'Not a valid wallet address. It starts with 0x and has 42 characters (mixed upper and lower case must have the correct checksum).' }
  const address = getAddress(t)
  if (address === zeroAddress) return { error: 'The zero address cannot receive payments.' }
  for (const b of blocked) {
    if (b.address && b.address.toLowerCase() === address.toLowerCase()) return { error: b.message }
  }
  return { address }
}

export interface RowCheck {
  nameError?: string
  addressError?: string
  amountError?: string
  valid: boolean
  to?: Address
  raw?: bigint
}

export interface RowsCheck {
  checks: RowCheck[]
  total: bigint
  allValid: boolean
  /** Overall problem that is not tied to one row. */
  problem?: string
}

export function checkRows(rows: RecipientRow[], treasury: string | null): RowsCheck {
  const seen = new Map<string, number>()
  let total = 0n
  const checks = rows.map((row, index): RowCheck => {
    const out: RowCheck = { valid: false }
    if (row.name.trim().length > NAME_MAX) out.nameError = `Keep names under ${NAME_MAX} characters.`
    const a = checkAddress(row.address, [{ address: treasury, message: 'This is the treasury itself. Choose an outside wallet.' }])
    if (a.error) out.addressError = a.error
    else if (a.address) {
      const key = a.address.toLowerCase()
      const first = seen.get(key)
      if (first !== undefined) out.addressError = `Same wallet as row ${first + 1}. Combine them into one amount.`
      else { seen.set(key, index); out.to = a.address }
    }
    const m = parseAmount(row.amount)
    if (m.error) out.amountError = m.error
    else if (m.value !== undefined) { out.raw = m.value; total += m.value }
    out.valid = !out.nameError && !out.addressError && !out.amountError && !!out.to && out.raw !== undefined
    return out
  })
  let problem: string | undefined
  if (rows.length === 0) problem = 'Add at least one recipient.'
  else if (rows.length > MAX_RECIPIENTS) problem = `A payroll can have at most ${MAX_RECIPIENTS} recipients.`
  else if (total > MAX_UINT96) problem = 'The total is larger than one payroll can hold.'
  return { checks, total, allValid: !problem && checks.every((c) => c.valid), problem }
}

function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++ } else quoted = !quoted
    } else if (ch === delimiter && !quoted) {
      out.push(cur.trim()); cur = ''
    } else cur += ch
  }
  out.push(cur.trim())
  return out
}

export interface ImportResult { rows: RecipientRow[]; skipped: string[] }

/** Accepts lines of "name,address,amount" (comma, semicolon or tab separated). A header line is ignored. */
export function parsePasted(text: string): ImportResult {
  const rows: RecipientRow[] = []
  const skipped: string[] = []
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  let headerChecked = false
  lines.forEach((line, i) => {
    if (!line.trim()) return
    const delimiter = line.includes('\t') ? '\t' : line.includes(',') ? ',' : line.includes(';') ? ';' : ','
    const cols = splitLine(line, delimiter)
    if (!headerChecked) {
      headerChecked = true
      if (cols.some((c) => /^(wallet\s*)?address$/i.test(c))) return
    }
    if (cols.length === 3) rows.push(newRow({ name: cols[0], address: cols[1], amount: cols[2] }))
    else if (cols.length === 2 && cols[0].toLowerCase().startsWith('0x')) rows.push(newRow({ address: cols[0], amount: cols[1] }))
    else skipped.push(`Line ${i + 1}: expected name,address,amount`)
  })
  return { rows, skipped }
}

export function isBlankRow(r: RecipientRow): boolean {
  return !r.name.trim() && !r.address.trim() && !r.amount.trim()
}
