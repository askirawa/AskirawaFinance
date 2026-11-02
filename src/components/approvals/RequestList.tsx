import type { KeyboardEvent, ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { ACTION_LABEL, dateTime } from '../../chain/format'
import type { RequestView } from '../../chain/hooks'
import { useLabels } from '../../chain/addressBook'
import { ApprovalMeter, RequestStatus, Who } from '../flow/shared'
import { RecipientCell, amountParts, resumeLabel, thresholdText } from './requestHelpers'

interface Props {
  requests: RequestView[]
  approverCount: number
  selectedId: number | null
  onOpen: (id: number) => void
}

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()
const activate = (fn: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    fn()
  }
}

function ApprovalCell({ r, approverCount }: { r: RequestView; approverCount: number }) {
  return (
    <div style={{ minWidth: 130 }}>
      <ApprovalMeter approvals={r.approvals} quorum={r.quorum} open={r.status === 1} />
      <div style={{ fontSize: 12, color: 'var(--subtle)', marginTop: 2 }}>Requires {thresholdText(r, approverCount)}</div>
    </div>
  )
}

function Title({ r }: { r: RequestView }) {
  const { titleOf } = useLabels()
  const title = titleOf(r.memoRef)
  return (
    <div>
      <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{resumeLabel(r) ?? ACTION_LABEL[r.action] ?? 'Request'}</div>
      {title && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{title}</div>}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, alignItems: 'baseline' }}>
      <span style={{ color: 'var(--subtle)', flexShrink: 0 }}>{label}</span>
      <span style={{ textAlign: 'right', minWidth: 0, overflowWrap: 'anywhere' }}>{children}</span>
    </div>
  )
}

export default function RequestList({ requests, approverCount, selectedId, onOpen }: Props) {
  return (
    <>
      <div className="hidden sm:block" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Payment</th><th>Recipient</th><th>Total</th><th>Submitted by</th>
                <th>Approvals</th><th>Status</th><th><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => {
                const amt = amountParts(r)
                return (
                  <tr key={r.id} id={`request-row-${r.id}`} onClick={() => onOpen(r.id)} style={{ cursor: 'pointer', outline: selectedId === r.id ? '1px solid var(--ink)' : 'none', outlineOffset: -1 }}>
                    <td><Title r={r} /></td>
                    <td style={{ whiteSpace: 'nowrap' }}><span onClick={stop}><RecipientCell r={r} /></span></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <div className="mono" style={{ color: 'var(--ink)' }}>{amt.main}</div>
                      {amt.sub && <div style={{ fontSize: 12, color: 'var(--subtle)' }}>{amt.sub}</div>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <div>{dateTime(r.createdAt)}</div>
                      <div style={{ fontSize: 12, color: 'var(--subtle)' }}><span onClick={stop}><Who address={r.proposer} /></span></div>
                    </td>
                    <td><ApprovalCell r={r} approverCount={approverCount} /></td>
                    <td><RequestStatus status={r.status} action={r.action} /></td>
                    <td>
                      <button type="button" onClick={(e) => { stop(e); onOpen(r.id) }} aria-label={`Open request ${r.id}`}
                              style={{ minHeight: 44, minWidth: 44, background: 'transparent', border: '1px solid var(--border-strong)', color: 'var(--ink)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: 0 }}>
                        <ChevronRight size={16} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="sm:hidden flex flex-col gap-3">
        {requests.map((r) => {
          const amt = amountParts(r)
          return (
            <div key={r.id} id={`request-card-${r.id}`} role="button" tabIndex={0} aria-label={`Open ${ACTION_LABEL[r.action] ?? 'request'}`}
                 onClick={() => onOpen(r.id)} onKeyDown={activate(() => onOpen(r.id))}
                 style={{ background: 'var(--surface)', border: `1px solid ${selectedId === r.id ? 'var(--ink)' : 'var(--border)'}`, padding: 16, display: 'flex', flexDirection: 'column', gap: 10, cursor: 'pointer', minHeight: 44 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                <Title r={r} />
                <RequestStatus status={r.status} action={r.action} />
              </div>
              <div className="display" style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)' }}>
                {amt.main}{amt.sub && <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--subtle)', marginLeft: 8 }}>{amt.sub}</span>}
              </div>
              <Field label="To"><span onClick={stop}><RecipientCell r={r} /></span></Field>
              <Field label="Who"><span onClick={stop}><Who address={r.proposer} /></span></Field>
              <Field label="Submitted">{dateTime(r.createdAt)}</Field>
              <ApprovalCell r={r} approverCount={approverCount} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4, color: 'var(--ink)', fontSize: 13, minHeight: 28 }}>
                Review <ChevronRight size={14} />
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
