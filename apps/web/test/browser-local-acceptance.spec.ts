import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const baseUrl = process.env.LOCAL_ACCEPTANCE_URL ?? '';

/**
 * 真实本地启动验收：入口网关 + Runtime + 三个独立 Worker 进程 + PostgreSQL。
 * 仅在显式设置 LOCAL_ACCEPTANCE_URL（例如 http://127.0.0.1:8080）时运行，不进入 CI。
 */
test('免费服务在真实本地进程上完成下单、执行、下载、验收与信誉记录', async ({ page }) => {
  test.skip(!baseUrl, '需要设置 LOCAL_ACCEPTANCE_URL 指向 start.sh 启动的入口网关');
  test.setTimeout(240_000);

  await page.goto(`${baseUrl}/#collaborate`);
  await expect(page.getByRole('heading', { name: '购买或体验可验证的 AI Agent 服务' })).toBeVisible();
  await expect(page.getByText('收费服务未开通，免费服务可完整体验', { exact: false })).toBeVisible();

  await page.getByRole('button', { name: '管理协作身份' }).click();
  const identity = page.getByRole('dialog', { name: '你的 Agent 身份' });
  await expect(identity).toBeVisible();
  await identity.getByLabel('Agent 名称').fill(`本地验收 ${Date.now()}`);
  await identity.getByRole('button', { name: '注册并加入' }).click();
  await expect(identity).toBeHidden();

  await page.getByRole('button', { name: '免费体验', exact: true }).click();
  const commerce = page.getByRole('dialog', { name: '服务与订单' });
  await expect(commerce).toBeVisible();
  await expect(commerce.getByText('未开通（仅免费服务可用）', { exact: false })).toBeVisible();

  await commerce.getByLabel('待清洗的 CSV').fill('record_id,amount_cents\nitem-a,10\nitem-b,20\n');
  await commerce.getByRole('button', { name: '提交订单' }).click();

  const detail = commerce.locator('[data-order-id]');
  await expect(detail).toBeVisible();
  const orderId = await detail.getAttribute('data-order-id');
  expect(orderId).toBeTruthy();

  await expect(detail.getByRole('button', { name: '下载清洗结果' })).toBeVisible({ timeout: 120_000 });
  await expect(detail.getByText('已交付', { exact: true })).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    detail.getByRole('button', { name: '下载清洗结果' }).click(),
  ]);
  const file = await download.path();
  expect(file).toBeTruthy();
  const csv = readFileSync(file!, 'utf8');
  expect(csv).toContain('record_id');
  expect(csv).toContain('item-a');

  await detail.getByLabel('备注').fill('本地真实进程验收');
  await detail.getByRole('button', { name: '验收通过' }).click();
  await expect(detail.getByRole('button', { name: '验收通过' })).toHaveCount(0);
  await expect(detail.getByText('验收通过', { exact: true })).toBeVisible();
  await expect(detail.getByText('评分: 5 · 本地真实进程验收')).toBeVisible();
  await expect(detail.getByText('csv-data-review: PASS (DETERMINISTIC_REVIEW)')).toBeVisible();
  await expect(detail.getByText('csv-source-inspection: 未记录信誉事件 (NOT_TRACKED)')).toBeVisible();
  await expect(detail.getByText('csv-evidence-report: 未记录信誉事件 (NOT_TRACKED)')).toBeVisible();

  // 重复下单：同一服务再次提交，历史订单应保留两笔独立订单。
  await commerce.getByRole('button', { name: '刷新' }).click();
  await expect(commerce.getByRole('button', { name: '查看订单' })).toHaveCount(1);
  await commerce.getByRole('button', { name: '提交订单' }).click();
  await expect(commerce.getByRole('button', { name: '查看订单' })).toHaveCount(2, { timeout: 30_000 });

  // 刷新后恢复：重新加载页面仍能读取历史订单与验收记录。
  await page.reload();
  await expect(page.getByRole('heading', { name: '购买或体验可验证的 AI Agent 服务' })).toBeVisible();
  await page.getByRole('button', { name: '免费体验', exact: true }).click();
  const reopened = page.getByRole('dialog', { name: '服务与订单' });
  await expect(reopened.getByText('已验收通过', { exact: true })).toBeVisible();
  await reopened.getByRole('button', { name: '查看订单' }).last().click();
  await expect(reopened.getByText('验收通过', { exact: true })).toBeVisible();
  await expect(reopened.getByText('本地真实进程验收', { exact: false })).toBeVisible();
});
