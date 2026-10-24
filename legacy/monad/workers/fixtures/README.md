两份 CSV 由本项目 Agent 在比赛开发期间编写，全部为公开合成业务示例，不含真实商户信息。

round-1.csv 有 36 条输入记录；R105、R121 各重复一次。round-2.csv 有 38 条输入记录；R204、R230 各重复一次。日期使用 business-csv-v1 规定的 yyyy-MM-dd、yyyy/MM/dd、yyyy/M/d 格式。

规则：字段与次序固定；日期统一为 yyyy-MM-dd；金额使用十进制并保留两位小数；orders 为非负安全整数；按 record_id 排序；相同 record_id 经规范化后内容相同则保留一条，内容冲突立即拒绝。其他必需字段缺失或未知日期格式立即拒绝。输入文件按原始 UTF-8 字节计算 keccak256，未作换行转换。
