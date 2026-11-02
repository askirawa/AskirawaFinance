import Badge from '../ui/Badge'

const LABEL_ONLY = 'Label only. The treasury contract has no such role, so this app cannot enforce it.'

const ROLES: { role: string; create: string; approve: string; execute: string; view: string; how: string; enforced: boolean }[] = [
  { role: 'Owner / Administrator', create: 'Yes', approve: 'Yes', execute: 'Anyone', view: 'Yes', how: LABEL_ONLY, enforced: false },
  { role: 'Finance Manager', create: 'Yes', approve: 'No', execute: 'Anyone', view: 'Yes', how: LABEL_ONLY, enforced: false },
  { role: 'Payment Initiator', create: 'Yes', approve: 'No', execute: 'Anyone', view: 'Yes', how: 'Enforced on-chain', enforced: true },
  { role: 'Approver', create: 'Yes', approve: 'Yes', execute: 'Anyone', view: 'Yes', how: 'Enforced on-chain', enforced: true },
  { role: 'Viewer', create: 'No', approve: 'No', execute: 'Anyone', view: 'Yes', how: LABEL_ONLY, enforced: false },
]

const th = { textAlign: 'left' as const, padding: '10px 12px', whiteSpace: 'nowrap' as const }

export default function RolesTable() {
  return (
    <>
      <div className="table-scroll">
        <table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Role</th><th style={th}>Create payments</th><th style={th}>Approve</th>
              <th style={th}>Execute approved payments</th><th style={th}>View</th><th style={th}>How it is enforced</th>
            </tr>
          </thead>
          <tbody>
            {ROLES.map((r) => (
              <tr key={r.role}>
                <td style={{ padding: '12px', fontWeight: 600, color: 'var(--ink)' }}>{r.role}</td>
                <td style={{ padding: '12px' }}>{r.create}</td>
                <td style={{ padding: '12px' }}>{r.approve}</td>
                <td style={{ padding: '12px' }}>{r.execute}</td>
                <td style={{ padding: '12px' }}>{r.view}</td>
                <td style={{ padding: '12px', minWidth: 240 }}>
                  <Badge variant={r.enforced ? 'success' : 'neutral'}>{r.enforced ? 'Enforced' : 'Label only'}</Badge>
                  <div style={{ marginTop: 6, fontSize: 13 }}>{r.how}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ margin: '12px 0 0', color: 'var(--muted)', fontSize: 13, lineHeight: 1.6 }}>
        Create, Approve and View show what each role is meant to do. Only the last column says what the treasury contract actually checks.
        Anyone can trigger an approved payment after its safety delay; it can only pay what was approved.
      </p>
    </>
  )
}
