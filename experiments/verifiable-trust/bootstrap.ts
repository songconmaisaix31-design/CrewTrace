import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { deployLocalLedger, HARDHAT_ACCOUNTS, hardhatAddress } from '../../packages/attestation/src/chain.js';

const { values } = parseArgs({
  options: {
    rpc: { type: 'string', default: 'http://127.0.0.1:8545' },
    'chain-id': { type: 'string', default: '31337' },
    out: { type: 'string', default: '.local/attestation' },
    deployment: { type: 'string', default: 'experiment-local' },
  },
});

const outDir = resolve(values.out!);
mkdirSync(resolve(outDir, 'keys'), { recursive: true });

const issuerKey = generatePrivateKey();
const issuerAddress = privateKeyToAccount(issuerKey).address;
writeFileSync(resolve(outDir, 'keys/issuer.key'), `${issuerKey}\n`, { mode: 0o600 });
writeFileSync(resolve(outDir, 'keys/recorder.key'), `${HARDHAT_ACCOUNTS.recorder}\n`, { mode: 0o600 });

const deployed = await deployLocalLedger({
  rpcUrl: values.rpc!, chainId: Number(values['chain-id']!),
  deployerKey: HARDHAT_ACCOUNTS.deployer, recorder: hardhatAddress(HARDHAT_ACCOUNTS.recorder),
});

const allowlist = {
  version: 'ct-issuer-allowlist-v1',
  issuedAt: new Date(Date.now() - 60_000).toISOString(),
  expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
  issuers: [{
    issuerId: 'crewtrace-experiment',
    keyId: 'issuer-2026-11',
    address: issuerAddress,
    validFrom: new Date(Date.now() - 60_000).toISOString(),
    validTo: null,
    revokedAt: null,
  }],
};
writeFileSync(resolve(outDir, 'allowlist.json'), `${JSON.stringify(allowlist, null, 2)}\n`);
writeFileSync(resolve(outDir, 'revocations.json'), `${JSON.stringify({
  version: 'ct-revocation-list-v1',
  issuedAt: new Date(Date.now() - 60_000).toISOString(),
  expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
  entries: [],
}, null, 2)}\n`);

const config = {
  rpcUrl: values.rpc,
  chainId: Number(values['chain-id']),
  contract: deployed.contract,
  deploymentBlock: deployed.blockNumber,
  deployTxHash: deployed.txHash,
  recorder: hardhatAddress(HARDHAT_ACCOUNTS.recorder),
  deployer: hardhatAddress(HARDHAT_ACCOUNTS.deployer),
  reviewer: hardhatAddress(HARDHAT_ACCOUNTS.reviewer),
  issuerId: 'crewtrace-experiment',
  keyId: 'issuer-2026-11',
  issuerAddress,
  environment: 'local',
  deployment: values.deployment,
};
writeFileSync(resolve(outDir, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
console.log(JSON.stringify(config, null, 2));
