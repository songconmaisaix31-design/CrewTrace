# 02 · Impeccable

## 入口与执行边界

固定来源 `pbakaus/impeccable@2f46b7a8b059af00d20dd13b64dbe165e7c6a742`，4.6.0。已读取已安装 `impeccable/SKILL.md` 和完整 `reference/audit.md`。这是带原生引擎和多命令的设计工具链；本次选择 Web audit 的五维度方法，首页归 Experience/Persuade，工作区归 Operate。

**状态：仅参考 Skill 文档完成技术审查。** context/detect 引擎可能首次下载二进制；安全报告未验证该发布物及其依赖，不运行。缺少 PRODUCT.md/DESIGN.md 时使用真实项目资料；未生成这些文件，未启用 hook。没有 detector 输出，不能称完整原版 audit 已运行。

## 五维度记录

| 维度 | 本轮结果 | 证据边界 |
|---|---|---|
| 可访问性 | 跳转链接的焦点目的地存在缺陷；已有原生 dialog、字段 label、inert 和 Escape | 实际键盘检查；未运行 VoiceOver 或全量对比度扫描 |
| 性能 | 首页 Canvas 限帧、两个绘制层；全局 will-change 持续存在 | 源码确定，不能把它等同实际设备掉帧 |
| 主题 | 有基础变量，但后加样式大量重复颜色、尺寸和覆盖规则 | 当前 CSS 文件直接可查；不要求新增浅色主题 |
| 响应式 | 390、768、844 横屏均无文档横向溢出，横屏阅读区域明显变短 | Chromium 模拟视窗，非真实手机 |
| 实现一致性 | 空状态、返回和焦点仍有重复性问题；品牌主题可辨认 | 手工检查，不冒充 detector 的 pass/fail |

不提供 /20 健康总分：原版完整扫描、屏幕阅读器和性能测量缺失，评分会把未测项目包装成已验收。

## 已证实问题

**I1 · “跳至公开协作”没有把焦点跳到内容（P1）。** 类别：Accessibility。执行 Tab→Enter 后焦点为 `.experience-shell`；再按 Tab 又回到 skip 链接。视觉页面已切换，键盘用户仍需经过顶部导航。原则：keyboard navigation / bypass repeated blocks。建议 `enter()` 接受焦点目标，跳过链接激活时聚焦 `#collaborate` 或工作区首个主要标题；手势切页不强制把焦点移回根节点。证据：[checks.json](evidence/checks.json) 的 firstFocus/skipFocus/afterSkipTab；`apps/web/src/ExperienceScreens.tsx:12`、`PublicFrame.tsx:22`。这是实测流程缺陷；未宣布全站 WCAG 合规结论。

**I2 · 未选中的面板标签过度降低亮度（P2）。** 类别：Accessibility/Theming。可操作标签使用 `rgb(197,187,210)` 再叠加 `opacity:.48`，视觉接近不可用控件。会降低“02 交流与公告”的可发现性。建议保持可读文字，使用下划线/位置/字重表达选中。证据：`checks.json` tabContrast，[任务截图](evidence/tasks-desktop.png)，`collaboration-stage.css:161` 附近规则及 `experience-polish.css:28`。这里未提供复杂渐变背景的像素对比度测量，不把它写成已认证的 WCAG 失败。

**I3 · 动效与样式规则多层覆盖，缺少统一角色变量（P2）。** 类别：Theming/Integrity。`collaboration-stage.css` 先后定义 .85s、.55s、.36s 转场，最后又由 `experience-polish.css` 接管；颜色、圆角和字号散落在多个文件。影响后续改动可预测性，不能据此断言当前每条规则都生效。建议先用 computed styles 记录有效值，再收敛到一处组件规则和颜色/字体/动效 tokens，保持当前视觉基线。证据：`apps/web/src/collaboration-stage.css:36–87`、`:149–212`，`experience-polish.css:1–59`。建议方法为 document，再小范围规范化；本轮未运行修复命令。

**I4 · 高频圆环动效主动限制到约 30fps（P2，性能风险）。** `SignalScene.tsx:26` 在不足30ms时跳过绘制，与CSS/文字绘制的更新频率不同，可能出现不一致的连续感。每次绘制还计算38×6×31个点并读取布局。建议先在用户设备记录帧耗时，再决定提高频率、预计算三角函数或减少采样；不要直接把全部效果加快。仅能确认实现，不声称已定位全部卡顿原因。

## 正向结果与建议顺序

当前原生弹窗可用 Escape 关闭；隐藏页使用 inert；可选身份资料折叠；消息只在截断时显示展开入口；断网保留最近数据。证据为本轮 screenshots/observations 与源码。

按原版命令分类，后续可对应 harden（焦点/返回）、adapt（横屏与小入口）、document（tokens）、optimize（性能测量）、polish（最终视觉复查）。这些是建议的方法标签，**不授权运行当前未通过执行审查的引擎**。P0=0，P1=1，P2=3；未测链路不纳入通过数。
