# co-vibe C 线交接

接管先读取 [STATUS.md](STATUS.md)、[PRD.md](PRD.md) 和 [前端设计记录](docs/c-web-design.md)。后两者分别记录团队产品需求、当前用户确认的 C 线设计及待处理建议。

当前用户为 NextVariable，负责 C。工作目录为 /Users/francis/Desktop/Monad 黑客松/co-vibe，开发分支为 work/c-web，远程仓库为 https://github.com/songconmaisaix31-design/co-vibe 。

用户要求持续将实际进度同步到项目文件，并保存 Git 版本。改动先提交开发分支，合并 main 前由用户确认。版本保存与行为验证分别报告，不能把提交成功称为功能完成。

仓库现有 AGENTS.md 包含 Astrocyte 的历史内容。其历史 S0 状态、其他项目费用授权及专用验证对象不能作为 co-vibe 的业务事实或新增授权；本项目以当前用户指令和 PRD 为准。未在本轮改写团队共享规则。

apps/web 已建立 Vite + React + TypeScript 前端，根目录 npm run dev 启动。说明见 apps/web/README.md。实际服务、链适配和公网尚未连接，不能将页面代码与本地验证写成完整真实运行。B 的 a014c46 原始 schema 暂存 apps/web/vendor/contracts（Git fetch DNS 失败），集成团队分支后改为引用 packages/contracts，C 不修改其业务定义。Firecrawl 未安装或调用。
