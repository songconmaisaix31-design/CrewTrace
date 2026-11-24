# 个人仓库到团队实验分支的安全同步方案

## 目标与边界

把个人仓库 `NextVariable/crewtrace-v2` 的 `feat/payathon-commerce` 同步到团队仓库 `songconmaisaix31-design/CrewTrace` 的独立实验分支，供团队评审与后续联调。不同步到 main，不发起自动合并，不修改团队 main 的历史，不写入任何团队凭据。同步需要团队明确授权后才执行，本文件只描述方案与检查结果。

## 推荐方式：受控快照分支

在团队仓库新建 `experiment/payathon-beta` 分支，内容取个人分支在 `b7786bdf9ca3a7611d7ce11345dbdd2864b526e8` 的工作树，整理为一次提交。提交信息写明来源仓库、来源分支、来源 HEAD 与个人贡献范围。团队 main 保持 `48cf0a112ec8cd9df9cc7bdb7d20dc89ce5aeaaf` 不变，原团队历史不被改写。

选择快照方式的原因有三点。个人历史包含 121 个以个人账号提交的 Commit，作者邮箱为个人邮箱；完整推送会把个人邮箱与个人工作节奏一并带入团队仓库。历史中的文档新增了两处个人账号信息，需要在共享前处理，快照方式只需处理最终文件。团队仓库的历史保持单一来源，评审时看到的是一个可对照的增量版本，而不是 281 个提交的混合历史。

如果团队希望保留逐提交记录，可改用完整历史推送：在个人仓库的副本上用 `git filter-repo --replace-text` 清理个人邮箱与账号信息，再推送到独立分支。该方式需要重写副本历史，工作量大且容易遗漏，不作为首选。

## 共享前必须处理的内容

个人新增文档中有两处个人支付宝与 Cloudflare 账号信息。`docs/payathon-precheck.md` 中记录了个人支付宝账号邮箱与 Cloudflare 账号 ID，`docs/v2-showcase-deployment.md` 中记录了同一个账号 ID。共享前把账号 ID 替换为“团队 Cloudflare 账号待确认”，把个人邮箱替换为团队联系渠道。这两处是账号标识，不是密钥，但仍属于个人账号信息。

`design-audit/` 下的证据文件包含本机绝对路径 `/Users/francis/...`。这些文件来自团队 main，`git diff 48cf0a1 HEAD -- design-audit` 为空，个人分支没有新增这类路径。共享到团队仓库不会扩大已有暴露范围；若团队希望清理，可单独处理，不影响本次同步。

`.local/` 目录包含数据库数据目录、运行日志、隧道地址、管理令牌与 Worker 环境文件，已被 `.gitignore` 忽略，没有进入任何提交。`docs/v2-showcase-deployment.md` 与 `DEPLOYMENT.md` 只使用 `trycloudflare.com` 的通用域名说明，没有提交真实隧道地址。

## 历史扫描结果

对全部 281 个提交执行 `git log --all -p` 并检索常见凭证特征，未发现 GitHub Token、Cloudflare API Token、支付宝应用私钥、SSH 私钥或 `sk-` 长密钥。`gh[pousr]_`、`BEGIN ... PRIVATE KEY`、`oauth_token` 的命中数为零。`sk-[A-Za-z0-9]{24,}` 的命中数为零，早期宽泛匹配到的 323 处是 `task-` 等普通单词。

`.env` 相关文件只存在于 `apps/web/.env.example`、`contracts/.env.example`、`services/runtime/.env.example` 三个示例文件，内容是变量名与占位说明，没有真实值。仓库没有提交 `wrangler.toml` 凭证、Pages 部署令牌或数据库连接串。

邮箱扫描结果为 `yunhe.liu68@gmail.com` 一处（个人新增文档），`alice@example.com` 与 `bob@example.com` 各两处（测试示例）。没有手机号。仓库内的 CSV 只有 `workers/evidence/round-1`、`round-2` 与 `workers/fixtures` 的固定样例，没有真实用户订单数据；订单数据只存在于本机数据库。

## 归属与许可证

团队仓库与个人仓库均为 Apache-2.0，`LICENSE` 未改动。快照提交保留原团队作者与原始提交引用，在提交信息与 `docs/portfolio/PERSONAL-CONTRIBUTIONS.md` 中标注个人贡献范围。`README.md` 已声明团队来源、原仓库链接与个人扩展关系，同步后继续保持。不删除团队原有的 `design-audit/`、`tasks/`、`docs/evidence/` 等材料。

## 执行步骤与授权点

团队确认同步后，先在个人仓库完成两处账号信息替换并提交，重新运行一次凭证扫描，然后在团队仓库创建独立分支并推送快照。分支创建后由团队自行决定是否合并、何时合并；本方案不发起向 main 的合并请求，不 force push，不覆盖团队历史。

在获得团队授权前，不向团队仓库写入分支、提交或改动设置。同步完成后由团队核对来源 HEAD、许可证、贡献列表与两处脱敏结果，再决定是否用于参赛提交。
