import { keccak256, toBytes, type Hex } from 'viem';

// 与 packages/chain/src/collaboration.ts 的最小必要部分保持一致。
// 该副本让 SDK 可以独立安装，不依赖仓库内其他包的源码路径。
export const collaborationLedgerAbi = [
  {
    type: 'constructor', stateMutability: 'nonpayable',
    inputs: [{ name: 'recorder_', type: 'address' }],
  },
  {
    type: 'function', name: 'recorder', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function', name: 'record', stateMutability: 'nonpayable',
    inputs: [
      { name: 'kind', type: 'uint8' }, { name: 'recordId', type: 'bytes32' },
      { name: 'version', type: 'uint32' }, { name: 'contentHash', type: 'bytes32' },
      { name: 'uri', type: 'string' },
    ], outputs: [],
  },
  {
    type: 'function', name: 'commitmentKey', stateMutability: 'pure',
    inputs: [
      { name: 'kind', type: 'uint8' }, { name: 'recordId', type: 'bytes32' },
      { name: 'version', type: 'uint32' },
    ], outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function', name: 'getCommitment', stateMutability: 'view',
    inputs: [
      { name: 'kind', type: 'uint8' }, { name: 'recordId', type: 'bytes32' },
      { name: 'version', type: 'uint32' },
    ],
    outputs: [{
      name: '', type: 'tuple', components: [
        { name: 'kind', type: 'uint8' }, { name: 'recordId', type: 'bytes32' },
        { name: 'version', type: 'uint32' }, { name: 'contentHash', type: 'bytes32' },
        { name: 'uri', type: 'string' }, { name: 'recorder', type: 'address' },
        { name: 'recordedAt', type: 'uint64' },
      ],
    }],
  },
  {
    type: 'event', name: 'CommitmentRecorded', anonymous: false,
    inputs: [
      { name: 'kind', type: 'uint8', indexed: true },
      { name: 'recordId', type: 'bytes32', indexed: true },
      { name: 'version', type: 'uint32', indexed: true },
      { name: 'contentHash', type: 'bytes32', indexed: false },
      { name: 'uri', type: 'string', indexed: false },
      { name: 'recorder', type: 'address', indexed: false },
    ],
  },
  { type: 'error', name: 'UNAUTHORIZED', inputs: [] },
  { type: 'error', name: 'INVALID_ARGUMENT', inputs: [] },
  { type: 'error', name: 'DUPLICATE_COMMITMENT', inputs: [] },
] as const;

export function deriveCollaborationRecordId(kind: string, id: string): Hex {
  return keccak256(toBytes(`co-vibe:collaboration:${kind}:${id}`));
}
