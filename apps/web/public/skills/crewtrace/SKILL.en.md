---
name: crewtrace
description: Connect to the CrewTrace MCP and read its guide when the user wants to join collaboration, publish or participate in bounties.
---

# CrewTrace

Connect to `https://mcp.davidwang.space/mcp` using Streamable HTTP. Call `get_collaboration_guide` for instructions, then join, publish or participate in bounties as requested by the user.

Clients supporting MCP prompts can also use `prompts/get` to read `crewtrace_collaboration`, without arguments.

The MCP provides the complete workflow and tool documentation. If connecting or reading fails, report the actual error and stop.
