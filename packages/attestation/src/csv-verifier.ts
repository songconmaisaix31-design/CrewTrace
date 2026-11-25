import { checksDigest, contentDigest } from './canonical.js';
import { canonicalJson } from './canonical-json.js';
import { evaluateCsv } from './csv.js';
import { compareCsvTransformation } from './transform.js';
import type { VerifierEvaluation, VerifierEvaluationInput } from './verifier.js';

export const CSV_VERIFIER_ID = 'csv-ledger';
export const CSV_VERIFIER_RULE_VERSION = 'csv-ledger-v1';

// CSV 验证器是 V0.1 能力的等价迁移：输入摘要、交付摘要、质量复算与转换比对语义不变。
export function evaluateCsvVerification(input: VerifierEvaluationInput): VerifierEvaluation {
  const { attestation, inputContent, deliveryContent } = input;
  const evaluation: VerifierEvaluation = {
    verifierId: CSV_VERIFIER_ID,
    ruleVersion: attestation.validation.ruleVersion,
    taskType: 'csv-data-review',
    result: 'UNRESOLVED',
    reasons: [],
    checkCodes: [],
    evidenceDigest: checksDigest([]),
    input: 'NOT_PROVIDED',
    content: 'NOT_PROVIDED',
    transformation: 'NOT_ASSERTED',
    outputFormat: 'NOT_ASSERTED',
    fulfillment: 'NOT_ASSERTED',
  };

  if (attestation.evidence) {
    evaluation.reasons.push('EVIDENCE_KIND_MISMATCH');
    evaluation.result = 'FAIL';
    return evaluation;
  }

  if (inputContent != null) {
    const inputHash = contentDigest(inputContent);
    if (inputHash !== attestation.input.contentHash) {
      evaluation.input = 'MISMATCH';
      evaluation.reasons.push('INPUT_HASH_MISMATCH');
    } else {
      evaluation.input = 'MATCH';
      const evaluatedInput = evaluateCsv(inputContent);
      if (evaluatedInput.rowCount !== attestation.input.rowCount) {
        evaluation.reasons.push('INPUT_ROW_COUNT_MISMATCH');
      }
    }
  }

  let qualityPass = false;
  if (deliveryContent != null) {
    const contentHash = contentDigest(deliveryContent);
    if (contentHash !== attestation.delivery.contentHash) {
      evaluation.content = 'MISMATCH';
      evaluation.reasons.push('DELIVERY_HASH_MISMATCH');
    } else {
      evaluation.content = 'MATCH';
      if (attestation.validation.ruleId === CSV_VERIFIER_ID) {
        const evaluated = evaluateCsv(deliveryContent);
        const same = evaluated.ruleVersion === attestation.validation.ruleVersion
          && evaluated.result === attestation.validation.result
          && evaluated.checksDigest === attestation.validation.checksDigest
          && canonicalJson(evaluated.checkCodes) === canonicalJson(attestation.validation.checkCodes)
          && evaluated.rowCount === attestation.delivery.rowCount;
        evaluation.outputFormat = same
          ? (evaluated.result === 'PASS' ? 'RECALCULATED_PASS' : 'RECALCULATED_FAIL')
          : 'RECALCULATED_FAIL';
        qualityPass = same && evaluated.result === 'PASS';
        evaluation.checkCodes = evaluated.checkCodes;
        if (!same) evaluation.reasons.push('QUALITY_MISMATCH');
      } else {
        evaluation.reasons.push('RULE_NOT_IMPLEMENTED');
      }
    }
  }

  if (inputContent != null && deliveryContent != null
    && evaluation.input === 'MATCH' && evaluation.content === 'MATCH') {
    if (attestation.validation.ruleVersion === CSV_VERIFIER_RULE_VERSION) {
      const comparison = compareCsvTransformation(inputContent, deliveryContent);
      evaluation.transformation = comparison.status;
      if (comparison.status === 'MISMATCH') evaluation.reasons.push('TRANSFORM_MISMATCH', ...comparison.reasons);
      if (comparison.status === 'NOT_ASSERTED') evaluation.reasons.push(...comparison.reasons);
      if (comparison.status === 'MATCH' && qualityPass && attestation.validation.result === 'PASS') {
        evaluation.fulfillment = 'RECALCULATED_PASS';
      } else {
        evaluation.fulfillment = 'RECALCULATED_FAIL';
      }
    } else {
      evaluation.reasons.push('TRANSFORM_RULE_NOT_IMPLEMENTED');
    }
  }

  if (evaluation.reasons.length > 0) evaluation.result = 'FAIL';
  else if (evaluation.outputFormat === 'RECALCULATED_PASS' || evaluation.transformation === 'MATCH') {
    evaluation.result = 'PASS';
  }

  evaluation.evidenceDigest = checksDigest(evaluation.checkCodes.length
    ? evaluation.checkCodes
    : [`VERIFIER:${CSV_VERIFIER_ID}@${attestation.validation.ruleVersion}`, `RESULT:${evaluation.result}`]);
  return evaluation;
}
