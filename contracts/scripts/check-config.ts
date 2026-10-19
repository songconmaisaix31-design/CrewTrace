import { formatEther, getAddress } from "viem";
import { ChainError } from "../../packages/chain/dist/index.js";
import {
  addressEnv, agentAccounts, assertTestnet, coordinatorWallet, reportFailure, walletFromEnv,
} from "./env.js";

async function main() {
  const rpc = await assertTestnet();
  const deployer = walletFromEnv("DEPLOYER_PRIVATE_KEY");
  const coordinator = coordinatorWallet();
  const validator = walletFromEnv("VALIDATOR_PRIVATE_KEY");
  const agents = agentAccounts();
  if (getAddress(validator.account.address) !== addressEnv("VALIDATOR_ADDRESS")) {
    throw new ChainError("ENV_CONFIG", "验收方私钥与 VALIDATOR_ADDRESS 不一致");
  }
  if (new Set(agents.map((account) => getAddress(account.address))).size !== 4
    || agents.some((account) => getAddress(account.address) === getAddress(validator.account.address))) {
    throw new ChainError("ENV_CONFIG", "四个 Agent 必须使用独立地址，且不能作为自身验收方");
  }
  const accounts = [
    ["部署者", deployer.account.address], ["协调者", coordinator.account.address],
    ["验收方", validator.account.address], ...agents.map((account, index) => [`Agent ${index + 1}`, account.address]),
  ] as const;
  for (const [label, address] of accounts) {
    const balance = await rpc.getBalance({ address: getAddress(address) });
    console.log(`${label} ${address}：${formatEther(balance)} MON`);
    if (balance === 0n) throw new ChainError("INSUFFICIENT_FUNDS", `${label} 没有测试 MON：${address}`);
  }
  console.log("Monad Testnet 10143；签名配置与公开地址检查通过。");
}

await main().catch(reportFailure);
