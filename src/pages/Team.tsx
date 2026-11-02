import { ConnectKitButton } from 'connectkit'
import { LifeBuoy, Shield, ShieldAlert, ShieldCheck, Users, Wallet, UserPlus, KeyRound } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Badge from '../components/ui/Badge'
import { ConnectPrompt, SetupNotice, Who } from '../components/flow/shared'
import { AddressLine, Panel, Row, note } from '../components/pagekit/Panel'
import MemberRow from '../components/team/MemberRow'
import RolesTable from '../components/team/RolesTable'
import { useMyPermissions } from '../chain/hooks'

const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

export default function Team() {
  const { address, isApprover, canCreate, isGuardian, overview } = useMyPermissions()
  const ready = overview.state === 'ready'
  const approvers = overview.approvers
  const initiators = overview.proposers.filter((p) => !approvers.some((a) => same(a, p)))

  const can: string[] = []
  if (isApprover) can.push('approve or reject requests')
  if (canCreate) can.push('create payment requests')
  if (isGuardian) can.push('pause the treasury in an emergency')
  can.push('view everything in this app', 'trigger an approved payment once its safety delay has passed')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHeader eyebrow="Governance" title="Team and roles"
        subtitle="Who can approve and create payments, as set in the treasury contract. Everything marked on-chain is read live from the network." />
      <SetupNotice overview={overview} />

      {ready && (
        <>
          <Panel icon={ShieldCheck} title="Approval rule">
            <p style={{ margin: 0, fontSize: 18, fontFamily: "'Space Grotesk', sans-serif", color: 'var(--ink)' }}>
              {overview.quorum} of {approvers.length} approvers must approve every payment
            </p>
            <p style={note}>This rule is enforced by the treasury contract. A request cannot be paid until enough approvers have approved it and its safety waiting period has passed.</p>
            <p style={note}>Changing approvers or the approval rule needs an approved request and is done in Governance.</p>
          </Panel>

          <Panel icon={Users} title="Approvers" subtitle="Enforced on-chain. These wallets can approve, reject and create requests.">
            {approvers.length === 0 ? <p style={{ margin: 0, color: 'var(--muted)' }}>The contract lists no approvers.</p> : (
              <ul style={{ margin: 0, padding: 0 }}>
                {approvers.map((a) => <MemberRow key={a} address={a} isMe={same(a, address)} />)}
              </ul>
            )}
            <p style={note}>Display names are saved in this browser only, not proof of identity. They do not change what anyone can do.</p>
          </Panel>

          <Panel icon={UserPlus} title="Payment initiators" subtitle="Enforced on-chain. These wallets can create requests but cannot approve them.">
            {initiators.length === 0 ? <p style={{ margin: 0, color: 'var(--muted)' }}>No separate payment initiators. Only approvers can create requests.</p> : (
              <ul style={{ margin: 0, padding: 0 }}>
                {initiators.map((p) => <MemberRow key={p} address={p} isMe={same(p, address)} />)}
              </ul>
            )}
          </Panel>

          <Panel icon={ShieldAlert} title="Emergency pause">
            {overview.guardian ? (
              <>
                <Row label="Pause contact"><Who address={overview.guardian} />{same(overview.guardian, address) && <> <Badge variant="active">You</Badge></>}</Row>
                <p style={note}>This wallet can pause the treasury if something looks wrong. It cannot move funds. Resuming needs an approved request.</p>
              </>
            ) : <p style={{ margin: 0, color: 'var(--ink-2)' }}>No emergency pause contact is set.</p>}
          </Panel>

          <Panel icon={LifeBuoy} title="Recovery">
            {overview.recovery ? (
              <>
                <Row label="Recovery contract"><AddressLine address={overview.recovery} /></Row>
                <p style={note}>If approvers lose access, a separate recovery council can restore access after a long waiting period and an approver veto window.</p>
              </>
            ) : <p style={{ margin: 0, color: 'var(--ink-2)' }}>Recovery is not configured for this treasury.</p>}
          </Panel>
        </>
      )}

      <Panel icon={Wallet} title="Your wallet">
        {!address ? (
          <ConnectPrompt text="Connect Company Wallet to see what this wallet can do." />
        ) : !ready ? (
          <p style={{ margin: 0, color: 'var(--muted)' }}>Your permissions will appear once the treasury has loaded.</p>
        ) : (
          <>
            <p style={{ margin: '0 0 8px' }}><Who address={address} /></p>
            <p style={{ margin: 0, color: 'var(--ink)' }}>You can: {can.join('; ')}.</p>
            {!canCreate && !isApprover && <p style={note}>This wallet is not an approver or payment initiator on-chain, so it cannot create or approve requests.</p>}
            <div style={{ marginTop: 12 }}><ConnectKitButton.Custom>{({ show }) => (
              <button type="button" onClick={show} style={{ minHeight: 44, padding: '0 14px', background: 'transparent', border: '1px solid var(--border-strong)', color: 'var(--ink)', cursor: 'pointer' }}>Change wallet</button>
            )}</ConnectKitButton.Custom></div>
          </>
        )}
      </Panel>

      <Panel icon={KeyRound} title="Roles explained">
        <RolesTable />
      </Panel>

      <Panel icon={Shield} title="What is not available yet">
        <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--ink-2)', fontSize: 14, lineHeight: 1.8 }}>
          <li>Changing approvers or the approval rule needs an approved request and is done in Governance.</li>
          <li>Team invitations and email accounts are not available. Access is controlled only by wallet addresses on-chain.</li>
        </ul>
      </Panel>
    </div>
  )
}
