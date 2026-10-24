# CrewTrace 后续接手

先阅读 README.md、PRD.md、docs/PAYATHON.md、docs/ACCEPTANCE.md。

运行入口：services/runtime/src/local.ts；领域和数据库事务：service.ts；支付宝官方 SDK：payment.ts；HTTP 与 MCP 共用 Commerce；前端 apps/web/src。数据库 migrations/001_commerce.sql 使用独立 ct_ 表前缀。

用户已授权在分支开发支付宝比赛版本。保留 feat/alipay-payathon，尚未合并 main。历史原版归档在 legacy/monad，保留来源与许可。不得将历史模拟悬赏转换成实际人民币应付款。

下一项依赖是用户在支付宝控制台完成身份、商户、产品开通和服务登记。凭证在安全环境变量中设置，不发到 PR、聊天或文件。配置齐全后继续官方沙箱与小额正式验收，真实结果写入 docs/ACCEPTANCE.md；没有验证的部分维持明确未完成。

构建与测试命令见 README。现有测试使用真实数据库引擎和网络，禁止改为模拟支付宝成功。对外部署使用新的域名、独立 PostgreSQL、HTTPS 和流量限制，再核对前端 API 地址、ALLOWED_ORIGINS、PUBLIC_BASE_URL 与 MCP URL。
