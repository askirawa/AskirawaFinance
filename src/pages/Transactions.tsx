import PageHeader from '../components/ui/PageHeader'
import V2Gate from '../components/v2/V2Gate'
import EventFeed from '../components/v2/EventFeed'

/** USDC movements into and out of the treasury, read from contract events. */
export default function Transactions() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHeader eyebrow="Insights" title="Transactions" subtitle="Deposits, payroll payments, recurring payments and module fund movements, each with its transaction link." />
      <V2Gate><EventFeed moneyOnly /></V2Gate>
    </div>
  )
}
