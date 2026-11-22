import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.js';

const BASE: Record<string, string> = {
  DATABASE_URL: 'postgresql://francis@127.0.0.1:55481/crewtrace_v2_test',
  ADMIN_TOKEN: 'local-admin-token-0123456789abcdef',
  PUBLIC_BASE_URL: 'http://127.0.0.1:3000',
};

const ISOLATED_KEYS = [
  'NODE_ENV', 'PAYMENT_MODE', 'DEPLOYMENT_ENV', 'PUBLIC_DEPLOYMENT', 'PAYMENT_SIMULATED_ACK',
  'PAYMENT_SIMULATION_SECRET', 'ALIPAY_APP_ID', 'ALIPAY_PRIVATE_KEY', 'ALIPAY_PUBLIC_KEY', 'ALIPAY_SERVICE_IDS',
  'PROXY_TRUST_MODE', 'TRUSTED_PROXY_CIDRS', 'DEPLOYMENT_SHA', 'ALLOWED_ORIGINS',
  'PUBLIC_RATE_LIMIT_PER_MINUTE', 'PUBLIC_ORDER_LIMIT_PER_HOUR', 'PUBLIC_COLLAB_RATE_LIMIT_PER_MINUTE',
  'DEMO_MAX_INPUT_CHARS', 'DEMO_MAX_INPUT_ROWS', 'DEMO_MAX_ACTIVE_ORDERS', 'DEMO_GLOBAL_ORDERS_PER_DAY',
  'DEMO_IP_ORDERS_PER_DAY', 'DEMO_AGENT_ORDERS_PER_DAY', 'DEMO_AGENT_REGISTRATIONS_PER_IP_DAY',
  'DEMO_DAILY_TASKS', 'DEMO_CSV_MAX_ATTEMPTS', 'DEMO_WORKER_LEASE_SECONDS',
];

function withEnv(values: Record<string, string | undefined>, run: () => void) {
  const previous = new Map<string, string | undefined>();
  const target: Record<string, string | undefined> = { ...BASE };
  for (const key of ISOLATED_KEYS) target[key] = undefined;
  Object.assign(target, values);
  for (const [key, value] of Object.entries(target)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { run(); } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const ALIPAY = {
  ALIPAY_APP_ID: '2021000000000000',
  ALIPAY_PRIVATE_KEY: 'local-test-private-key',
  ALIPAY_PUBLIC_KEY: 'local-test-public-key',
  ALIPAY_SERVICE_IDS: JSON.stringify({ 'csv-clean-verify': 'CSV_CLEAN_VERIFY' }),
};

test('支付模式默认关闭，部署环境默认本地且非公开', () => {
  withEnv({ PAYMENT_MODE: undefined, DEPLOYMENT_ENV: undefined, PUBLIC_DEPLOYMENT: undefined, NODE_ENV: undefined }, () => {
    const config = loadConfig();
    assert.equal(config.PAYMENT_MODE, 'disabled');
    assert.equal(config.DEPLOYMENT_ENV, 'local');
    assert.equal(config.PUBLIC_DEPLOYMENT, false);
  });
});

test('模拟支付只允许在非公开的本地或测试环境启用', () => {
  const simulated = {
    PAYMENT_MODE: 'simulated',
    PAYMENT_SIMULATED_ACK: 'local-only',
    PAYMENT_SIMULATION_SECRET: 'local-simulation-secret-0123456789abcdef',
  };
  withEnv({ ...simulated, DEPLOYMENT_ENV: undefined, PUBLIC_DEPLOYMENT: undefined, NODE_ENV: undefined }, () => {
    assert.equal(loadConfig().PAYMENT_MODE, 'simulated');
  });
  withEnv({ ...simulated, DEPLOYMENT_ENV: 'test' }, () => {
    assert.equal(loadConfig().DEPLOYMENT_ENV, 'test');
  });
  withEnv({ ...simulated, PAYMENT_SIMULATED_ACK: undefined }, () => {
    assert.throws(() => loadConfig(), /PAYMENT_SIMULATED_ACK/);
  });
  withEnv({ ...simulated, PUBLIC_DEPLOYMENT: 'true' }, () => {
    assert.throws(() => loadConfig(), /公开部署禁止启用 simulated/);
  });
  withEnv({ ...simulated, DEPLOYMENT_ENV: 'production' }, () => {
    assert.throws(() => loadConfig(), /只允许在 local 或 test/);
  });
  withEnv({ ...simulated, DEPLOYMENT_ENV: 'staging' }, () => {
    assert.throws(() => loadConfig(), /只允许在 local 或 test/);
  });
  withEnv({ ...simulated, NODE_ENV: 'production' }, () => {
    assert.throws(() => loadConfig(), /禁止在生产环境启用/);
  });
  withEnv({ ...simulated, PAYMENT_SIMULATION_SECRET: 'short' }, () => {
    assert.throws(() => loadConfig(), /PAYMENT_SIMULATION_SECRET/);
  });
});

test('未启用模拟支付时不得保留模拟确认标记', () => {
  withEnv({ PAYMENT_MODE: 'disabled', PAYMENT_SIMULATED_ACK: 'local-only' }, () => {
    assert.throws(() => loadConfig(), /PAYMENT_SIMULATED_ACK/);
  });
});

test('官方支付宝模式必须提供完整凭证与官方服务映射', () => {
  withEnv({ PAYMENT_MODE: 'sandbox' }, () => {
    assert.throws(() => loadConfig(), /ALIPAY_APP_ID|ALIPAY_PRIVATE_KEY|ALIPAY_PUBLIC_KEY/);
  });
  withEnv({ PAYMENT_MODE: 'sandbox', ...ALIPAY, ALIPAY_SERVICE_IDS: undefined }, () => {
    assert.throws(() => loadConfig(), /ALIPAY_SERVICE_IDS/);
  });
  withEnv({ PAYMENT_MODE: 'sandbox', ...ALIPAY, ALIPAY_SERVICE_IDS: '[]' }, () => {
    assert.throws(() => loadConfig(), /非空 JSON 对象/);
  });
  withEnv({ PAYMENT_MODE: 'sandbox', ...ALIPAY, ALIPAY_SERVICE_IDS: 'not-json' }, () => {
    assert.throws(() => loadConfig(), /合法 JSON/);
  });
  withEnv({ PAYMENT_MODE: 'sandbox', ...ALIPAY, ALIPAY_SERVICE_IDS: JSON.stringify({ 'csv-clean-verify': 'bad id with space' }) }, () => {
    assert.throws(() => loadConfig(), /service_id 不合法/);
  });
  withEnv({ PAYMENT_MODE: 'sandbox', ...ALIPAY, DEPLOYMENT_ENV: 'production' }, () => {
    assert.throws(() => loadConfig(), /不得使用支付宝沙箱/);
  });
  withEnv({ PAYMENT_MODE: 'sandbox', ...ALIPAY, DEPLOYMENT_ENV: 'staging' }, () => {
    const config = loadConfig();
    assert.equal(config.PAYMENT_MODE, 'sandbox');
    assert.deepEqual(JSON.parse(config.ALIPAY_SERVICE_IDS!), { 'csv-clean-verify': 'CSV_CLEAN_VERIFY' });
  });
  withEnv({ PAYMENT_MODE: 'production', ...ALIPAY, DEPLOYMENT_ENV: 'production', PUBLIC_DEPLOYMENT: 'true', PAYMENT_SIMULATED_ACK: undefined, NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://demo.example.com', ALLOWED_ORIGINS: 'https://demo.example.com', PROXY_TRUST_MODE: 'none', DEPLOYMENT_SHA: 'a'.repeat(40) }, () => {
    const config = loadConfig();
    assert.equal(config.PAYMENT_MODE, 'production');
    assert.equal(config.PUBLIC_DEPLOYMENT, true);
  });
  withEnv({ DEPLOYMENT_ENV: 'staging', PUBLIC_DEPLOYMENT: 'true', NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://demo.example.com', ALLOWED_ORIGINS: 'https://demo.example.com', DEPLOYMENT_SHA: 'a'.repeat(40) }, () => {
    assert.throws(() => loadConfig(), /PROXY_TRUST_MODE/);
  });
});
