/**
 * AskirawaFi Automation Registry
 * Deployed on Arc Mainnet (chain ID 5042)
 * Address: 0x5E13b82A35Ac827b368215141F4a4F8ADfb1F434
 */

import { ARC_MAINNET_CHAIN_ID } from '../config'

export const AUTOMATION_REGISTRY_ADDRESS =
  '0x5E13b82A35Ac827b368215141F4a4F8ADfb1F434' as const

export const AUTOMATION_REGISTRY_CHAIN_ID = ARC_MAINNET_CHAIN_ID

export const AUTOMATION_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'automationCount',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'createAutomation',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'frequency', type: 'uint256' },
      { name: 'executionTime', type: 'uint256' },
      { name: 'note', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getAutomation',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [
      { name: 'id', type: 'uint256' },
      { name: 'name', type: 'string' },
      { name: 'owner', type: 'address' },
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'frequency', type: 'uint256' },
      { name: 'executionTime', type: 'uint256' },
      { name: 'note', type: 'string' },
      { name: 'active', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'setAutomationStatus',
    inputs: [
      { name: 'id', type: 'uint256' },
      { name: 'active', type: 'bool' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

/** Seconds-per-period for each frequency option */
export const FREQUENCY_SECONDS: Record<string, number> = {
  Once: 0,
  Daily: 86400,
  Weekly: 604800,
  Monthly: 2592000,
}

export function secondsToFrequency(s: number): string {
  if (s === 86400) return 'Daily'
  if (s === 604800) return 'Weekly'
  if (s === 2592000) return 'Monthly'
  return 'Once'
}

export interface AutomationRecord {
  id: number
  name: string
  owner: string
  recipient: string
  /** Raw bigint from contract */
  amountRaw: bigint
  /** Formatted as USDC string (6 decimals) */
  amountFormatted: string
  frequency: string
  executionTime: number
  note: string
  active: boolean
}

export function parseAutomationTuple(tuple: readonly unknown[]): AutomationRecord {
  const amountRaw = tuple[4] as bigint
  const decimals = 6
  const divisor = BigInt(10 ** decimals)
  const whole = amountRaw / divisor
  const frac = amountRaw % divisor
  const amountFormatted = `${whole}.${frac.toString().padStart(decimals, '0')}`

  return {
    id: Number(tuple[0]),
    name: tuple[1] as string,
    owner: tuple[2] as string,
    recipient: tuple[3] as string,
    amountRaw,
    amountFormatted,
    frequency: secondsToFrequency(Number(tuple[5])),
    executionTime: Number(tuple[6]),
    note: tuple[7] as string,
    active: tuple[8] as boolean,
  }
}

export function formatAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

export function formatDate(ts: number): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
