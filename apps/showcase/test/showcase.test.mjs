import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const css = readFileSync(join(root, 'styles.css'), 'utf8');
const demo = readFileSync(join(root, 'demo.config.js'), 'utf8');

test('展示站包含产品主线与全部必需板块', () => {
  for (const id of ['top', 'workflow', 'agents', 'verification', 'reputation', 'pay', 'architecture', 'demo', 'links']) {
    assert.match(html, new RegExp(`id="${id}"`), `缺少板块 ${id}`);
  }
  for (const text of ['Verifiable AI Agent Services', 'Service Discovery', 'Agent Collaboration', 'Verification', 'Reputation', 'Inspector', 'Cleaner', 'Reporter', 'Machine Pay', 'MCP', 'PostgreSQL']) {
    assert.ok(html.includes(text), `缺少内容 ${text}`);
  }
  assert.match(html, /name="viewport"/);
  assert.match(css, /@media \(max-width: 640px\)/);
});

test('支付状态如实描述，不宣称真实支付完成', () => {
  assert.ok(html.includes('PAYMENT_MODE=disabled'));
  assert.ok(html.includes('未验证'));
  assert.ok(html.includes('不宣称已完成真实支付'));
});

test('演示入口默认关闭，配置为空且不硬编码临时地址', () => {
  assert.ok(demo.includes("status: 'closed'"));
  assert.ok(demo.includes("url: ''"));
  assert.doesNotMatch(demo, /https?:\/\//);
  assert.doesNotMatch(html, /https?:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  const demoJs = readFileSync(join(root, 'demo.js'), 'utf8');
  assert.match(demoJs, /LIVE/);
  assert.match(demoJs, /trycloudflare/);
});

test('不暴露内部地址、密钥或本机路径', () => {
  for (const pattern of [/127\.0\.0\.1/, /localhost/i, /\/Users\//, /ADMIN_TOKEN/, /Bearer\s+[A-Za-z0-9]/, /postgres(ql)?:\/\//, /\.local\//]) {
    assert.doesNotMatch(html + css + demo, pattern);
  }
});

test('静态资源本地化，不加载第三方脚本或分析服务', () => {
  assert.match(html, /<link rel="stylesheet" href="styles\.css">/);
  assert.match(html, /src="assets\/crewtrace-mark\.svg"/);
  assert.ok(existsSync(join(root, 'assets/crewtrace-mark.svg')));
  assert.ok(existsSync(join(root, 'demo.js')));
  assert.match(html, /<script src="demo\.config\.js" defer><\/script>\s*<script src="demo\.js" defer><\/script>/);
  const externalScripts = html.match(/<script[^>]+src="https?:/gi);
  assert.equal(externalScripts, null);
  assert.doesNotMatch(html, /<script>[\s\S]*<\/script>/);
  assert.doesNotMatch(html, /google-analytics|googletagmanager|plausible|analytics/i);
});

test('Pages 安全响应头限制脚本、连接与嵌入', () => {
  const headers = readFileSync(join(root, '_headers'), 'utf8');
  assert.match(headers, /Content-Security-Policy:.*script-src 'self'/);
  assert.match(headers, /connect-src 'none'/);
  assert.match(headers, /frame-ancestors 'none'/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
});

test('私有仓库不提供误导性外链', () => {
  assert.doesNotMatch(html, /https:\/\/github\.com/i);
  assert.doesNotMatch(html, /blob\/feat\//);
  assert.ok(html.includes('私有仓库'));
  assert.ok(html.includes('页面不提供可点击的代码或文档外链'));
  assert.ok(html.includes('尚未发布'));
});

test('明确标记演示数据与支付状态', () => {
  assert.ok(html.includes('不代表真实客户交易'));
  assert.ok(html.includes('支付宝正式支付尚未验证'));
  assert.ok(html.includes('不进行实时探测'));
  assert.match(html, /id="header-demo-state"/);
  const demoJs = readFileSync(join(root, 'demo.js'), 'utf8');
  assert.match(demoJs, /DEMO LIVE/);
  assert.match(demoJs, /DEMO CLOSED/);
});
