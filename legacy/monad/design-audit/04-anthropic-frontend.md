# 04 · Anthropic Frontend Design

## 入口与方法

来源 `anthropics/skills@dbd4588f9e1033efb41dad4bef2f7947c8993d44`，本地仅保留 `skills/frontend-design` 与根 README/许可；实际名称 `frontend-design`。这是独立文本 Skill，所属仓库是集合。安全报告列为低风险，无脚本运行依赖，已阅读并应用完整 SKILL 的 subject-grounding、typography、structural meaning、restraint、end-user writing 原则。

**状态：实际加载文本 Skill 完成审查；没有独立命令或外部引擎执行。** 使用本轮真实 screenshots 和组件，未参考其他审查报告。原 Skill 的 build 阶段依用户只审查要求跳过；不生成界面、不画 ASCII、不重新指定品牌。

## 视觉与内容结论

**A1 · 01/02 看起来像连续步骤，内容实际上是两个并列目的地（P2，信息设计判断）。** Skill 要求编号表达实际顺序。协作任务与交流公告既可单独访问，也不要求先完成01再操作02；现有切页形式强化了“下一阶段”的误解。建议保留同位置过渡，但主标签直接用“任务 / 交流与公告”，序号退为可选装饰或移除。用户曾指定01/02，故此为需确认的建议，绝不自动删除。证据：`CollaborationStage.tsx:13–17`，[tasks-desktop](evidence/tasks-desktop.png)、[discussion-desktop](evidence/discussion-desktop.png)。

**A2 · 主入口和主说明的文字优先级倒置（P2，审美与理解判断）。** Hero最醒目文字在动画层，稳定产品标题放在加入按钮下面。访客看到动作在先，对加入的对象和回报理解在后。原则：most characteristic thing / type hierarchy / words help navigation。建议圆环保持主角，稳定用途句在加入动作前形成同一组，文字大小只做清晰一级差；不再额外加一段重复小字。证据：[home-desktop](evidence/home-desktop.png)、[home-mobile-en](evidence/home-mobile-en.png)，`LensHero.tsx`、`lens-hero.css`。

**A3 · 空状态没有给出直接下一步（P2）。** 选择“已取消”后只显示“当前页暂无符合条件的任务”。原则：failure and emptiness as moments for direction。用户须自己把筛选切回全部；建议空状态明确当前筛选并提供“查看全部任务”。与全站没有任务、服务未加载三种情况分开。证据：[tasks-filter-cancelled](evidence/tasks-filter-cancelled.png)，`PublicWorkspace.tsx:165`。

**A4 · 页面主题稳定，工作区信息层级偏弱（P2，视觉判断）。** 暗紫背景、作者时间、标题、状态和金额都落在较相近的紫灰层级，真实任务标题只有17px，发布按钮却是最亮的实心块。对只想认领任务的访客，任务内容没有成为工作区重心。原则：spend boldness in one place / structural devices encode information。建议标题与下一步操作提高一级，时间继续辅助，模拟金额与说明同组；不通过普遍增加光效解决。证据：`observations.json`、`tasks-desktop.png`、`experience-polish.css` 与相关有效样式。

## 应保留的设计

圆环已形成明确视觉主体；桌面与手机都有统一紫白色调；主界面未堆叠大量无关营销卡片。深色、渐变、箭头及紫色是项目已确认风格，Skill明确“brief wins”，不把它们单独当作 AI 生成缺陷。真正需要加强的是标题、真实任务信息和操作之间的关系。上述影响为专业推断，尚无新用户理解测试或转化数据。
