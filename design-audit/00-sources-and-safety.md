# 来源、执行状态与安全边界

审查日期：2026-10-19。审查对象：本地 CrewTrace 开发版本，不把旧审查记录中的问题自动当作现状。

## 固定来源

十三仓库快照位于 `/Users/francis/Documents/Codex/2026-10-19/referenced-chatgpt-conversation-this-is-an-2/work/design-skill-audit/sources/`。同级的 `manifest.json`、`SOURCE-SHA256SUMS.txt`、`审查报告.md`、`新增五仓库审查报告.md` 和 `原八仓库审查报告.md` 为来源与既有静态安全证据。另一个汇总副本位于 `/Users/francis/.codex/design-skill-downloads/2026-10-19/`。

本轮执行 `shasum -a 256 --quiet -c SOURCE-SHA256SUMS.txt`，退出 0。它只证明快照与清单一致，不证明软件无恶意。既有报告明确没有“十三个都已证明安全”的结论。因此本轮按能力缩小范围：安全审查过的文本用于人工审查；仅 UI UX Pro Max 的已检查、无持久化本地搜索获准执行。高风险完整工具链没有启用。没有重新下载上游 main。

## 逐项登记

| 序号 / 目录 | 固定 commit | 性质与实际入口 | 依赖及安全边界 | 本轮状态 |
|---|---|---|---|---|
| 01 `Leonxlnx__taste-skill` | `f624f37a8c650b9cc550253104925efe4c8de246` | 集合；`skills/taste-skill/SKILL.md`，design-taste-frontend | 完整流程 Node22+/Chrome/CDP、写文件及资产网络；中风险 | 仅文档方法，限首页；未执行 inspect/lint/draw |
| 02 `pbakaus__impeccable` | `2f46b7a8b059af00d20dd13b64dbe165e7c6a742` | 原生工具链；`.agents/skills/impeccable/SKILL.md` 与 audit 引用 | 引擎下载、hooks、浏览器及外部能力；高风险 | 仅文档方法；原生 context/detect 未运行 |
| 03 `nextlevelbuilder__ui-ux-pro-max-skill` | `56ea9cf174ed86786187daa9de0e6247cb0747e4` | 知识库/多 Skill/CLI；`.claude/skills/ui-ux-pro-max` | 完整包中风险；核心查询仅 Python 标准库、CSV读取 | 实际执行4次离线查询；没有 persist、CLI安装或生成资产 |
| 04 `anthropics__skills` | `dbd4588f9e1033efb41dad4bef2f7947c8993d44` | 集合中的独立文本 frontend-design；快照只包含此子集 | 无运行依赖；低风险文本 | 实际应用文本 Skill；无外部引擎 |
| 05 `emilkowalski__skills` | `2d228630ba1446365f614a108cb8252f1feda202` | 集合中的 `skills/emil-design-eng/SKILL.md` | 选择的文本模块低风险；无需安装动效库 | 实际应用文本 Skill |
| 06 `vercel-labs__agent-skills` | `063bee94c3f4df8453406c830b0a7df0f2860278` | 集合中的 web-design-guidelines | 原版动态读取规则为中风险；发布能力高风险 | 仅参考安全包内固定规则，未执行动态原流程 |
| 07 `ihlamury__design-skills` | `126714ec5df13a2c97ce1b3975e5a51d2592d967` | 87个品牌文本模块；选择 linear-ui-skills | 文本低风险；设计值质量和品牌许可另有边界 | 应用相关文本原则；Awwwards预设不适用，未用全87项 |
| 08 `garrytan__gstack` | `67783c18857ebbcf5257dcc4a237435311869051` | 多角色编排；design-review | Claude/Bun/Aside或自带浏览器、原生构建、遥测等；高风险 | 仅参考审查阶段，未初始化或启动框架 |
| 09 `hueyexe__frontend-agent-skills` | `2841c079dd8a9c634882227194dc42e25227710d` | 9个主题文本模块；information-architecture-navigation | 文本低风险，无运行依赖；外部安装器未获批准 | 实际应用所选文本 Skill |
| 10 `frankxai__awesome-design-agent-skills` | `9a6b8fe9f0ccf8b851863485b76143c54f33df7e` | 导航/排名/辅助脚本，无SKILL.md | 阅读低风险；辅助脚本中风险、外链未审 | 不适用于独立审查，无虚构运行 |
| 11 `finfin__awesome-frontend-skills` | `02eaf8cc8065a97aa62a058e2c77ff1effab20e4` | 纯导航，无SKILL.md | 阅读低风险，外链工具不在安全结论内 | 不适用于独立审查 |
| 12 `h3nryprod01__design-taste` | `e0f7e23662a859cadd8b481d59c59a7c177b2c73` | 单一合成 Skill，来自3个上游 | Node20+ preflight与联网漂移脚本，中风险；文本可读 | 仅文档参考，未运行完整preflight |
| 13 `JaimeJunr__claude-code-frontend-skills` | `07a8f285a0646c99adcba7712867ddda4e098ac4` | Claude插件市场/路由框架，37个Skill | 插件下载、外部API、凭证等完整能力高风险 | 仅参考路由/评审文档，未启动Agent或插件 |

Vercel 规则固定补充文件为 `evidence/remote-guidelines-command.md`，来源 commit `434b7f91364665f2f733b310ec54809bf8f37937`。第13项的 `UPSTREAM.lock` 是另一套历史快照，不能把其调用算为本轮原版的新执行。

## 执行口径

5 项实际应用了所选安全能力：其中 03 运行本地查询，04、05、07、09 是直接读取并遵循文本方法；文本 Skill 没有必须存在的可执行命令。6 项仅参考文档：01、02、06、08、12、13，其原生完整流程未执行。2 项为导航、不适用：10、11。

“未执行”不等于全部由环境故障造成：02、08、13受完整运行的安全边界限制；01、06、12为保持固定来源和只读范围，选择了文档模式。不能说十三项全都运行成功。

所有独立报告由同一审查者按用户顺序形成，使用共同的原始产品证据，生成各报告时不读取其他报告的结论。不是十三名盲审评委；同源文本和同一观察不能累加成统计置信度。完成十三份后才作综合归并。

## 本轮实际工具证据

`evidence/capture.mjs` 与 `checks.mjs` 是本轮编写的只读取证程序，使用已有 Playwright 和 Chrome，隔离匿名 context，不读取用户浏览器登录态。仅访问真实本地前端及其现有接口；没有注册、发布、认领、交付、交易。断网检查使用浏览器网络离线开关，不伪造接口响应。

`evidence/observations.json` 保留页面请求、状态与错误记录；`checks.json` 保留键盘、历史、草稿及视图恢复结果。`stage-test.json` 为原项目已有 `browser-stage.spec.ts` 的实际运行报告，2/2通过。其余可能写入业务数据的 browser-public 测试没有运行。软件 WebGL 的无头浏览器不代表真机GPU性能。

UI UX Pro Max 的4份 JSON 查询结果保存在 evidence 下，使用 `python3 -B` 运行已检查入口，query 为导航返回、错误及React相关规则。搜索结果只作为原则来源，不能替代实际页面证据。
