/** Step 2 of the payroll wizard: who gets paid and how much. */
import { useRef, useState } from 'react'
import { Plus, Trash2, Upload } from 'lucide-react'
import Button from '../ui/Button'
import { usdc } from '../../chain/format'
import { Field, Notice, TAP, errorInputStyle, inputStyle } from './formUi'
import {
  MAX_RECIPIENTS, isBlankRow, newRow, parsePasted, type ImportResult, type RecipientRow, type RowsCheck,
} from './payrollRows'

const MAX_FILE_BYTES = 512 * 1024

interface Props {
  rows: RecipientRow[]
  onChange: (rows: RecipientRow[]) => void
  result: RowsCheck
}

export default function RecipientsStep({ rows, onChange, result }: Props) {
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasted, setPasted] = useState('')
  const [note, setNote] = useState<{ tone: 'info' | 'warning'; text: string; skipped: string[] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const update = (id: string, field: 'name' | 'address' | 'amount', value: string) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)))

  const addImported = (imp: ImportResult) => {
    const base = rows.filter((r) => !isBlankRow(r))
    const room = MAX_RECIPIENTS - base.length
    const accepted = imp.rows.slice(0, Math.max(0, room))
    const dropped = imp.rows.length - accepted.length
    onChange(base.length + accepted.length === 0 ? [newRow()] : [...base, ...accepted])
    const parts = [`Added ${accepted.length} recipient${accepted.length === 1 ? '' : 's'}.`]
    if (dropped > 0) parts.push(`${dropped} not added because the limit is ${MAX_RECIPIENTS}.`)
    if (imp.skipped.length > 0) parts.push(`${imp.skipped.length} line${imp.skipped.length === 1 ? '' : 's'} skipped.`)
    setNote({ tone: dropped > 0 || imp.skipped.length > 0 || accepted.length === 0 ? 'warning' : 'info', text: parts.join(' '), skipped: imp.skipped.slice(0, 5) })
  }

  const onFile = (file: File | undefined) => {
    if (!file) return
    if (file.size > MAX_FILE_BYTES) {
      setNote({ tone: 'warning', text: 'That file is too large. A payroll CSV should be well under 512 KB.', skipped: [] })
      return
    }
    const reader = new FileReader()
    reader.onload = () => addImported(parsePasted(typeof reader.result === 'string' ? reader.result : ''))
    reader.onerror = () => setNote({ tone: 'warning', text: 'Could not read that file. Try pasting the lines instead.', skipped: [] })
    reader.readAsText(file)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>Who gets paid</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 14 }}>
            Up to {MAX_RECIPIENTS} recipients. The whole payroll is paid together or not at all.
          </p>
        </div>
        <div style={{ textAlign: 'right' }} aria-live="polite">
          <div style={{ fontSize: 11, color: 'var(--subtle)', fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            {rows.length} of {MAX_RECIPIENTS} recipients
          </div>
          <div className="display" style={{ fontSize: 24, fontWeight: 700 }}>{usdc(result.total)} USDC</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="secondary" className={TAP} arrow={false} icon={<span className="feature-icon"><Upload size={14} /></span>} onClick={() => setPasteOpen((v) => !v)} aria-expanded={pasteOpen}>
          Import from list or CSV
        </Button>
        <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain" hidden aria-label="Choose a CSV file"
               onChange={(e) => onFile(e.target.files?.[0])} />
        <Button variant="secondary" className={TAP} arrow={false} onClick={() => fileRef.current?.click()}>Choose a .csv file</Button>
      </div>

      {pasteOpen && (
        <div style={{ border: '1px solid var(--border)', padding: 14, background: 'var(--surface-muted)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Field label="Paste one recipient per line" htmlFor="payroll-paste"
                 hint="Format: name,address,amount. Example: Alice Chen,0x1234…abcd,1250.50. Spreadsheet columns pasted with tabs also work.">
            <textarea id="payroll-paste" rows={5} value={pasted} onChange={(e) => setPasted(e.target.value)}
                      style={{ ...inputStyle, fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }} spellCheck={false} />
          </Field>
          <div><Button className={TAP} arrow={false} disabled={!pasted.trim()} onClick={() => { addImported(parsePasted(pasted)); setPasted('') }}>Add these recipients</Button></div>
        </div>
      )}

      {note && (
        <Notice tone={note.tone}>
          {note.text}
          {note.skipped.length > 0 && <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{note.skipped.map((s) => <li key={s}>{s}</li>)}</ul>}
        </Notice>
      )}

      {rows.map((row, i) => {
        const c = result.checks[i]
        const blank = isBlankRow(row)
        const show = () => !blank
        const nameErr = c?.nameError
        const addrErr = c && show() ? c.addressError : undefined
        const amtErr = c && show() ? c.amountError : undefined
        return (
          <div key={row.id} style={{ border: '1px solid var(--border)', padding: 14, background: 'var(--surface)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span className="mono" style={{ fontSize: 11, color: 'var(--subtle)', letterSpacing: '0.1em' }}>RECIPIENT {String(i + 1).padStart(2, '0')}</span>
              <Button variant="ghost" size="sm" className="min-h-[44px] min-w-[44px]" arrow={false} icon={<span className="feature-icon"><Trash2 size={15} /></span>}
                      aria-label={`Remove recipient ${i + 1}`} disabled={rows.length === 1 && blank}
                      onClick={() => onChange(rows.length === 1 ? [newRow()] : rows.filter((r) => r.id !== row.id))} />
            </div>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))' }}>
              <Field label="Name (optional)" htmlFor={`n-${row.id}`} error={nameErr}>
                <input id={`n-${row.id}`} value={row.name} maxLength={80} autoComplete="off" placeholder="Alice Chen"
                       style={nameErr ? errorInputStyle : inputStyle} onChange={(e) => update(row.id, 'name', e.target.value)} />
              </Field>
              <Field label="Wallet address" htmlFor={`a-${row.id}`} error={addrErr}>
                <input id={`a-${row.id}`} value={row.address} autoComplete="off" spellCheck={false} placeholder="0x…" className="mono"
                       style={addrErr ? errorInputStyle : inputStyle} onChange={(e) => update(row.id, 'address', e.target.value)} />
              </Field>
              <Field label="Amount (USDC)" htmlFor={`m-${row.id}`} error={amtErr}>
                <input id={`m-${row.id}`} value={row.amount} inputMode="decimal" autoComplete="off" placeholder="500.00" className="mono"
                       style={amtErr ? errorInputStyle : inputStyle} onChange={(e) => update(row.id, 'amount', e.target.value)} />
              </Field>
            </div>
          </div>
        )
      })}

      <div>
        <Button variant="secondary" className={TAP} arrow={false} icon={<span className="feature-icon"><Plus size={14} /></span>} disabled={rows.length >= MAX_RECIPIENTS}
                onClick={() => onChange([...rows, newRow()])}>Add recipient</Button>
        {rows.length >= MAX_RECIPIENTS && <span style={{ marginLeft: 12, fontSize: 13, color: 'var(--muted)' }}>Limit of {MAX_RECIPIENTS} reached.</span>}
      </div>
      <div aria-live="polite" style={{ fontSize: 13, color: result.allValid ? 'var(--success)' : 'var(--muted)' }}>
        {result.allValid
          ? `All ${rows.length} recipient${rows.length === 1 ? '' : 's'} look valid.`
          : result.problem ?? `${result.checks.filter((c) => c.valid).length} of ${rows.length} rows are complete. Fill in or remove the others to continue.`}
      </div>
    </div>
  )
}
