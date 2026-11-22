import { existsSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { Database } from '../src/db.js';
import { parseTrustedProxies } from '../src/proxy-trust.js';

/**
 * 独立部署预检（RC3）。
 *
 * 只读检查本地构建产物、运行配置、代理信任、全局额度、数据库迁移和连通性，
 * 不创建任何云资源，不发起真实支付，也不读取团队环境。默认输出本地预检结果；
 * 未显式设置 RC3_DEPLOY_AUTHORIZED=yes 时，云部署状态固定为 BLOCKED。
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
  ['本地入口网关', 'deploy/local/gateway.ts'],
  ['启动脚本', 'deploy/local/start.sh'],
  ['停止脚本', 'deploy/local/stop.sh'],
] as const) {
  check(name, existsSync(resolve(root, path)), path);
}

function env(name: string) {
  return process.env[name]?.trim();
}

const tunnelAuthorized = env('CREWTRACE_TUNNEL_AUTHORIZED') === 'yes';

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
const proxyMode = env('PROXY_TRUST_MODE') ?? 'none';
const proxyModeExplicit = Boolean(env('PROXY_TRUST_MODE'));
const trustedProxies = env('TRUSTED_PROXY_CIDRS') ?? '';
  check('代理信任模式', proxyMode === 'none' || proxyMode === 'cidr', proxyMode);
if (proxyMode === 'cidr') {
  try {
    check('可信代理 CIDR', parseTrustedProxies(trustedProxies).length > 0, trustedProxies || '未设置');
  } catch (error) {
    check('可信代理 CIDR', false, error instanceof Error ? error.message : String(error));
  }
} else if (proxyMode === 'none') {
  check('可信代理 CIDR', true, 'none 模式忽略转发请求头，直接使用 socket 地址');
}
const deploymentSha = env('DEPLOYMENT_SHA');
const shaValid = Boolean(deploymentSha && /^[0-9a-f]{40}$/i.test(deploymentSha));
check('部署版本 SHA', publicDeployment ? shaValid : (!deploymentSha || shaValid), deploymentSha ?? (publicDeployment ? '未设置' : '本地未设置，公开部署必须提供'));
if (deploymentSha && existsSync(resolve(root, '.git'))) {
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    check('部署 SHA 与本地 HEAD 一致', head === deploymentSha, `HEAD=${head} DEPLOYMENT_SHA=${deploymentSha}`);
  } catch (error) {
    check('部署 SHA 与本地 HEAD 一致', false, error instanceof Error ? error.message : String(error));
  }
}
const quota = {
  maxInputChars: Number(env('DEMO_MAX_INPUT_CHARS') ?? 80_000),
  maxInputRows: Number(env('DEMO_MAX_INPUT_ROWS') ?? 2000),
  maxActiveOrders: Number(env('DEMO_MAX_ACTIVE_ORDERS') ?? 10),
  globalOrders: Number(env('DEMO_GLOBAL_ORDERS_PER_DAY') ?? 100),
  ipOrders: Number(env('DEMO_IP_ORDERS_PER_DAY') ?? 10),
  agentOrders: Number(env('DEMO_AGENT_ORDERS_PER_DAY') ?? 5),
  registrations: Number(env('DEMO_AGENT_REGISTRATIONS_PER_IP_DAY') ?? 5),
  dailyTasks: Number(env('DEMO_DAILY_TASKS') ?? 100),
  csvAttempts: Number(env('DEMO_CSV_MAX_ATTEMPTS') ?? 3),
  leaseSeconds: Number(env('DEMO_WORKER_LEASE_SECONDS') ?? 300),
};
check('全局订单额度', quota.globalOrders > 0 && quota.ipOrders > 0 && quota.agentOrders > 0,
  `全局 ${quota.globalOrders}/日，单地址 ${quota.ipOrders}/日，单 Agent ${quota.agentOrders}/日`);
check('并发与输入上限', quota.maxActiveOrders > 0 && quota.maxInputChars <= 200_000 && quota.maxInputRows <= 5000,
  `并发 ${quota.maxActiveOrders}，输入 ${quota.maxInputChars} 字符 / ${quota.maxInputRows} 行`);
check('Worker 超时与重试上限', quota.csvAttempts >= 1 && quota.csvAttempts <= 5 && quota.leaseSeconds >= 60 && quota.leaseSeconds <= 600,
  `重试 ${quota.csvAttempts} 次，租约 ${quota.leaseSeconds} 秒`);
if (publicDeployment) {
  check('公开部署环境标识', deploymentEnv === 'staging' || deploymentEnv === 'production', deploymentEnv);
  check('公开部署 HTTPS', Boolean(publicBase?.startsWith('https://')), publicBase ?? '未设置');
  check('公开部署请求限额', minuteLimit > 0 && orderLimit > 0, `每分钟 ${minuteLimit} 次，每小时 ${orderLimit} 单`);
  check('公开部署来源白名单', Boolean(env('ALLOWED_ORIGINS')), env('ALLOWED_ORIGINS') ?? 'ALLOWED_ORIGINS 为空');
  check('公开部署 NODE_ENV', process.env.NODE_ENV === 'production', process.env.NODE_ENV ?? '未设置');
  check('公开部署代理信任', proxyModeExplicit && (proxyMode === 'none' || (proxyMode === 'cidr' && trustedProxies.trim().length > 0)), proxyModeExplicit ? proxyMode : '未显式设置');
  check('公开部署版本 SHA', Boolean(deploymentSha), deploymentSha ?? '未设置');
}

for (const [name, path, pattern] of [
  ['Runtime 仅回环监听', 'services/runtime/src/local.ts', /hostname:\s*'127\.0\.0\.1'/],
  ['入口网关仅回环监听', 'deploy/local/gateway.ts', /listen\([^)]*'127\.0\.0\.1'/],
] as const) {
  try {
    check(name, pattern.test(readFileSync(resolve(root, path), 'utf8')), path);
  } catch (error) {
    check(name, false, error instanceof Error ? error.message : String(error));
  }
}
check('链上写入关闭', env('EXPERIMENT_CHAIN_WRITES') !== 'TESTNET' && !env('CHAIN_ADAPTER_MODULE') && !env('COLLABORATION_CHAIN_CONTRACT'),
  `EXPERIMENT_CHAIN_WRITES=${env('EXPERIMENT_CHAIN_WRITES') ?? '未设置'}`);
check('公网入口需显式授权', !publicDeployment || tunnelAuthorized,
  publicDeployment ? `CREWTRACE_TUNNEL_AUTHORIZED=${env('CREWTRACE_TUNNEL_AUTHORIZED') ?? '未设置'}` : '当前未开启公开部署');
const adminTokenFile = resolve(root, '.local/admin-token');
if (existsSync(adminTokenFile)) {
  const mode = statSync(adminTokenFile).mode & 0o777;
  check('管理员令牌文件权限', (mode & 0o077) === 0, mode.toString(8));
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
    const listen = await database.pool.query('SHOW listen_addresses');
    const listenAddresses = String(listen.rows[0].listen_addresses);
    check('PostgreSQL 不监听公网', ['127.0.0.1', 'localhost', '127.0.0.1,::1'].includes(listenAddresses), listenAddresses);
    const applied = await database.pool.query('SELECT version FROM runtime_migrations ORDER BY version');
    const versions = applied.rows.map(row => String(row.version));
    const required = ['001','002','003','004','005','006','007','008','009','010','011','012','013','014','015'];
    const missing = required.filter(version => !versions.includes(version));
    check('数据库迁移 001-015', missing.length === 0, missing.length ? `缺少 ${missing.join(',')}` : `已应用 ${versions.length} 个版本`);
    const quotaTables = await database.pool.query(`
      SELECT to_regclass('demo_usage_counters') AS counters, to_regclass('runtime_settings') AS settings,
             to_regclass('experiment_worker_presence') AS presence`);
    check('全局额度表', Boolean(quotaTables.rows[0].counters && quotaTables.rows[0].settings), JSON.stringify(quotaTables.rows[0]));
    const pause = await database.pool.query("SELECT value FROM runtime_settings WHERE key='demo_pause'");
    check('暂停开关初始值', pause.rows[0]?.value?.paused === false, JSON.stringify(pause.rows[0]?.value ?? null));
    check('Worker 在线状态表', Boolean(quotaTables.rows[0].presence), String(quotaTables.rows[0].presence ?? '缺失'));
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

const authorized = env('RC3_DEPLOY_AUTHORIZED') === 'yes';
const localReady = checks.every(item => item.ok);
const cloud = authorized
  ? { status: 'AUTHORIZED', next: '按 DEPLOYMENT.md 的 RC3 清单执行独立云部署' }
  : { status: 'BLOCKED', reason: '未取得个人云资源授权，未创建或修改任何云项目', action: '获得 VPS、Neon、域名与支付宝沙箱授权并确认费用后设置 RC3_DEPLOY_AUTHORIZED=yes' };
const tunnelUrlFile = resolve(root, '.local/tunnel-url');
const tunnel = tunnelAuthorized
  ? {
      status: publicDeployment ? 'AUTHORIZED_ACTIVE' : 'AUTHORIZED_IDLE',
      url: existsSync(tunnelUrlFile) ? readFileSync(tunnelUrlFile, 'utf8').trim() : null,
      next: publicDeployment ? '演示结束执行 ./deploy/local/stop.sh 立即关闭入口' : '执行 ./deploy/local/start.sh --tunnel 开启入口',
    }
  : { status: 'CLOSED', reason: '未授权开启公网入口，Tunnel 不会启动', action: '设置 CREWTRACE_TUNNEL_AUTHORIZED=yes 后执行 start.sh --tunnel' };

console.log(JSON.stringify({
  status: localReady ? 'LOCAL_READY' : 'LOCAL_BLOCKED',
  checks,
  cloud,
  tunnel,
  notes: [
    '本脚本只读检查，不创建云资源，不发起真实支付。',
    '代理信任、全局额度与暂停开关只做配置和数据库结构检查，不代表公网部署成功。',
    '本地零成本入口使用 Cloudflare Quick Tunnel，临时域名每次启动变化，关闭入口执行 stop.sh。',
    '正式支付宝支付缺少真实商户凭证，状态为 BLOCKED。',
  ],
}, null, 2));
process.exitCode = localReady ? 0 : 1;
