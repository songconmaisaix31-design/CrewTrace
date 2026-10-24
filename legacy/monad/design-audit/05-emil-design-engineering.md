# 05 · Emil Kowalski Design Engineering

## 调用与方法

来源 `emilkowalski/skills@2d228630ba1446365f614a108cb8252f1feda202`。独立文本模块 `skills/emil-design-eng/SKILL.md`，所属仓库是设计工程 Skill 集合。已读取 README 与完整主 Skill。低风险文本模块，无执行依赖；未安装 Motion、Sonner、Base UI 或其他库。

**状态：实际加载文本 Skill，按 frequency→purpose→easing→duration 框架和 Before/After/Why 格式完成审查。** 原版对无具体问题才要求只输出准备语，本轮已有明确审查问题，无需等待。没有采用其他 Skill 的结论。

证据包括本轮只读 `browser-stage.spec.ts` 执行、源码与桌面/手机画面。真实手指、触控板和硬件帧率未验证；不能把自动合成手势通过等同“完全丝滑”。

## 动效决策

首页圆环属于低频品牌体验，可保留较强表达；任务和消息切换属于高频操作，应优先连续、可打断和空间稳定。预览需要初始防误触延迟；连续浏览多个入口时每次重复完整延迟的价值较小。已有暂停、reduced-motion、短距离位移和更快退出是正向实现。

| Before（当前证据） | After（建议，未实现） | Why / 影响 / 严重程度 |
|---|---|---|
| `HoverPreview.tsx:12` 每个入口均等250ms；不共享上一个预览的激活时间 | 保留第一次延迟，同一组预览短期连续切换时跳过或缩短延迟 | Emil 的 subsequent hovers；连续扫任务时减少等待。E1/P2，代码事实，收益为推断 |
| `HoverPreview.tsx` leave 在200ms后启动140ms退出关键帧，重新移入会把 closing 设false并重新播放入场 | 用可反向的 opacity/transform transition，从当前状态继续 | interruptibility；避免快速移出再移入的闪回。E2/P2，源码风险，尚未记录高速相机证据 |
| `ExperienceScreens.tsx:23–52` 同一滚动在内部承担阅读，到边缘又承担切页；识别结果只有跨阈值时才可见 | 保留用户要求的滑动，但边缘提供明确切页提示/短进度反馈，阅读期间不触发切页；标签和按钮始终可用 | gesture boundaries / feedback；用户无需猜测这一划会读内容还是换页。E3/P2，结构取舍；当前测试未复现永久锁死 |
| `SignalScene.tsx:26` 固定30ms限帧；文字WebGL与CSS自行更新 | 先记录各层帧间隔，再统一更新预算；预计算固定数据，避免只增加动画速度 | perceived speed≠rendering smoothness。E4/P2，源码证实限帧，设备影响未量化 |
| `ExperienceScreens.tsx` PageUp/PageDown 与手势共用转场；未区分频繁键盘导航 | 频繁键盘切换缩短/免除位移动画；保持必要状态提示 | Skill 的 keyboard frequency 原则。E5/P3，个别风格建议，实际使用频率未知 |

## 没有采纳的绝对规则

不机械要求所有按钮 scale(.97)、所有列表 stagger、全部动画少于300ms，也不为物理弹簧新增依赖。320ms跨页转场的时长本身不构成缺陷；关键是首个响应、是否掉帧、能否反向。当前 pause/reduced-motion 和一次长滑先停01的保护应保留。真实设备录制前不宣称这些建议已经解决用户报告的卡顿。
