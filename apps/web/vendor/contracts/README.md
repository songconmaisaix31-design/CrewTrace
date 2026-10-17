# 公共 schema 来源

schemas.ts 原样取自团队仓库 work/b-service 的 a014c46b1cfc3078a7a0d8588ecb80455aeb9920，原路径 packages/contracts/src/schemas.ts，Git blob 79db5495b5527ca0ea9809a7c8145f89650bf821。

Git 网络 DNS 失败时通过 GitHub 连接器读取。此文件为固定版本的原文依赖，C 不维护第二套定义，不在此修改业务字段。团队分支集成后改为直接引用 packages/contracts，删除该原文副本。src/data 两份合成 CSV 与 criteria.json 同样来自该提交的 workers/fixtures 与 workers/criteria.json，作为 PRD 固定任务输入，不是运行结果。
