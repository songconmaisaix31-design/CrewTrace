// 与 packages/chain/src/collaboration.ts 的 canonicalJson 保持一致。
// 该副本让 SDK 可以独立安装，不依赖仓库内其他包的源码路径；
// 一致性由 test/runtime-csv.test.ts 对照检查。
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}
