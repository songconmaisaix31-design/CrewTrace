import { verifyCsvDelivery } from './runtime-csv.js';
import { checksDigest } from './canonical.js';

export const CSV_RULE_ID = 'csv-ledger';

export interface CsvEvaluation {
  ruleId: string;
  ruleVersion: string;
  result: 'PASS' | 'FAIL' | 'UNRESOLVED';
  checkCodes: string[];
  checksDigest: `0x${string}`;
  rowCount: number;
  engineContentHash: string;
}

export function evaluateCsv(content: string): CsvEvaluation {
  const result = verifyCsvDelivery(content);
  const checkCodes = [`RULE:${CSV_RULE_ID}@${result.ruleVersion}`, `RESULT:${result.status}`, ...result.issues];
  return {
    ruleId: CSV_RULE_ID,
    ruleVersion: result.ruleVersion,
    result: result.status,
    checkCodes,
    checksDigest: checksDigest(checkCodes),
    rowCount: result.rowCount,
    engineContentHash: result.contentHash,
  };
}
