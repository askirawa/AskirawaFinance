import PageHeader from '../components/ui/PageHeader'
import V2Gate from '../components/v2/V2Gate'
import EventFeed from '../components/v2/EventFeed'

/** Governance, treasury and recurring-payment history read from contract events. */
export default function Activity() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHeader eyebrow="Insights" title="Activity" subtitle="Everything that happened onchain: proposals, votes, executions, pauses and schedule runs." />
      <V2Gate><EventFeed /></V2Gate>
    </div>
  )
}
