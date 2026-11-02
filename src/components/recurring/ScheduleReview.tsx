/** Step 3 of the recurring payment wizard. */
import type { Address } from 'viem'
import { treasuryAbi } from '../../chain/abi'
import { TREASURY_ADDRESS } from '../../chain/config'
import type { TreasuryOverview } from '../../chain/hooks'
import { FREQUENCY_LABEL, shortAddress, usdc } from '../../chain/format'
import { Facts, Notice, approvalWindowDays, plainDuration } from '../payroll/formUi'
import Preflight, { deadlineFor, type PreflightCheck } from '../payroll/Preflight'
import { previewDates, utcLabel } from './preview'
import { scheduleCallArgs, type Budget, type ScheduleChecks, type ScheduleForm } from './scheduleForm'

interface Props { form: ScheduleForm; checks: ScheduleChecks; overview: TreasuryOverview; budget: Budget }

export default function ScheduleReview({ form, checks, overview, budget }: Props) {
  const amount = checks.amountRaw ?? 0n
  const dates = previewDates(checks.startTime ?? 0, form.frequency, 3, checks.endTime)
  const recipientLabel = form.recipientName.trim() ? `${form.recipientName.trim()} (${shortAddress(checks.recipient ?? '')})` : shortAddress(checks.recipient ?? '')
  const depsKey = [form.frequency, form.scheduleName, checks.recipient, checks.amountRaw, checks.startTime, checks.endTime, overview.payrollDelay].join('|')

  const check: PreflightCheck = async ({ client, account }) => {
    const expiresAt = await deadlineFor(client, overview.payrollDelay)
    await client.simulateContract({
      account,
      address: TREASURY_ADDRESS as Address,
      abi: treasuryAbi,
      functionName: 'proposeModuleAction',
      args: scheduleCallArgs(checks, form.frequency, form.scheduleName, expiresAt),
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 18 }}>Review the recurring payment</h2>
        <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 14 }}>Nothing is sent until the last step.</p>
      </div>
      <Facts items={[
        ...(form.scheduleName.trim() ? [{ label: 'Name', value: form.scheduleName.trim() }] : []),
        { label: 'Recipient', value: recipientLabel },
        { label: 'Amount per payment', value: `${usdc(amount)} USDC` },
        { label: 'How often', value: FREQUENCY_LABEL[form.frequency] },
        { label: 'Starts', value: checks.startTime ? utcLabel(checks.startTime) : '' },
        { label: 'Ends', value: checks.endTime ? `on ${form.endDate} (UTC)` : 'No end date' },
        { label: 'Approvals needed', value: `Quorum of ${overview.quorum || '…'} approvers` },
        ...(budget.perTxMax !== null ? [{ label: 'Treasury limit per payment', value: `${usdc(budget.perTxMax)} USDC` }] : []),
      ]} />

      <div style={{ border: '1px solid var(--border)', padding: 16, background: 'var(--surface)' }}>
        <strong style={{ display: 'block' }}>Next payment dates</strong>
        <div style={{ fontSize: 12, color: 'var(--subtle)', margin: '2px 0 10px' }}>Preview only: the contract calculates the real dates.</div>
        <ol style={{ margin: 0, paddingLeft: 22, lineHeight: 1.9 }}>
          {dates.map((d) => <li key={d} className="mono" style={{ fontSize: 14 }}>{utcLabel(d)}</li>)}
        </ol>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10, lineHeight: 1.5 }}>
          If approval happens after the start date, the schedule starts at the moment it is registered and these dates shift to match.
        </div>
      </div>

      <Notice tone="warning" title="Please read before you continue">
        <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
          <li>This is a request. It needs a quorum of {overview.quorum || '…'} approvers within {approvalWindowDays(overview.payrollDelay)} days, then a safety wait of {plainDuration(overview.payrollDelay)}.</li>
          <li>Nothing is registered until the approved request has been run in Approvals.</li>
          <li>A registered schedule does not pay by itself. Each payment happens only when someone triggers the due payment, and automatic triggering is not connected yet.</li>
          <li>There is no limit on the number of payments. It continues until the end date, if you set one, or until approvers cancel it.</li>
        </ul>
      </Notice>

      <Preflight check={check} deps={depsKey} okText="This is a dry run. Approvers still have to approve and the request must be run before the schedule exists." />
    </div>
  )
}
