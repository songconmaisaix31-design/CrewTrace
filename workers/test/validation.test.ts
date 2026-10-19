import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { contentHash, jsonBytes } from "../src/content.ts";
import { canonicalCsv, inspectInput } from "../src/data.ts";
import { computeMetrics } from "../src/metrics.ts";
import { StepModel } from "../src/model.ts";
import { generatePrivateKey } from "viem/accounts";
import { WorkerHttp } from "../src/http.ts";
import { readProduct, productBytes } from "../src/product.ts";
import { validateAnalysis, validateData, validateReport } from "../src/validator.ts";
import { loadWorkerChain } from "../src/chain.ts";

const root = new URL("../", import.meta.url);
async function round(number: number) {
  const directory = new URL(`evidence/round-${number}/`, root);
  const [source, data, plan, metrics, report, markdown] = await Promise.all([
    readFile(new URL(`fixtures/round-${number}.csv`, root)), readFile(new URL("data.csv", directory)),
    readFile(new URL("data-plan.json", directory)), readFile(new URL("metrics.json", directory)),
    readFile(new URL("report.json", directory)), readFile(new URL("report.md", directory)),
  ]);
  return { source, data, plan, metrics, report, markdown };
}

for (const [number, inputRows, rows, sales, orders] of [[1, 36, 34, "10073.55", "373"], [2, 38, 36, "12273.00", "439"]] as const) {
  test(`真实模型产物 round-${number}：重算、统计与所有 claims 一致`, async () => {
    const artifacts = await round(number);
    const inspected = inspectInput(artifacts.source);
    assert.equal(inspected.profile.sourceRowCount, inputRows);
    assert.equal(inspected.records.length, rows);
    assert.deepEqual(canonicalCsv(inspected.records), artifacts.data);
    const metrics = computeMetrics(inspected.records);
    assert.equal(metrics.find(metric => metric.id === "total.sales_yuan")?.value, sales);
    assert.equal(metrics.find(metric => metric.id === "total.orders")?.value, orders);
    assert.equal(metrics.find(metric => metric.id === "total.records")?.value, String(rows));
    validateData(artifacts.source, artifacts.data, artifacts.plan);
    const result = validateReport(artifacts.source, artifacts.data, artifacts.metrics, artifacts.report, artifacts.markdown);
    assert.equal(result.normalizedRows, rows);
    assert.equal(result.metricsCount, 64);
    assert.ok(result.claimsCount >= 3);
  });
}

test("规范化数据、指标及报告分别篡改都会被原始输入重算拒绝", async () => {
  const a = await round(1);
  const rows = parse(a.data.toString(), { columns: true }) as Record<string, string>[];
  rows[0].sales_yuan = "999999.99";
  const changedData = Buffer.from(stringify(rows, { header: true }));
  assert.throws(() => validateData(a.source, changedData), /原始输入重算/);
  const metrics = JSON.parse(a.metrics.toString());
  metrics.metrics[0].value = "999999.99";
  assert.throws(() => validateAnalysis(a.source, a.data, jsonBytes(metrics)), /原始输入重算/);
  const report = JSON.parse(a.report.toString());
  report.claims[0].value = "999999.99";
  assert.throws(() => validateReport(a.source, a.data, a.metrics, jsonBytes(report)), /数值不符/);
  report.claims[0].metricId = "nonexistent.metric";
  assert.throws(() => validateReport(a.source, a.data, a.metrics, jsonBytes(report)));
  assert.throws(() => validateReport(a.source, a.data, a.metrics, a.report, Buffer.concat([a.markdown, Buffer.from("额外数值：999999\n")])));
});

test("缺字段、日期无效、同 ID 冲突与缺少报告引用立即拒绝", async () => {
  const a = await round(2);
  const matrix = parse(a.source.toString()) as string[][];
  assert.throws(() => inspectInput(Buffer.from(stringify(matrix.map(row => row.slice(0, -1))))), /字段必须严格/);
  const invalidDate = structuredClone(matrix);
  invalidDate[1][1] = "2026-02-30";
  assert.throws(() => inspectInput(Buffer.from(stringify(invalidDate))), /无效的日期/);
  const conflict = structuredClone(matrix);
  conflict.push([...conflict[1]]);
  conflict.at(-1)![3] = "0.01";
  assert.throws(() => inspectInput(Buffer.from(stringify(conflict))), /冲突记录/);
  const report = JSON.parse(a.report.toString());
  delete report.claims;
  assert.throws(() => validateReport(a.source, a.data, a.metrics, jsonBytes(report)));
  const missingValue = JSON.parse(a.report.toString());
  delete missingValue.claims[0].value;
  assert.throws(() => validateReport(a.source, a.data, a.metrics, jsonBytes(missingValue)));
});

test("产物包对真实文件逐项核对原始摘要与 schema", async () => {
  const a = await round(1);
  const bytes = productBytes("DATA", a.source, { "data.csv": a.data, "data-plan.json": a.plan }, []);
  const product = readProduct(bytes.toString());
  assert.equal(product.sourceHash, contentHash(a.source));
  assert.equal(product.files[0].contentHash, contentHash(a.data));
  const changed = JSON.parse(bytes.toString());
  changed.files[0].content += "\n";
  assert.throws(() => readProduct(JSON.stringify(changed)), /文件摘要不符/);
  const missing = JSON.parse(bytes.toString());
  delete missing.files[0].schemaVersion;
  assert.throws(() => readProduct(JSON.stringify(missing)));
});

test("未配置模型和链立即拒绝，完全不调用替代服务", async () => {
  assert.throws(() => new StepModel({}), /缺少 STEP_API_KEY/);
  await assert.rejects(() => loadWorkerChain(generatePrivateKey(), {}), /真实链适配器/);
});

test("HTTP 客户端在发送请求前拒绝跨源产物 URI", async () => {
  const client = new WorkerHttp("http://127.0.0.1:3400", "");
  await assert.rejects(() => client.download("https://api.stepfun.com/v1/models"), /禁止向其他源发送/);
});
