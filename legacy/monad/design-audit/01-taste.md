# 01 · Taste Skill

## 来源、适用范围与实际执行状态

来源为 `Leonxlnx/taste-skill`，固定版本 `f624f37a8c650b9cc550253104925efe4c8de246`，读取 `README.md`、`skills/taste-skill/SKILL.md`、`references/critique.md`。实际入口名称是 **design-taste-frontend / tasteskill v2**，整仓是多个 Skill 的集合。路径与安全证据见本目录的来源登记。

**状态：仅参考文档完成视觉审查，未运行原版 lint/inspect/draw。** 原版需要 Node 22+、Chrome 和自己的 CDP 脚本，写入 `.taste-skill`；资产查询还会联网。既有安全报告把完整能力列为中风险，当前任务不执行这组未经运行验证的工具。已有产品的审查无需抽取新方向、寻找图片或修改代码。本次只用项目已有浏览器环境取证，不冒称原版 inspector 通过。

Skill 明确不适用于 dashboard/app screens，因此结论限于首页；工作区截图仅用于判断品牌概念是否有真实内容承接。禁止紫色、渐变、01 编号以及至少四张真实图片等属于其 house style，不能据此否定用户已确认的品牌，也不能当作 WCAG 缺陷。

## 独立视觉检查

观察证据：[桌面](evidence/home-desktop.png)、[平板](evidence/home-768.png)、[手机](evidence/home-390.png)。没有读取其他 Skill 报告作为判断依据。

| 14 次观察 | 当前观察 |
|---|---|
| 一秒主角 | 圆环非常明确，焦点成立 |
| 大小块面 | 圆环、加入按钮、用途句形成三个层次 |
| 遮住 Logo | 容易被理解为一般 AI/科技站，协作履历的特征主要靠一句文字 |
| 边缘 | 首页主入口和用途句共用中心轴；品牌独立在左上 |
| 空间 | 手机圆环下方与按钮之间的间距较大，但没有相互遮挡 |
| 字体 | 用途标题远小于圆环和流动英文；第一眼先看装饰 |
| 色彩 | 深色占主导，紫白强调一致；不将紫色本身记为问题 |
| 图像 | 程序生成圆环有辨识度；没有真实工作成果片段 |
| 布局变化 | 首页中央艺术装置，工作区列表，场景有区分 |
| 手机 | 圆环主体可辨，流动英文常只见少量片段 |
| 充实度 | 首页足够成画面，用途证明不足 |
| 内容实质 | 标题描述“以履历驱动”，没有第一屏可核对的履历实例 |
| 碰撞 | 所看截图未见按钮被覆盖；流动英文裁切为有意视觉效果 |
| 竞争者/活元素 | 鼠标光效可玩，但不帮助理解真实协作结果 |

## 发现

**T1 · 首页的核心承诺缺少直接证据（P2，设计判断）。** 页面：首屏；原则：claim/proof、subject-specific idea、live thing。截图中展示的是圆环和“以履历驱动的 Agent 协作网络”，访客仍需进入任务、打开详情才可能看到协作记录。可能影响首次理解和参与意愿，尚无转化数据证明。建议在保持圆环主角的前提下，把次入口明确写成“查看协作任务”，并在进入工作区后直接展示真实记录的入口；不要编造成功案例或人数。证据：`apps/web/src/LensHero.tsx` 的标题和入口，`PublicFrame.tsx` 的页面结构；上述三张截图。

**T2 · 流动英文承担了过多视觉权重，但无法稳定阅读（P2，风格与可读性取舍）。** 页面：首页平板/手机；原则：one-second focus、phone composition、substance。平板截图中单词 trace 大幅变形；手机只露片段，而用途句较小。它可以作为装饰存在，不能承担关键信息传达。建议保留折射与方向，限制手机文字覆盖范围和峰值亮度，让稳定标题承担说明。截图证据为 `home-768.png`、`home-390.png`；实现为 `LensHero.tsx` 的 shader 与 `lens-hero.css`。未测阅读理解，不能宣称用户一定读错。

**T3 · “起名加入”未说明首次动作的对象（P2，内容设计判断）。** 页面：首页；原则：primary action named for what it does。桌面悬停解释“为你的 Agent 创建或查看身份”，手机首屏没有这句解释。普通访客可能把它理解为个人账号注册。建议将按钮文字或相邻的稳定提示明确为 Agent 身份，保留现有简洁结构。证据：`home-390.png`、`join-preview.png`、`join-dialog.png`，`LensHero.tsx`、`PublicWorkspace.tsx`。是否改按钮名需要用新访客理解测试决定。

## 原版 critique 格式记录

ROUND 1（只审查，无修复循环）。Seen in one second：紫白圆环。Idea：协作网络被表达为动态轨迹，但尚未直接呈现可核对的履历。Live thing：局部光标透镜。Layout：hero=central artwork / workspace=list。

主观 rubric：design 6.5、usability 6、creativity 6、content 6，按原版权重计算 6.2。原版“少于四张图片”“装饰渐变”上限会限制分值；这些与既定品牌冲突，**分数仅用于揭示此 Skill 的偏好，不作为产品总分、行业排名或发布门槛**。最值得处理的是 T1、T3、T2，顺序依据首次理解成本。未运行 inspector，因此没有 FAIL/WARN 数量，也没有最终验收评分。
