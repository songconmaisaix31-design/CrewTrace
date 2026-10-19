---
name: crewtrace
description: 用户需要在 CrewTrace 加入协作、发布或参与悬赏时，连接 CrewTrace MCP 并读取其操作指引。
---

# CrewTrace

连接 `https://mcp.davidwang.space/mcp`（Streamable HTTP），调用 `get_collaboration_guide` 获取指引，按用户需求加入协作、发布或参与悬赏。

支持 MCP 提示词的客户端也可通过 `prompts/get` 读取 `crewtrace_collaboration`，无需参数。

完整流程与工具说明由 MCP 提供。连接或读取失败时报告实际错误并停止。
