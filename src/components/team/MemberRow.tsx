import { useState } from 'react'
import Badge from '../ui/Badge'
import { Who } from '../flow/shared'
import { useLabels } from '../../chain/addressBook'

/** One on-chain team member with an optional browser-only display name. */
export default function MemberRow({ address, isMe }: { address: string; isMe: boolean }) {
  const { nameOf, saveName } = useLabels()
  const current = nameOf(address) ?? ''
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(current)

  const open = () => { setDraft(current); setEditing(true) }
  const save = () => { saveName(address, draft); setEditing(false) }

  return (
    <li style={{ padding: '12px 0', borderBottom: '1px solid var(--border)', listStyle: 'none' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Who address={address} />
          {isMe && <Badge variant="active">You</Badge>}
        </div>
        {!editing && (
          <button type="button" onClick={open}
            style={{ minHeight: 44, padding: '0 12px', background: 'transparent', border: '1px solid var(--border-strong)', color: 'var(--ink)', cursor: 'pointer', fontSize: 13 }}>
            {current ? 'Edit display name' : 'Add a display name'}
          </button>
        )}
      </div>
      {editing && (
        <form onSubmit={(e) => { e.preventDefault(); save() }} style={{ marginTop: 10 }}>
          <label htmlFor={`name-${address}`} style={{ display: 'block', fontSize: 13, color: 'var(--ink-2)', marginBottom: 6 }}>Display name</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <input id={`name-${address}`} value={draft} maxLength={40} onChange={(e) => setDraft(e.target.value)}
              placeholder="For example: Finance lead" style={{ flex: '1 1 220px', minWidth: 0 }} />
            <button type="submit" style={{ minHeight: 44, padding: '0 16px', background: 'var(--ink)', color: 'var(--bg)', border: '1px solid var(--ink)', cursor: 'pointer', fontWeight: 600 }}>Save</button>
            <button type="button" onClick={() => setEditing(false)} style={{ minHeight: 44, padding: '0 16px', background: 'transparent', border: '1px solid var(--border-strong)', color: 'var(--ink)', cursor: 'pointer' }}>Cancel</button>
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--muted)' }}>
            Saved in this browser only, not proof of identity. Other people and other devices will not see this name.
          </p>
        </form>
      )}
    </li>
  )
}
