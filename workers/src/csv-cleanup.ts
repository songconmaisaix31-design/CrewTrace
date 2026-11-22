import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

export const CSV_WORKER_MODES = ['copy', 'normalize', 'deduplicate'] as const;
export type CsvWorkerMode = typeof CSV_WORKER_MODES[number];

export function executeCsvCleanup(source: string, mode: CsvWorkerMode): string {
  if (mode === 'copy') return source;
  const rows: string[][] = parse(source, { bom: true });
  const [header, ...data] = rows;
  const seen = new Set<string>();
  const normalized = data.flatMap(([rawId, rawAmount]) => {
    const id = rawId.trim();
    const amount = rawAmount.trim();
    if (mode === 'normalize') return [[id, amount]];
    if (seen.has(id)) return [];
    seen.add(id);
    return [[id, amount]];
  });
  return stringify([header, ...normalized]);
}
