# 四种调度策略对照

本轮对照使用 `workers/src/portfolio-load-benchmark.ts`，固定种子 `crewtrace-load-v1-2026-11-22`。四种策略处理同一批 60 个留出任务，使用相同的到达节奏、Worker 在线与中断窗口、租约 6 tick、最多 3 次尝试和同一套 CSV 转换与验收规则。每个 Worker 只保留一个进行中的任务。训练阶段为 16 个独立历史输入，只有通过验收的尝试进入信誉。

策略含义：

- `random`：在在线且空闲的 Worker 中随机选择。
- `capability`：在在线且空闲的 Worker 中按静态能力值排序。
- `reputation`：在在线且空闲的 Worker 中按原 Runtime 信誉公式 `calculateReputation` 排序。
- `verified-reputation`：先按任务缺陷与 Worker 处理方式过滤能力，再按已核验履约凭证排序，近期凭证按 90 tick 半衰期加权。

`verified-reputation` 的凭证来自真实 CSV 转换与验收。只有产生 PASS 且交付摘要可复算的尝试才写入凭证记录，训练历史同样先执行转换再写入。该策略不使用客户端自报的成功声明。

| 策略 | 最终通过 | 首次通过 | 重试任务 | 超时 | 未完成 | 平均完成 tick | 分配集中度 | 冷启动尝试 | 凭证数 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| random | 59/60 | 47/60 | 13 | 4 | 0 | 13.03 | 0.2504 | 1 | — |
| capability | 56/60 | 44/60 | 16 | 4 | 0 | 13.63 | 0.2525 | 1 | — |
| reputation | 56/60 | 44/60 | 16 | 4 | 0 | 13.63 | 0.2525 | 1 | — |
| verified-reputation | 60/60 | 57/60 | 3 | 3 | 0 | 10.50 | 0.2537 | 1 | 98 |

按 Worker 的尝试次数与在线利用率：

| 策略 | copy | standard | specialist | new-agent |
| --- | ---: | ---: | ---: | ---: |
| random | 21 / 0.382 | 19 / 0.365 | 20 / 0.371 | 19 / 0.336 |
| capability | 24 / 0.406 | 19 / 0.353 | 20 / 0.377 | 19 / 0.336 |
| reputation | 24 / 0.406 | 19 / 0.353 | 20 / 0.377 | 19 / 0.336 |
| verified-reputation | 13 / 0.194 | 15 / 0.269 | 17 / 0.321 | 18 / 0.336 |

`verified-reputation` 在本负载下取得最高首次通过率与最终通过率，重试从 16 降到 3，平均完成时间从 13.63 tick 降到 10.50 tick。该结果不能简单归因于可验证信誉。策略 D 同时加入了能力过滤，复制 Worker 不再处理空格与重复记录任务，这一过滤本身就会减少失败；策略 B 与 C 在本负载下给出完全相同的决策，说明静态能力值与原信誉公式在这批 Worker 上的排序一致。

分配集中度四种策略接近，策略 D 没有把任务集中到单个 Worker。冷启动方面四种策略都只有 1 次冷启动尝试，`new-agent` 在第 20 tick 加入后没有历史凭证，因具备对应处理能力被选中并通过，之后其凭证进入后续排序。策略 D 的 98 张凭证包含训练阶段历史凭证与在线阶段新凭证。

本实验只有单一随机种子和人工构造的负载，Worker 能力、中断窗口与缺陷分布都由脚本指定；模拟过程无法注入伪造凭证或被撤销凭证，这两类反例由 `services/runtime/test/trust-matching.test.ts` 与 `services/runtime/test/trust-collaboration.test.ts` 的真实流程覆盖。因此本结果只说明该策略在这组条件下的表现，不构成对四种策略的一般排序，也不作为切换生产默认策略的依据。Runtime 默认策略保持 `reputation`，新策略通过 `EXPERIMENT_MATCHING_POLICY` 显式启用。

原有 30 任务 CSV 策略实验与 60 任务负载实验的结果保留在 [EVALUATION.md](../../EVALUATION.md)，本次没有修改两个既有脚本的输入、评分与输出。

完整输入、每次尝试、按 Worker 统计与凭证数量见 [benchmark-trust-v1.json](../portfolio/benchmark-trust-v1.json)。复现命令：

```sh
cd workers
node --import tsx src/portfolio-load-benchmark.ts
```

连续两次运行输出完全一致，可用 `diff` 复核。
