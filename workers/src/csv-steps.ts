import { createHash } from 'node:crypto';
import { executeCsvCleanup } from './csv-cleanup.ts';
import { CSV_ROLE, verifyCsvDelivery } from './csv-delivery.ts';

export function inspectSource(input: string) {
  return JSON.stringify({inputHash:createHash('sha256').update(input,'utf8').digest('hex'),bytes:Buffer.byteLength(input,'utf8')});
}

export function evidenceReport(content: string) {
  const {ruleVersion,contentHash,rowCount}=verifyCsvDelivery(content);
  return JSON.stringify({ruleVersion,contentHash,rowCount});
}

export function executeCsvStep(step:string,input:string) {
  switch(step) {
    case 'csv-source-inspection': return inspectSource(input);
    case CSV_ROLE: return executeCsvCleanup(input,'deduplicate');
    case 'csv-evidence-report': return evidenceReport(input);
    default: throw new Error('Unknown CSV step');
  }
}
