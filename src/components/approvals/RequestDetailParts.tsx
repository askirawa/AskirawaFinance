import { useState, type ReactNode } from 'react'
import { useHistory } from '../../chain/history'
import { useLabels } from '../../chain/addressBook'
import { addressUrl } from '../../chain/config'
import { dateTime, timeLeft, usdc } from '../../chain/format'
import type { PayrollLine, RequestView } from '../../chain/hooks'
import type { ScheduleTerms } from '../../chain/decode'
import { ExplorerLink, Who } from '../flow/shared'
import { frequencyText, utc } from './requestHelpers'

const LABEL: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--subtle)',
}

export function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section style={{ marginTop: 24 }}>
      <h3 style={{ ...LABEL, margin: '0 0 10px', fontWeight: 500 }}>{label}</h3>
      {children}
    </section>
  )
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '10px 0', borderBottom: '1px solid var(--border)', fontSize: 14, flexWrap: 'wrap' }}>
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span style={{ color: 'var(--ink)', textAlign: 'right', minWidth: 0, overflowWrap: 'anywhere' }}>{children}</span>
    </div>
  )
}

export function PayrollTable({ lines, total }: { lines: PayrollLine[]; total: bigint }) {
  const { nameOf } = useLabels()
  return (
    <div className="table-scroll" style={{ border: '1px solid var(--border)' }}>
      <table>
        <thead><tr><th>Name</th><th>Wallet address</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
        <tbody>
          {lines.map((l, i) => {
            const name = nameOf(l.to)
            return (
              <tr key={`${l.to}-${i}`}>
                <td style={{ color: name ? 'var(--ink)' : 'var(--subtle)' }}>{name ?? 'Unnamed'}</td>
                <td><a href={addressUrl(l.to)} target="_blank" rel="noopener noreferrer" className="mono" style={{ fontSize: 12, color: 'inherit', overflowWrap: 'anywhere', wordBreak: 'break-all' }}>{l.to}</a></td>
                <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{usdc(l.amount)}</td>
              </tr>
            )
          })}
          <tr>
            <td colSpan={2} style={{ fontWeight: 600, color: 'var(--ink)' }}>Total ({lines.length} {lines.length === 1 ? 'payment' : 'payments'})</td>
            <td className="mono" style={{ textAlign: 'right', fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap' }}>{usdc(total)} USDC</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

export function ScheduleTermsView({ s, funding }: { s: ScheduleTerms; funding: bigint }) {
  const none = '0x0000000000000000000000000000000000000000'
  return (
    <div>
      <Row label="Recipient"><Who address={s.recipient} /></Row>
      <Row label="Amount each time">{usdc(s.amount)} USDC</Row>
      <Row label="How often">{frequencyText(s.frequency)}</Row>
      <Row label="Starts (UTC)">{utc(s.startTime)}</Row>
      <Row label="Ends (UTC)">{s.endTime > 0n ? utc(s.endTime) : 'No end date'}</Row>
      {s.maxExecutions > 0 && <Row label="Maximum payments">{s.maxExecutions}</Row>}
      {s.maxTotal > 0n && <Row label="Maximum total">{usdc(s.maxTotal)} USDC</Row>}
      {s.minTreasuryBalanceAfter > 0n && <Row label="Treasury must keep at least">{usdc(s.minTreasuryBalanceAfter)} USDC</Row>}
      {s.executor.toLowerCase() !== none && <Row label="Only this wallet can run payments"><Who address={s.executor} /></Row>}
      {funding > 0n && <Row label="Funds set aside with this request">{usdc(funding)} USDC</Row>}
    </div>
  )
}

function Step({ title, text, done }: { title: string; text: string; done: boolean }) {
  return (
    <li style={{ display: 'flex', gap: 12, padding: '10px 0', alignItems: 'flex-start' }}>
      <span aria-hidden style={{ width: 12, height: 12, marginTop: 4, flexShrink: 0, border: '1px solid var(--ink)', background: done ? 'var(--ink)' : 'transparent' }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{title}</div>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>{text}</div>
      </div>
    </li>
  )
}

export function Timeline({ r }: { r: RequestView }) {
  const [now] = useState(() => Math.floor(Date.now() / 1000))
  const open = r.status >= 1 && r.status <= 3
  const quorumReached = r.approvedAt > 0n && r.executableAt > 0n
  const waitText = quorumReached
    ? (Number(r.executableAt) > now ? `Ends ${dateTime(r.executableAt)} (in ${timeLeft(r.executableAt, now)})` : `Finished ${dateTime(r.executableAt)}`)
    : r.status === 1 ? 'Starts once enough approvers approve.' : 'Not reached.'
  const isPayroll = r.action === 1
  const payText = !isPayroll
    ? (r.status === 4 ? 'Registered on-chain. No payment has been made by this step.' : r.status === 3 ? 'Ready to start. Anyone can trigger it. It does not pay anyone.' : r.status >= 5 ? 'Nothing was started.' : 'Not started yet.')
    : r.status === 4 ? 'Payment confirmed on-chain.' : r.status === 3 ? 'Ready to pay. Anyone can trigger it.' : r.status >= 5 ? 'Nothing was paid.' : 'Not paid yet.'
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      <Step title="Submitted" text={dateTime(r.createdAt)} done />
      <Step title="Approvals" text={`${r.approvals} of ${r.quorum} received${r.rejections > 0 ? `, ${r.rejections} rejected` : ''}`} done={r.approvals >= r.quorum} />
      <Step title="Safety wait" text={waitText} done={quorumReached && Number(r.executableAt) <= now} />
      <Step title="Payment" text={payText} done={r.status === 4} />
      <Step title={open ? 'Must be completed before' : 'Deadline'} text={open ? `${dateTime(r.expiresAt)} (in ${timeLeft(r.expiresAt, now)})` : dateTime(r.expiresAt)} done={false} />
    </ol>
  )
}

function HistoryReceipt({ requestId }: { requestId: number }) {
  const h = useHistory()
  const item = h.items.find((i) => i.kind === 'payment' && i.requestId === requestId)
  if (item) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 14 }}>{item.timestamp ? `Paid ${dateTime(item.timestamp)}.` : 'Paid.'} {item.amount !== undefined && item.amount > 0n ? `${usdc(item.amount)} USDC sent.` : ''}</span>
        <ExplorerLink hash={item.txHash} />
      </div>
    )
  }
  if (!h.complete && !h.error) return <span style={{ fontSize: 14, color: 'var(--muted)' }}>Looking for the receipt in recent activity…</span>
  return (
    <span style={{ fontSize: 14, color: 'var(--muted)' }}>
      {h.limited ? 'The receipt was not found in the recent activity that was scanned (deployment block not configured).' : 'The receipt could not be found in the treasury activity.'}
    </span>
  )
}

/** Receipt for a paid request: the transaction we just confirmed, or the Executed event found in history. */
export function PaymentReceipt({ requestId, hash }: { requestId: number; hash?: string }) {
  return (
    <Section label="Receipt">
      {hash ? <ExplorerLink hash={hash} /> : <HistoryReceipt requestId={requestId} />}
    </Section>
  )
}
