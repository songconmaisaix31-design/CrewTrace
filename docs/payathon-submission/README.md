# CrewTrace PAYATHON 2026 参赛材料

本目录用于 PAYATHON 2026（支付宝 AI 付年度黑客松）Machine Pay 赛道参赛准备。所有内容基于仓库 `NextVariable/crewtrace-v2` 分支 `feat/payathon-commerce` 的当前代码与本地、公网、CI 实测结果，不使用模拟付款冒充官方付款，不包含真实客户数据。

## 材料索引

| 文件 | 用途 |
| --- | --- |
| [01-rules-and-eligibility.md](./01-rules-and-eligibility.md) | 官方规则核对：资格、赛道、时间节点、评审口径与当前差距 |
| [02-payment-readiness-gap.md](./02-payment-readiness-gap.md) | 支付宝 Machine Pay 代码审查与官方接入缺口清单 |
| [03-demo-script-3min.md](./03-demo-script-3min.md) | 三分钟真实三 Agent 演示脚本与录制方案 |
| [04-project-intro-zh.md](./04-project-intro-zh.md) | 中文项目介绍：价值、架构、创新点、支付状态、证据 |
| [05-project-intro-en.md](./05-project-intro-en.md) | English introduction: value, architecture, innovation, payment status, evidence |
| [06-test-evidence.md](./06-test-evidence.md) | 本地、公网与 CI 测试证据 |
| [07-submission-checklist.md](./07-submission-checklist.md) | 作品提交字段、材料清单与提交前检查 |
| [08-production-runtime.md](./08-production-runtime.md) | Mac 与 Cloudflare 免费资源持续运行 Runtime、MCP 与三个 Worker 的可行性评估 |
| [09-payment-preflight.md](./09-payment-preflight.md) | 真实支付前安全检查与最低金额测试方案，不发起真实付款 |

## 当前状态（2026-11-23）

| 能力 | 状态 |
| --- | --- |
| 免费三 Agent 服务完整履约（下单、执行、交付、验收、下载） | 已验证：本地与公网 |
| 402 + `amtPaymentLink` + `Payment-Proof` 支付状态机 | 代码已实现，自动化测试通过 |
| 支付宝官方预下单与验付调用 | 代码已实现，从未对真实支付宝发起请求 |
| 支付宝沙箱验收脚本 | 已实现，缺少凭证时输出 `BLOCKED` |
| 支付宝正式支付 | 未验证，`PAYMENT_MODE=disabled` |
| PAYATHON 报名 | 用户已完成正式报名（用户 2026-11-23 告知），审核状态与账号条件未由本仓库核验 |
| 商户主体、实人认证与签约 | 待用户验证，仓库无相关凭证 |
| 稳定公网生产部署 | 尚未验证，目前只有本机演示与临时隧道，评估见 `08-production-runtime.md` |
| Cloudflare Pages 展示站 | 已上线：https://crewtrace-showcase.pages.dev，仅静态展示 |

## 三条必须知道的事实

1. 报名已完成，参赛资格仍取决于商户开通、真实付款交付闭环与稳定部署。当前仓库只完成接入代码与测试，尚未完成官方商户验证，因此**不能宣布作品已满足赛事提交硬性要求**。
2. 官方商业化评分统计 2026-09-21 至 2026-12-09 期间通过支付宝 AI 付完成有效交易的去重用户数。没有真实交易就没有该项得分。
3. 官方接入需要稳定公网 HTTPS 服务端。Pages 是纯静态站，不能承载 Runtime、数据库与支付回调；临时隧道地址不适合作为评审期入口。Mac + Cloudflare 免费资源的持续在线能力尚未验证。

## 时间节点

报名已于本轮前完成。作品提交截止 2026-12-09 23:59:59，初选 12-10 至 12-14，决赛入围公示 12-15 至 12-25，线下决赛 2026-12-26。距提交截止 16 天。

## 成本约束

本目录的准备工作新增现金支出 ¥0，本轮未发起真实付款。已存在的 Pages Free 项目与 GitHub 自动部署保持不变。官方接入所需的商户资质、生产服务器、域名与真实支付属于后续人工决策事项，不在本轮自动执行范围内。
