# CSV 策略实验

本报告适用于 Reputation V2。PAYATHON 与 Trust SDK 的实验原件及 CI 见 [仓库索引](docs/REPOSITORY-INDEX.md#八个阶段)。

使用 `workers/src/portfolio-benchmark.ts`，固定种子 `crewtrace-v2-csv-2026-11-22`。三种确定性 Worker 处理同一组受控 CSV 输入，实际运行复制、规范化与去重，再交给同一验收器。每位 Worker 先处理独立的 12 个历史输入，评分只用历史阶段，三种策略比较同一批 30 个留出任务，每个任务最多尝试两位 Worker。

| 策略 | 首次通过 | 最终通过 | 重试 |
| --- | ---: | ---: | ---: |
| 随机 | 19/30 | 26/30 | 11/30 |
| 能力过滤 | 24/30 | 30/30 | 6/30 |
| 信誉排序 | 30/30 | 30/30 | 0/30 |

信誉排序将 30 个任务集中到一名 Worker。最终通过率与能力过滤相同，减少了本次受控输入的重试。样本来自人工设计的缺陷类型，任务相似、无并发和模型调用。毫秒数据包含单进程执行顺序及预热影响，金额没有实测。记录中的 PASS 表示满足 CSV 规则，无法据此判断任意 Agent 或现实任务的表现。

完整输入、原始尝试、耗时和分配次数见 [benchmark-run.json](docs/portfolio/benchmark-run.json)。依赖安装后可执行：

```sh
cd workers
node --import tsx src/portfolio-benchmark.ts
```

## Load and interruption experiment

The second experiment is a deterministic discrete-time simulation with real CSV transformations and rule checks. It uses 60 identical holdout inputs per strategy, three initial Worker profiles, one cold-start profile, fixed arrival bursts, explicit outage windows and one running assignment per worker. The seeded input generator changes the defect mix halfway through. Training preserves a separate 16-item history for each initial worker. During holdout, only accepted passes affect reputation. An interrupted execution consumes a lease and can be reassigned, with a maximum of three attempts.

| Policy | First attempt passes | Accepted | Retried | Timeouts | Mean successful completion (ticks) | Assignment concentration |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Random | 47/60 | 59/60 | 13 | 4 | 13.03 | 0.2504 |
| Capability | 44/60 | 56/60 | 16 | 4 | 13.63 | 0.2525 |
| Reputation | 44/60 | 56/60 | 16 | 4 | 13.63 | 0.2525 |

Concentration is the sum of squared worker assignment shares. The JSON also contains attempts and online/busy ticks per worker. Capability and reputation produced identical decisions under the fixed profile ordering. Random did better on this workload. A single seed and synthetic profiles provide no basis for a general ranking of the policies. Simulated ticks measure the scheduling model, while the separate integration tests exercise actual concurrent worker processes and the Runtime. Monetary costs were unavailable.

[Inputs, raw attempts and statistics](docs/portfolio/benchmark-load-v1.json)

```sh
cd workers
node --import tsx src/portfolio-load-benchmark.ts
```

## Trust-native scheduling comparison

The V3 trust integration adds a fourth policy to the same 60-task load simulation. `verified-reputation` first filters workers by the CSV defect each mode can actually handle, then ranks them by attested fulfillment evidence whose delivery hash is recalculated by the verifier. Training history is converted and verified before it is written as evidence. The other three policies and all inputs, arrival bursts, outage windows, leases and retry budgets are unchanged.

| Policy | Accepted | First attempt passes | Retried | Timeouts | Mean completion (ticks) | Concentration | Cold-start attempts | Attestations |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Random | 59/60 | 47/60 | 13 | 4 | 13.03 | 0.2504 | 1 | — |
| Capability | 56/60 | 44/60 | 16 | 4 | 13.63 | 0.2525 | 1 | — |
| Reputation | 56/60 | 44/60 | 16 | 4 | 13.63 | 0.2525 | 1 | — |
| Verified reputation | 60/60 | 57/60 | 3 | 3 | 10.50 | 0.2537 | 1 | 98 |

The verified policy performs best on this workload, but it also adds a capability gate that the two existing policies do not apply, so the improvement cannot be attributed to attested reputation alone. Capability and reputation still produce identical decisions. The simulation cannot inject forged or revoked attestations; those cases are covered by the Runtime integration tests. A single seed and synthetic worker profiles give no basis for switching the production default, which remains `reputation`. Details and caveats are in [docs/v3/strategy-comparison.md](docs/v3/strategy-comparison.md); raw data is in [docs/portfolio/benchmark-trust-v1.json](docs/portfolio/benchmark-trust-v1.json).

