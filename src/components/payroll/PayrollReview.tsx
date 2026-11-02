/** Step 3 of the payroll wizard: everything the approvers will see, plus a dry run against the contract. */
import { useMemo } from 'react'
import type { Address } from 'viem'
import { treasuryAbi } from '../../chain/abi'
import { TREASURY_ADDRESS } from '../../chain/config'
import { memoRefFor } from '../../chain/addressBook'
import type { TreasuryOverview } from '../../chain/hooks'
import { usdc } from '../../chain/format'
import { Facts, Notice, approvalWindowDays, plainDuration } from './formUi'
import Preflight, { deadlineFor, type PreflightCheck } from './Preflight'
import type { RecipientRow, RowsCheck } from './payrollRows'

interface Props {
  name: string
  rows: RecipientRow[]
  result: RowsCheck
  overview: TreasuryOverview
}

export default function PayrollReview({ name, rows, result, overview }: Props) {
  const payments = useMemo(
    () => result.checks.map((c) => ({ to: c.to as Address, amount: c.raw as bigint })),
    [result.checks],
  )
  const short = result.total > overview.balance
  const depsKey = `${name}|${overview.payrollDelay}|${payments.map((p) => `${p.to}:${p.amount}`).join(',')}`

  const check: PreflightCheck = async ({ client, account }) => {
    const expiresAt = await deadlineFor(client, overview.payrollDelay)
    await client.simulateContract({
      account,
      address: TREASURY_ADDRESS as Address,
      abi: treasuryAbi,
      functionName: 'proposePayroll',
      args: [payments, expiresAt, memoRefFor(name)],
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 18 }}>Review the payroll</h2>
        <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 14 }}>Nothing is sent until the last step. Check every line.</p>
      </div>

      <Facts items={[
        { label: 'Payroll', value: name.trim() },
        { label: 'Recipients', value: String(rows.length) },
        { label: 'Total to pay', value: `${usdc(result.total)} USDC` },
        { label: 'Treasury balance now', value: `${usdc(overview.balance)} USDC` },
        short
          ? { label: 'Shortfall', value: `${usdc(result.total - overview.balance)} USDC`, tone: 'danger' as const }
          : { label: 'Left after payroll', value: `${usdc(overview.balance - result.total)} USDC` },
      ]} />

      {short && (
        <Notice tone="warning" title="The treasury currently holds less than this payroll">
          You can still request approval, but the payment will fail until the treasury holds at least {usdc(result.total)} USDC at the moment it is paid. Add funds before the payment is made.
        </Notice>
      )}
      {overview.paused && (
        <Notice tone="warning" title="The treasury is paused">Requests can be created, but no payment can be made until the treasury is resumed.</Notice>
      )}

      <div className="table-scroll" style={{ border: '1px solid var(--border)' }}>
        <table style={{ minWidth: 520 }}>
          <thead><tr><th>#</th><th>Name</th><th>Wallet address</th><th style={{ textAlign: 'right' }}>Amount (USDC)</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td className="mono" style={{ color: 'var(--subtle)' }}>{i + 1}</td>
                <td>{r.name.trim() || <span style={{ color: 'var(--subtle)' }}>No name</span>}</td>
                <td className="mono" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{result.checks[i].to}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{usdc(result.checks[i].raw ?? 0n)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={3} style={{ fontWeight: 600 }}>Total</td><td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{usdc(result.total)}</td></tr>
          </tfoot>
        </table>
      </div>

      <div style={{ border: '1px solid var(--border)', padding: 16, background: 'var(--surface)' }}>
        <strong style={{ display: 'block', marginBottom: 8 }}>What happens next</strong>
        <ol style={{ margin: 0, paddingLeft: 20, color: 'var(--ink-2)', fontSize: 14, lineHeight: 1.7 }}>
          <li>You send the request. Nobody is paid yet.</li>
          <li>It needs a quorum of {overview.quorum || '…'} approvers. If you are an approver, your own approval is counted automatically.</li>
          <li>Approvers have {approvalWindowDays(overview.payrollDelay)} days to approve. After that the request expires and nothing is paid.</li>
          <li>After approval there is a safety wait of {plainDuration(overview.payrollDelay)}.</li>
          <li>Then anyone can trigger the payment. It is all-or-nothing: either all {rows.length} recipients are paid or none.</li>
        </ol>
      </div>

      <Preflight check={check} deps={depsKey} okText="This is a dry run. Approvers still have to approve before any money moves." />
    </div>
  )
}
