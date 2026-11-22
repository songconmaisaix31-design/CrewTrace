import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Database } from '../src/db.js';

/**
 * 独立部署预检（RC2）。
 *
 * 只读检查本地构建产物、运行配置、数据库迁移和连通性，不创建任何云资源，
 * 不发起真实支付，也不读取团队环境。默认输出本地预检结果；
 * 未显式设置 RC2_DEPLOY_AUTHORIZED=yes 时，云部署状态固定为 BLOCKED。
 */

type Check = { name: string; ok: boolean; detail?: string };

const checks: Check[] = [];
const root = resolve(import.meta.dirname, '../../..');

function check(name: string, ok: boolean, detail?: string) {
  checks.push({ name, ok, detail });
}

const nodeMajor = Number(process.versions.node.split('.')[0]);
check('Node 24', nodeMajor === 24, `当前 ${process.versions.node}`);

for (const [name, path] of [
  ['Runtime 依赖', 'services/runtime/node_modules/tsx'],
  ['Worker 依赖', 'workers/node_modules/tsx'],
  ['Web 构建产物', 'apps/web/dist/index.html'],
] as const) {
  check(name, existsSync(resolve(root, path)), path);
}

function env(name: string) {
  return process.env[name]?.trim();
}

const databaseUrl = env('DATABASE_URL');
if (!databaseUrl) {
  check('DATABASE_URL', false, '未设置独立 PostgreSQL 连接串');
} else {
  try {
    const url = new URL(databaseUrl);
    check('DATABASE_URL', ['postgres:', 'postgresql:'].includes(url.protocol), `host=${url.hostname} database=${url.pathname.replace(/^\//, '')}`);
  } catch {
    check('DATABASE_URL', false, '不是合法连接串');
  }
}

const adminToken = env('ADMIN_TOKEN');
check('ADMIN_TOKEN', Boolean(adminToken && adminToken.length >= 32), adminToken ? `长度 ${adminToken.length}` : '未设置或少于 32 位');

const publicBase = env('PUBLIC_BASE_URL');
if (!publicBase) {
  check('PUBLIC_BASE_URL', false, '未设置');
} else {
  try {
    const url = new URL(publicBase);
    const loopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
    check('PUBLIC_BASE_URL', url.protocol === 'https:' || loopback, `${url.protocol}//${url.host}`);
  } catch {
    check('PUBLIC_BASE_URL', false, '不是合法 URL');
  }
}

const mode = env('PAYMENT_MODE') ?? 'disabled';
const deploymentEnv = env('DEPLOYMENT_ENV') ?? 'local';
const publicDeployment = env('PUBLIC_DEPLOYMENT') === 'true';
check('支付模式默认安全', mode === 'disabled' || mode === 'simulated' || mode === 'sandbox' || mode === 'production', mode);
check('公开部署禁用 simulated', !(publicDeployment && mode === 'simulated'), `PUBLIC_DEPLOYMENT=${publicDeployment} PAYMENT_MODE=${mode}`);
check('生产环境禁用 sandbox', !(deploymentEnv === 'production' && mode === 'sandbox'), `DEPLOYMENT_ENV=${deploymentEnv} PAYMENT_MODE=${mode}`);
if (mode === 'simulated') {
  check('simulated 仅限本地或测试', deploymentEnv === 'local' || deploymentEnv === 'test', deploymentEnv);
  check('simulated 需显式确认', env('PAYMENT_SIMULATED_ACK') === 'local-only', env('PAYMENT_SIMULATED_ACK') ?? '未设置');
}
if (mode === 'sandbox' || mode === 'production') {
  for (const key of ['ALIPAY_APP_ID', 'ALIPAY_PRIVATE_KEY', 'ALIPAY_PUBLIC_KEY', 'ALIPAY_SERVICE_IDS']) {
    check(`官方支付配置 ${key}`, Boolean(env(key)), env(key) ? '已设置' : '未设置');
  }
}

const minuteLimit = Number(env('PUBLIC_RATE_LIMIT_PER_MINUTE') ?? 60);
const orderLimit = Number(env('PUBLIC_ORDER_LIMIT_PER_HOUR') ?? 10);
if (publicDeployment) {
  check('公开部署环境标识', deploymentEnv === 'staging' || deploymentEnv === 'production', deploymentEnv);
  check('公开部署 HTTPS', Boolean(publicBase?.startsWith('https://')), publicBase ?? '未设置');
  check('公开部署请求限额', minuteLimit > 0 && orderLimit > 0, `每分钟 ${minuteLimit} 次，每小时 ${orderLimit} 单`);
  check('公开部署来源白名单', Boolean(env('ALLOWED_ORIGINS')), env('ALLOWED_ORIGINS') ?? 'ALLOWED_ORIGINS 为空');
  check('公开部署 NODE_ENV', process.env.NODE_ENV === 'production', process.env.NODE_ENV ?? '未设置');
}

check('免费服务可用', true, 'csv-clean-verify-free 不依赖支付配置');
check('收费服务默认禁用', mode === 'disabled', `PAYMENT_MODE=${mode}`);
check('三个 Worker 常驻', Boolean(env('EXPERIMENT_WORKER_AGENT_IDS')?.split(',').filter(Boolean).length && env('EXPERIMENT_WORKER_AGENT_IDS')!.split(',').filter(Boolean).length >= 3),
  env('EXPERIMENT_WORKER_AGENT_IDS') ? `${env('EXPERIMENT_WORKER_AGENT_IDS')!.split(',').filter(Boolean).length} 个 Agent` : '未设置');

if (databaseUrl) {
  const database = new Database(databaseUrl);
  try {
    const result = await database.pool.query('SELECT current_database() AS database, current_user AS principal');
    check('数据库连通', true, `${result.rows[0].principal}@${result.rows[0].database}`);
    const rights = await database.pool.query(`
      SELECT has_database_privilege(current_database(), 'CONNECT') AS connect,
             has_schema_privilege(current_schema(), 'CREATE') AS create_schema`);
    check('数据库权限', rights.rows[0].connect === true, `CONNECT=${rights.rows[0].connect} CREATE_SCHEMA=${rights.rows[0].create_schema}`);
    const applied = await database.pool.query('SELECT version FROM runtime_migrations ORDER BY version');
    const versions = applied.rows.map(row => String(row.version));
    const required = ['001','002','003','004','005','006','007','008','009','010','011','012','013','014'];
    const missing = required.filter(version => !versions.includes(version));
    check('数据库迁移 001-014', missing.length === 0, missing.length ? `缺少 ${missing.join(',')}` : `已应用 ${versions.length} 个版本`);
    const index = await database.pool.query(
      "SELECT indexdef FROM pg_indexes WHERE schemaname=current_schema() AND indexname='commerce_payments_one_active'");
    check('支付唯一活动索引', Boolean(index.rowCount && index.rows[0].indexdef.includes('UNKNOWN')),
      index.rowCount ? index.rows[0].indexdef : 'commerce_payments_one_active 缺失');
    const catalog = await database.pool.query(
      "SELECT service_id, active, (document->>'priceFen')::int AS price_fen FROM commerce_services");
    const free = catalog.rows.find(row => row.active === true && row.price_fen === 0);
    check('免费服务已上架', Boolean(free), free ? String(free.service_id) : '目录中没有启用的免费服务');
    const paid = catalog.rows.filter(row => row.price_fen > 0);
    check('收费服务默认禁用', mode === 'disabled',
      `${paid.map(row => `${row.service_id}:${row.active ? '已上架' : '未上架'}`).join(',') || '目录中没有收费服务'}；PAYMENT_MODE=${mode} 时下单返回 PAYMENT_NOT_CONFIGURED`);
  } catch (error) {
    check('数据库连通', false, error instanceof Error ? error.message : String(error));
  } finally {
    await database.close();
  }
}

const authorized = env('RC2_DEPLOY_AUTHORIZED') === 'yes';
const localReady = checks.every(item => item.ok);
const cloud = authorized
  ? { status: 'AUTHORIZED', next: '按 DEPLOYMENT.md 的 RC2 清单执行独立云部署' }
  : { status: 'BLOCKED', reason: '未取得个人云资源授权，未创建或修改任何云项目', action: '获得 Neon、Vercel 与 Worker 主机授权并确认费用后设置 RC2_DEPLOY_AUTHORIZED=yes' };

console.log(JSON.stringify({
  status: localReady ? 'LOCAL_READY' : 'LOCAL_BLOCKED',
  checks,
  cloud,
  notes: [
    '本脚本只读检查，不创建云资源，不发起真实支付。',
    'Worker 常驻成本、Vercel 与 Neon 费用需要账户所有者确认。',
    '正式支付宝支付缺少真实商户凭证，状态为 BLOCKED。',
  ],
}, null, 2));
process.exitCode = localReady ? 0 : 1;
