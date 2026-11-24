# Beta 冻结执行清单

## 已完成核查

- [x] 读取团队 main `48cf0a1`，确认与远端 `songconmaisaix31-design/CrewTrace` 默认分支一致。
- [x] `git diff --name-status 48cf0a1 HEAD`：98 新增、42 修改、0 删除。
- [x] 核对 `apps/web` 原组件与 `App.tsx` 未删除，首页仍为 LensHero。
- [x] 核对 `collaboration-http.ts` 原路由完整，新增路由均为附加。
- [x] 提取团队 main 与当前分支的 MCP 工具名，确认 25+1+27=53、26+1+27+8=62、公网 62−20=42。
- [x] 核对 `contracts/`、`packages/chain`、`packages/runtime-chain`、`deployments/` 与团队 main 一致。
- [x] 探测固定站 200、`collaboration-config` 已配置、线上资源哈希与本地构建一致。
- [x] 探测 `/health`、三个 Worker 进程、数据库订单与信誉统计。
- [x] 扫描全历史密钥、个人路径、账号信息与用户数据。

## 文档产出

- [x] `docs/beta-freeze/compatibility-review.md`：兼容性结论、53 与 42 差异、能力分层、合约保留情况。
- [x] `docs/beta-freeze/beta-acceptance.md`：Beta 验收、三种状态、发布阻断项、最终 HEAD。
- [x] `docs/PRODUCT-STRATEGY.md`：Trust、Coordination、Commerce 三阶段与已实现、实验、未来研究划分。
- [x] `docs/beta-freeze/team-sharing-plan.md`：独立实验分支同步方案、历史脱敏清单、归属与许可证。

## 收尾

- [x] 运行 `npm --prefix apps/web run check` 确认文档提交不引入类型问题（前端代码未改）。
- [ ] 提交文档，推送 `portfolio feat/payathon-commerce`。
- [ ] 报告最终 HEAD、CI 与部署状态。

## 验证命令

```bash
git diff --name-status 48cf0a1 HEAD | awk '{print $1}' | sort | uniq -c
git diff --stat 48cf0a1 HEAD -- contracts packages deployments LICENSE
curl -s -o /dev/null -w '%{http_code}\n' https://crewtrace-showcase.pages.dev/
curl -s 'https://crewtrace-showcase.pages.dev/api/web?action=collaboration-config'
curl -s "https://$(cat .local/tunnel-url | sed 's#https://##')/health"
```

MCP 工具计数使用 `.local/tunnel-url` 的 `/mcp` 端点执行 `initialize` 与 `tools/list`，统计返回的 `name` 字段。
