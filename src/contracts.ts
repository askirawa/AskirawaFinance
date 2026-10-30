/**
 * AskirawaFiTreasury ABI and deployment addresses.
 * Contract not yet deployed — owner must deploy via `forge script` and
 * set VITE_TREASURY_ADDRESS in .env before the UI can call on-chain functions.
 */

export const TREASURY_ADDRESS = (import.meta.env.VITE_TREASURY_ADDRESS ?? '') as `0x${string}`
export const AUTOMATION_REGISTRY_ADDRESS = '0x5E13b82A35Ac827b368215141F4a4F8ADfb1F434' as `0x${string}`
export const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as `0x${string}` // arc-studio-allow-onchain-literal
export const USDC_DECIMALS = 6

export const TREASURY_ABI = [
  // ── View ──────────────────────────────────────────────────────────────────
  { type: 'function', name: 'proposalCount',    inputs: [],                     outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'scheduleCount',    inputs: [],                     outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'quorumThreshold',  inputs: [],                     outputs: [{ type: 'uint8'   }], stateMutability: 'view' },
  { type: 'function', name: 'approverCount',    inputs: [],                     outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'keeper',           inputs: [],                     outputs: [{ type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'owner',            inputs: [],                     outputs: [{ type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'isApprover',       inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'hasApproved',      inputs: [{ name: 'proposalId', type: 'uint256' }, { name: 'approver', type: 'address' }], outputs: [{ type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'proposalNonce',    inputs: [{ name: '', type: 'uint256' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  {
    type: 'function', name: 'getProposal',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [
      { name: 'kind',          type: 'uint8'    },
      { name: 'proposer',      type: 'address'  },
      { name: 'createdAt',     type: 'uint256'  },
      { name: 'expiresAt',     type: 'uint256'  },
      { name: 'status',        type: 'uint8'    },
      { name: 'approvalCount', type: 'uint256'  },
      { name: 'scheduleId',    type: 'uint256'  },
      { name: 'memo',          type: 'string'   },
      { name: 'nonce',         type: 'uint256'  },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'getProposalRecipients',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [
      { name: 'recipients', type: 'address[]' },
      { name: 'amounts',    type: 'uint256[]' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'getSchedule',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [
      { name: 'scheduleId',       type: 'uint256'  },
      { name: 'recipient',        type: 'address'  },
      { name: 'amount',           type: 'uint256'  },
      { name: 'frequency',        type: 'uint8'    },
      { name: 'nextExecTime',     type: 'uint64'   },
      { name: 'active',           type: 'bool'     },
      { name: 'cancelled',        type: 'bool'     },
      { name: 'execCount',        type: 'uint256'  },
      { name: 'failCount',        type: 'uint256'  },
      { name: 'memo',             type: 'string'   },
      { name: 'createdBy',        type: 'address'  },
      { name: 'linkedProposalId', type: 'uint256'  },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'getDueSchedules',
    inputs: [{ name: 'maxCount', type: 'uint256' }],
    outputs: [{ name: 'scheduleIds', type: 'uint256[]' }],
    stateMutability: 'view',
  },
  // ── Write ─────────────────────────────────────────────────────────────────
  {
    type: 'function', name: 'createTransferProposal',
    inputs: [{ name: 'recipient', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'memo', type: 'string' }],
    outputs: [{ name: 'proposalId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function', name: 'createPayrollBatch',
    inputs: [{ name: 'recipients', type: 'address[]' }, { name: 'amounts', type: 'uint256[]' }, { name: 'memo', type: 'string' }],
    outputs: [{ name: 'proposalId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function', name: 'approve',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function', name: 'reject',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function', name: 'cancel',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function', name: 'execute',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function', name: 'createSchedule',
    inputs: [
      { name: 'recipient', type: 'address' },
      { name: 'amount',    type: 'uint256' },
      { name: 'frequency', type: 'uint8'   },
      { name: 'memo',      type: 'string'  },
    ],
    outputs: [{ name: 'scheduleId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function', name: 'pauseSchedule',
    inputs: [{ name: 'scheduleId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function', name: 'resumeSchedule',
    inputs: [{ name: 'scheduleId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function', name: 'cancelSchedule',
    inputs: [{ name: 'scheduleId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function', name: 'checkExpiry',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function', name: 'addApprover',
    inputs: [{ name: 'approver', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function', name: 'removeApprover',
    inputs: [{ name: 'approver', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function', name: 'setQuorum',
    inputs: [{ name: 'q', type: 'uint8' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function', name: 'setKeeper',
    inputs: [{ name: 'newKeeper', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  // ── Events ────────────────────────────────────────────────────────────────
  { type: 'event', name: 'ProposalCreated',        inputs: [{ name: 'proposalId', type: 'uint256', indexed: true }, { name: 'kind', type: 'uint8', indexed: true }, { name: 'proposer', type: 'address', indexed: true }, { name: 'expiresAt', type: 'uint256' }, { name: 'memo', type: 'string' }] },
  { type: 'event', name: 'ProposalApproved',       inputs: [{ name: 'proposalId', type: 'uint256', indexed: true }, { name: 'approver', type: 'address', indexed: true }, { name: 'approvalCount', type: 'uint256' }] },
  { type: 'event', name: 'ProposalReadyToExecute', inputs: [{ name: 'proposalId', type: 'uint256', indexed: true }, { name: 'approvalCount', type: 'uint256' }] },
  { type: 'event', name: 'ProposalRejected',       inputs: [{ name: 'proposalId', type: 'uint256', indexed: true }, { name: 'approver', type: 'address', indexed: true }] },
  { type: 'event', name: 'ProposalCancelled',      inputs: [{ name: 'proposalId', type: 'uint256', indexed: true }, { name: 'caller', type: 'address', indexed: true }] },
  { type: 'event', name: 'ProposalExpired',        inputs: [{ name: 'proposalId', type: 'uint256', indexed: true }] },
  { type: 'event', name: 'ProposalExecuted',       inputs: [{ name: 'proposalId', type: 'uint256', indexed: true }, { name: 'executor', type: 'address', indexed: true }, { name: 'txHashLog', type: 'bytes32' }, { name: 'nonce', type: 'uint256' }] },
  { type: 'event', name: 'ScheduleCreated',        inputs: [{ name: 'scheduleId', type: 'uint256', indexed: true }, { name: 'recipient', type: 'address', indexed: true }, { name: 'amount', type: 'uint256' }, { name: 'frequency', type: 'uint8' }, { name: 'nextExecTime', type: 'uint64' }, { name: 'createdBy', type: 'address', indexed: true }, { name: 'linkedProposalId', type: 'uint256' }, { name: 'memo', type: 'string' }] },
  { type: 'event', name: 'ScheduleExecuted',       inputs: [{ name: 'scheduleId', type: 'uint256', indexed: true }, { name: 'recipient', type: 'address', indexed: true }, { name: 'amount', type: 'uint256' }, { name: 'nextExecTime', type: 'uint64' }, { name: 'execCount', type: 'uint256' }] },
  { type: 'event', name: 'ScheduleFailed',         inputs: [{ name: 'scheduleId', type: 'uint256', indexed: true }, { name: 'recipient', type: 'address', indexed: true }, { name: 'amount', type: 'uint256' }, { name: 'failCount', type: 'uint256' }] },
  { type: 'event', name: 'SchedulePaused',         inputs: [{ name: 'scheduleId', type: 'uint256', indexed: true }, { name: 'caller', type: 'address', indexed: true }] },
  { type: 'event', name: 'ScheduleResumed',        inputs: [{ name: 'scheduleId', type: 'uint256', indexed: true }, { name: 'caller', type: 'address', indexed: true }, { name: 'nextExecTime', type: 'uint64' }] },
  { type: 'event', name: 'ScheduleCancelled',      inputs: [{ name: 'scheduleId', type: 'uint256', indexed: true }, { name: 'caller', type: 'address', indexed: true }] },
  { type: 'event', name: 'ApproverAdded',          inputs: [{ name: 'approver', type: 'address', indexed: true }] },
  { type: 'event', name: 'ApproverRemoved',        inputs: [{ name: 'approver', type: 'address', indexed: true }] },
  { type: 'event', name: 'KeeperSet',              inputs: [{ name: 'keeper', type: 'address', indexed: true }] },
  { type: 'event', name: 'QuorumUpdated',          inputs: [{ name: 'quorumThreshold', type: 'uint8' }] },
] as const
