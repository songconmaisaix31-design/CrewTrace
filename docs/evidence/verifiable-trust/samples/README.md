# V0.2 凭证样例

本目录的凭证由固定实验密钥签发，用于展示两种任务在同一 `ct-attestation-v1` 结构中的字段差异。数据全部为合成样本，不对应真实客户、真实仓库或生产数据。

| 文件 | 说明 |
| --- | --- |
| `allowlist.json` / `revocations.json` | 样例签发者名单与空撤销列表 |
| `csv-attestation.json` / `csv-input.csv` / `csv-delivery.csv` | CSV 交付凭证与原始证据 |
| `code-attestation.json` / `task-spec.md` / `tests.json` / `files.json` / `report.json` | 代码交付凭证与授权证据 |

样例在 2026-11-24T05:00:00Z 的核验结果：

- CSV：`VERIFIED_OFFLINE`，`quality=RECALCULATED_PASS`，`fulfillment=RECALCULATED_PASS`。
- 代码：`VERIFIED_OFFLINE`，`quality=RECALCULATED_PASS`，`fulfillment=RECALCULATED_PASS`。

复算命令：

```bash
node --import tsx -e "
import { readFileSync } from 'node:fs';
import { verifyAttestation } from './packages/attestation/src/index.js';
const read = (name) => readFileSync('./docs/evidence/verifiable-trust/samples/' + name, 'utf8');
const report = await verifyAttestation({
  attestation: JSON.parse(read('code-attestation.json')),
  allowlist: JSON.parse(read('allowlist.json')),
  revocations: JSON.parse(read('revocations.json')),
  codeEvidence: {
    taskSpec: read('task-spec.md'),
    testSuite: read('tests.json'),
    artifactFiles: JSON.parse(read('files.json')),
    testReport: read('report.json'),
  },
  recognizedRuleVersions: ['code-artifact-test-v1'],
  now: new Date('2026-11-24T05:00:00.000Z'),
});
console.log(report.outcome, report.quality, report.fulfillment, report.reasons);
"
```

样例密钥仅用于文档，不应在任何真实环境使用。
