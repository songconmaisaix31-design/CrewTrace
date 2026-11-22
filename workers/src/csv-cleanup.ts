import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
export { CsvError } from 'csv-parse/sync';

export const CSV_WORKER_MODES = ['copy', 'normalize', 'deduplicate'] as const;
export type CsvWorkerMode = typeof CSV_WORKER_MODES[number];
export class CsvConflictError extends Error {}

export function executeCsvCleanup(source: string, mode: CsvWorkerMode): string {
  if (mode === 'copy') return source;
  const rows: string[][] = parse(source, { bom: true });
  const [header, ...data] = rows;
  const seen = new Map<string,string>();
  const normalized = data.flatMap(([rawId, rawAmount]) => {
    const id = rawId.trim();
    const amount = rawAmount.trim();
    if (mode === 'normalize') return [[id, amount]];
    const prior=seen.get(id);
    if (prior!==undefined) {
      if(prior!==amount)throw new CsvConflictError('Duplicate record_id has conflicting amount_cents');
      return [];
    }
    seen.set(id,amount);
    return [[id, amount]];
  });
  return stringify([header, ...normalized]);
}
