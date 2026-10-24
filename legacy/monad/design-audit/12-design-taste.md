# 12 · Design Taste

## 来源、范围与执行状态

来源 `h3nryprod01/design-taste`，固定版本 `e0f7e23662a859cadd8b481d59c59a7c177b2c73`，Skill 名 `design-taste`，版本 2.1.0。已阅读 README、根 SKILL、`reference/pre-flight.md` 和 `reference/interaction-states.md`。它明确是 Emil、Impeccable 和 Taste 的合并文本，并非第四套独立研究证据。

设计解读：CrewTrace 是面向 Agent 协作参与者的暗色科技展示入口和任务工作区。首页以圆环为主题，工作区应优先阅读与操作。用于解读的强度参数为首页 variance 6 / motion 7 / density 3，工作区 3 / 3 / 6；这是方法的分类参数，不是质量评分。

**执行状态：仅参考文档。** 原流程要求运行 Node preflight，再检查全部矩阵。既有安全报告允许文本阅读并指出执行边界；本轮没有运行 preflight 或联网 upstream-drift，也没有宣称完成完整预检。以下是相关操作状态和表现层的人工检查，不是机械扫描结果。

## Before / After / Why

“After”均为待确认建议，本轮未实施。

| 编号 / 程度 | Before 与证据 | After（建议） | Why / 证据性质 |
|---|---|---|---|
| D1 / P2 | 390px 交流中的“展开阅读”高度约 23.5px；[截图](evidence/discussion-390.png)、`evidence/observations.json` | 保留文字外观，扩大独立点击区至接近 44px，确保相邻目标不重叠 | 该 Skill 的触控目标原则有助于单手点击；WCAG 2.2 的 24px 规则有间距等例外，本项不直接宣告 WCAG 失败 |
| D2 / P2 | 工作区开启前后仍采用同一整体表演语言；[桌面任务](evidence/tasks-desktop.png)、[手机交流](evidence/discussion-390.png) | 品牌／主入口可扫光，操作标签与正文稳定，选中只用一处明确强调 | 按 Operate 模式区分装饰与状态。保留用户指定科技感，减轻日常读取的视觉竞争；属于设计判断 |
| D3 / P2 | [横屏工作区](evidence/tasks-844.png) 阅读区域约 181px，页面没有横向溢出但必须频繁内部滚动 | 矮屏缩短标题、工具条与标签之间距离，让内容与底部导航分享空间；不改为无止境嵌套滚动 | 响应式是任务空间重新分配，不能只以“没有溢出”判定优秀 |
| D4 / P2 | 通用表单只有尾部错误摘要，`apps/web/src/ActionForm.tsx:18` | 字段错误与相应输入关联，仍保留总体请求错误；失败保留输入 | 八状态模型中错误需要可定位。代码可确认结构，未提交真实表单制造错误 |

## 矩阵边界与不采纳的规则

已观察：原生居中 dialog、可见 label、输入字号 16px、可用关闭按钮、暂停入口、独立减少动态效果状态、窄屏无水平溢出。没有完成逐像素对比度、Core Web Vitals、所有身份权限及全部八状态验证，不能把它们勾成通过。

该文档禁止渐变文字、紫色默认主题、某些标点及所有手绘 SVG；这些不自动构成 CrewTrace 缺陷。紫色和圆环来自用户明确选择，标点本身不能证明 AI 生成。它的“永远不做键盘动画”“嵌套卡片永远错误”也需要场景判断。本轮保留实用的状态与触控原则，不用审美禁令替代证据。
