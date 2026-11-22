# CSV 策略实验

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
