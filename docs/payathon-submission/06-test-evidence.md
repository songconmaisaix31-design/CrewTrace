# 测试与验收证据

证据采集时间 2026-11-23，代码基线为远程分支 `feat/payathon-commerce` 提交 `de1b4b8`。本目录材料提交后会新增一个文档提交，不改变代码。

## 本地自动化测试

| 范围 | 命令 | 结果 |
| --- | --- | --- |
| 支付、402、验付、配额、网关 | `node --import tsx --test test/commerce-payment.test.ts test/alipay-proof.test.ts test/payment-config.test.ts test/commerce-flow.test.ts test/demo-quotas.test.ts test/public-limits.test.ts test/gateway-proxy-quota.test.ts` | 36 通过，0 失败 |
| Runtime 类型检查 | `npm --prefix services/runtime run build` | 通过，无类型错误 |
| Worker 测试 | `cd workers && node --import tsx --test test/*.test.ts` | 7 通过，0 失败 |
| 展示站内容测试 | `npm run test:showcase` | 8 通过，0 失败 |
| Web 单元测试 | `cd apps/web && npm test` | 3 通过，0 失败 |

支付相关测试覆盖：模拟支付模式的环境限制、官方模式必填凭证与 service_id 映射校验、402 响应携带 `amtPaymentLink`、携带凭证后放行交付、交易号与金额不一致时拒绝、未知结果不重复下单、配额与限流窗口重置。测试使用本地 PostgreSQL 16，运行结束后已停止。

## CI

| 提交 | 工作流 | 结论 |
| --- | --- | --- |
| `de1b4b8` | CrewTrace portfolio checks | success：https://github.com/NextVariable/crewtrace-v2/actions/runs/45047921315 |
| `0f95b43` | CrewTrace portfolio checks | success：https://github.com/NextVariable/crewtrace-v2/actions/runs/45045178292 |

CI 包含 Web 构建与测试、展示站测试、网关测试、Runtime 与 Worker 测试、PostgreSQL 集成测试、Playwright 浏览器流程与负载基准比对。

## 公网临时隧道验收

在支付模式 `disabled`、链上写入关闭、管理端不经网关暴露、支付未配置的前提下，通过 Cloudflare Quick Tunnel 进行的真实公网验收结果为：健康检查 200 且数据库已连接；管理端公网 404、本机授权访问 200；浏览器端到端流程 17.9 秒完成注册、免费下单、三个 Worker 执行、下载、验收、信誉记录、重复下单与刷新恢复；暂停时注册返回 503 `DEMO_PAUSED`，恢复后返回 200；轮换伪造转发头请求 80 次，56 次 200 后 24 次 429；额度只记入回环地址桶。

隧道在同一次会话内已关闭，当前无 cloudflared、Runtime、网关、Worker 与 PostgreSQL 进程，3000、8080、55481 无监听，原公网地址返回 530。验收结束后未重新开启。

## Cloudflare Pages 展示站

固定地址 https://crewtrace-showcase.pages.dev 使用 GitHub 集成，生产分支 `feat/payathon-commerce`，输出目录 `apps/showcase`。线上验收结果：HTTP 200；CSP、`X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer` 等安全响应头生效；CSS、JS 与 SVG 资源均 200；1440×900 与 390×844 无横向滚动；9 个板块齐全；浏览器错误 0；演示状态为 CLOSED；页面无 GitHub 外链、无隧道地址、无本机路径；明确标注支付宝正式支付尚未验证与演示数据不代表真实客户交易。推送后 Pages 自动重新部署，证明自动部署链路有效。

## 未覆盖的验证

没有进行支付宝沙箱或正式环境的预下单与验付，没有真实付款、退款或异步通知测试，没有生产环境稳定性、备份与监控验证，也没有真实付费用户数据。上述项目在材料中一律标注为未验证，不以测试替身冒充实测。
