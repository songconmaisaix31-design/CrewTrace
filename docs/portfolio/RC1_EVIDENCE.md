# Release Candidate 1 验证记录

验证日期 2026-11-22。远程分支 `feat/payathon-commerce` 提交 `5203e5583c402362f93dfcb0ec84bab6a0d1d0e1`（GitHub 仓库对象，内容树与本地提交 `9b91355` 相同）。本地 Node 版本 26.10.0；GitHub Actions 使用项目规定的 Node 24。以下结果均来自实际执行，没有使用 mock 交易或伪造的支付宝成功响应。

## 类型检查与构建

```bash
npx tsc --noEmit -p services/runtime
npm --prefix apps/web run build
```

两项均通过，无类型错误，Web 构建产物写入 `apps/web/dist`。

## 测试结果

Web 测试：

```bash
npm test
```

3 项全部通过：翻译接口跨站拒绝、代理路径白名单、真实 HTTP 服务不暴露服务端密钥。

Worker 测试：

```bash
cd workers && node --import tsx --test test/*.test.ts
```

7 项全部通过：真实模型产物重算、篡改拒绝、字段与报告引用校验、产物摘要核对、未配置模型和链时拒绝、跨源产物 URI 拒绝。

Runtime 测试：

```bash
cd services/runtime
DATABASE_URL=... ADMIN_TOKEN=... PUBLIC_BASE_URL=... \
  node --import tsx --test test/domain/*.test.ts test/portfolio-flow.test.ts \
  test/portfolio-auto.test.ts test/mcp-host.test.ts test/commerce-flow.test.ts \
  test/commerce-payment.test.ts test/commerce-rc1.test.ts test/payment-config.test.ts
```

41 项全部通过，0 失败。新增的支付与 RC1 子测试共 14 项，覆盖以下场景：

- 预下单超时不被判定为远端失败，使用同一商户订单号重试，只保留一条支付记录。
- 预下单结果未知时阻断新交易，同一订单号重试成功后进入待支付。
- 明确拒绝后创建第二次尝试，商户订单号与第一次不同。
- 非管理员不能关闭未知支付；管理员核对后关闭为失败，订单可以重新发起支付。
- 迟到支付凭证只写入售后证据，不改变订单状态，不重新启动工作流。
- 已付款但执行失败时保留 `VERIFIED` 支付记录和支付事件。
- `PAYMENT_MODE` 默认关闭；模拟支付在缺少确认标记、公开部署、非本地测试环境、生产 `NODE_ENV` 或短密钥时被拒绝。
- 官方模式缺少凭证、服务映射非法、生产环境使用沙箱时被拒绝。
- 免费订单由三个不同 Agent 完成三个步骤。
- 重复订单返回同一订单，重复刷新不新增工作流或交付记录。
- 越权读取订单返回 403。
- 无支付配置时收费服务返回 `PAYMENT_NOT_CONFIGURED`。
- 新数据库实例重新读取订单，验证页面关闭后的恢复。
- 审计事件与订单响应不包含管理密钥或协作凭证。
- 停止常驻 Worker 后，新 Worker 接管；Worker 领取任务后停止，租期到期记录 `TIMEOUT`，新 Worker 重派并完成订单。

## 浏览器验证

本地按 CI 相同方式启动真实 Runtime（`test/portfolio-browser-host.ts`，三个常驻 Worker）与 Vite：

```bash
bash .local/run-browser.sh
```

`browser-portfolio.spec.ts` 通过，耗时 12.3 秒。用例覆盖首页服务展示区（标题“购买或体验可验证的 AI Agent 服务”、“收费服务未开通，免费服务可完整体验”、免费服务“CSV 数据清洗与校验（免费体验）”）、CSV 交接证据与候选排名、页面刷新后排名仍在、三步骤工作流自动分工、连续三次确认交接、成果与信誉入账、运行与评测面板及原始评测记录下载。

上一轮运行 `45006976726` 在最后一步超时，原因是新增服务展示区把协作舞台推到固定视口之外，“确认交接处理”与“运行与评测”按钮被 `.stage-directions` 覆盖。本轮把展示区压缩为两列条带，舞台改为占据剩余高度，内容超出时在容器内滚动，按钮恢复可点击，没有使用 `force` 点击或放宽断言。

## GitHub Actions

运行 `45008586296` 结论 `success`，提交 `5203e5583c402362f93dfcb0ec84bab6a0d1d0e1`，步骤 `checks` 从 2026-11-22T09:39:16Z 运行到 09:42:08Z，包含类型检查、Web 构建、Web 测试、Worker 测试、Runtime 41 项测试、三个常驻 Worker 的浏览器用例和负载基准复现。

运行地址：https://github.com/NextVariable/crewtrace-v2/actions/runs/45008586296

## 支付宝验收脚本

```bash
cd services/runtime
npm run acceptance:alipay
```

结果为 `BLOCKED`，退出码 2：

- 未设置 `ALIPAY_SANDBOX_CONFIRM=yes` 时拒绝执行，避免误操作真实账户。
- 设置确认但缺少 `ALIPAY_APP_ID` 时输出 `BLOCKED`，不发起任何请求。
- 没有真实沙箱商户凭证，因此 `PRECREATE_OK` 和 `VERIFIED` 未取得。

## 部署预检

```bash
cd services/runtime
DATABASE_URL=... ADMIN_TOKEN=... PUBLIC_BASE_URL=http://127.0.0.1:3000 \
  EXPERIMENT_WORKER_AGENT_IDS=id1,id2,id3 npm run preflight:deploy
```

结果为 `LOCAL_BLOCKED`，唯一失败项是本地 Node 26 与要求的 Node 24 不一致。数据库连通、数据库权限、Web 构建产物、Runtime 与 Worker 依赖、公开部署安全约束均通过。云端状态为 `BLOCKED`，因为未取得个人云资源授权，未创建任何云项目。

## 未执行项

- 支付宝沙箱与正式支付：`BLOCKED`，缺少真实商户凭证。
- 个人云独立部署：`BLOCKED`，缺少云资源授权。
