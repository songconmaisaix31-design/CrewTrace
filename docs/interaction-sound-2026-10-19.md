# 交互音效

默认关闭。顶部扬声器开关单独控制声音，与暂停视觉动画独立；浏览器本地保存选择，刷新后仍需主动交互才能启动音频。未添加背景音乐、悬停音效或震动。

使用 Web Audio 实时合成短音，不新增依赖或第三方音频资产。点击是约 65 毫秒的短音；页面真实切换时播放约 180 毫秒的低频滑音，不随每个滚轮事件重复；操作成功提示使用两个柔和音程，只在表单或修改操作 Promise 成功后触发。失败不播放成功音，声音异常单独提示，不改变业务操作结果。

采用短渐入和渐出，主音量增益 0.22；快速重复触发做限频，静音立即阻止新声音并淡出已有声音。隐藏页面不触发新声音，输入文字、悬停和数据轮询保持安静。英文界面同步翻译开关与错误提示。

实现参考：[MDN Web Audio 最佳实践](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices)，使用用户手势启动音频，不绕过浏览器自动播放限制。

验证：构建通过，14 项浏览器测试通过。使用真实 Web Audio 事件核对默认无音频上下文、主动开启、切页与点击生成音源、静音不再发声和开关持久化；使用 OfflineAudioContext 实际渲染三种波形，检查能量、峰值与结束静音。320/390 像素布局与既有协作流程通过。回归中补充了停顿后力度明显较轻的新滑动起步判断，避免被上次强滑动吞掉；相关惯性和连续手势测试另重复两轮通过。真实手机音频输出、扬声器听感和成功写入后的提示未执行端到端验证，未发布任何测试记录。

## 音乐试听候选

以下仅核对作品页面和风格说明，未下载、接入或宣称完成听感验收。

[Outer Space (Ambient Drone Soundscape)，Musinova](https://pixabay.com/music/ambient-outer-space-ambient-drone-soundscape-368993/)：页面标注为慢速、柔和、极简氛围音乐，时长 2:48，可优先试听是否适合圆环首页。页面声明适用 [Pixabay Content License](https://pixabay.com/service/license-summary/)。正式使用前应保存当时的曲目与授权证明，不将未经修改的音频作为独立素材分发。

[Ambient Technology，Ivan_Luzan](https://pixabay.com/music/corporate-ambient-technology-162004/)：页面标注科技、电子与背景用途，时长 2:13，可作为带节奏的对照试听候选；页面同样声明适用 Pixabay Content License。作者说明部分作品可能触发 Content ID，选定后需核对该曲目并保存下载凭据。尚未作为网站素材使用。

选定后单独决定是否用于首页；进入工作区应淡出，用户仍可关闭，不与交互音效共用不可分离的开关。
