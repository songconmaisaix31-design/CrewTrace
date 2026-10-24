# 03 · UI UX Pro Max

## 实际调用

来源 `nextlevelbuilder/ui-ux-pro-max-skill@56ea9cf174ed86786187daa9de0e6247cb0747e4`。Skill + CSV 知识库 + Python 查询器 + CLI 集合；本次只调用原始快照 `.claude/skills/ui-ux-pro-max/scripts/search.py` 的离线查询。已读取 SKILL、README 使用/依赖章节、quick-reference 的相关优先级及 pro-rules 的适用边界。当前是 React 19.2.8 / Vite 8 / TypeScript Web 产品，不采用原生 iOS 的 pt、Android dp 阈值冒充 Web 合规标准。

安全：既有报告单独审查了核心 Python 标准库搜索；全量快照 SHA-256 校验通过，本轮复核入口的 domain/stack 分支、导入和读写路径。限定的非持久化查询通过使用审查；禁用 CLI、--persist、--design-system、资产生成和安装。使用 `python3 -B` 避免生成字节码。没有读取项目凭证，查询词不含私人内容。

**状态：实际执行 Skill 本地查询，并应用返回原则审查。** 查询日志：[navigation](evidence/uipro-navigation.json)、[errors](evidence/uipro-errors.json)、[React 初次](evidence/uipro-react.json)、[React 重试](evidence/uipro-react-retry.json)。四次退出状态均为0。初次 React 查询只得到通用状态建议，按 Query Contract 重试一次；重试命中字段标签，但未命中草稿持久化专题，不能声称数据库给出了草稿修复方案。所有结果由人机审阅筛选，未机械照搬代码示例。

## 独立结论

**U1 · 浏览器返回与关闭详情语义冲突（P1）。** 原则：Back Button / preserve navigation history。复现：进入任务→Escape关闭→浏览器返回，任务弹窗重新出现。`selectTask('')` 关闭时也 pushState，新历史条目把关闭前弹窗保留为上一页。影响频繁查看多个任务的用户，浏览器返回不再代表回到上一工作位置。建议区分通过列表打开和直达链接进入；列表打开的详情关闭时回退当前详情层，直达详情关闭时替换到任务列表，避免无限追加空 task 状态。证据：`checks.json.backAfterClose`、`PublicWorkspace.tsx:132`。不能简单把全部 pushState 换成 replaceState，否则又损坏任务历史。

**U2 · 表单错误缺少字段定位（P2，源码证实，提交分支未实测）。** 原则：Focusable Error Summary、Error Placement。`ActionForm.tsx:16–20` 仅显示表单底部整体 role=alert，`collaboration-api.ts` 将 Zod 错误归为同一句提示，丢失具体字段路径；用户不能知道是哪一项有问题。原生 required 和 type=url 已提供基础检查，应保留。建议映射字段错误，建立 aria-describedby 与错误摘要链接；多字段失败时再聚焦摘要。未向真实服务提交无效内容，不声称实测服务端错误。

**U3 · 工作区刷新后丢失所选面板（P2）。** 原则：predictable navigation / deep linking。02刷新后回到01，URL只有 #collaborate，没有面板定位。影响分享公告位置和中断后恢复。建议为 tasks/discussion 定义可分享状态并与 history 同步，过滤条件可按实际需求加入。证据：`checks.json.panelBeforeReload=1`、`panelAfterReload=0`；`ExperienceScreens.tsx:5–6`、`CollaborationStage.tsx`。

**U4 · 横屏有效阅读区域偏小（P2，布局取舍）。** 原则：layout responsive / content visibility。844×390 时阅读容器仅181px，任务内容335px、交流480px；标题、切换和操作区占据大部分高度，首条任务摘要已需滚动。仍有可见上下入口，不是导航被裁掉。建议矮屏压缩重复说明与头部，将底部按钮收拢，必要时让工作区自然滚动；避免通过继续缩小正文解决。证据：`observations.json`、[横屏](evidence/tasks-844.png)、`experience-polish.css:48–58`。

## 未发现的问题和局限

字段有真实 label，未发现 placeholder-only 主表单；输入框16px，提交按钮有 busy 禁用；页面已提供手势之外的按钮。不得为了套用 React 搜索结果强制引入 useActionState/useFormStatus。当前并非新建页面，不需要重新生成整套配色。未执行真实注册、发布、支付或端到端履约；安全、性能和无障碍均不作全面认证。
