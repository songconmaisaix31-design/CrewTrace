import { test,expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('真实服务浏览器：创建身份、下单、运行、下载、验收与刷新',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const manifest=JSON.parse(await readFile(new URL('../../../services/runtime/package.json',import.meta.url),'utf8'));
  const csv='package,version\n'+Object.entries(manifest.dependencies).map(([k,v])=>`${k},${v}`).join('\n');
  await page.goto('/');
  await expect(page.getByText('支付未开通 · 免费服务可用')).toBeVisible();
  await page.getByRole('button',{name:'创建身份',exact:true}).click();
  await page.getByLabel('身份名称').fill('浏览器真实验收');
  await page.getByRole('dialog').getByRole('button',{name:'创建身份',exact:true}).click();
  await expect(page.getByRole('dialog').getByText('你的 CrewTrace 身份')).toBeVisible();
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('button',{name:'查看CSV 数据质量体检'}).click();
  await page.getByLabel('粘贴需要检查的 CSV 原文').fill(csv);
  await page.getByRole('checkbox').check();
  await page.getByRole('button',{name:'确认并创建订单'}).click();
  await page.getByRole('button',{name:'生成数据质量报告'}).click();
  await expect(page.locator('.markdown')).toContainText(`数据行数：${Object.keys(manifest.dependencies).length}`);
  const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'下载',exact:true}).click();const download=await downloadEvent;expect(download.suggestedFilename()).toMatch(/crewtrace-.*-v1.md/);
  await page.getByLabel('验收意见').fill('已核对真实 package.json 依赖清单，报告行数与实际数据一致。');
  await page.getByRole('button',{name:'提交验收'}).click();
  await expect(page.getByRole('dialog').getByText('验收完成',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.reload();await page.getByRole('button',{name:'我的订单',exact:true}).click();
  await expect(page.getByRole('button').filter({hasText:'CSV 数据质量体检'})).toContainText('验收完成');
  await page.getByRole('button',{name:'接入 Agent',exact:true}).click();
  await expect(page.getByRole('heading',{name:'接入 CrewTrace'})).toBeVisible();
  expect(errors).toEqual([]);
});

test('窄屏与键盘：筛选、空状态、表单和内容宽度',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  await page.getByLabel('搜索服务').fill('不存在的能力筛选');
  await expect(page.getByText('暂时没有符合条件的服务')).toBeVisible();
  await page.getByLabel('搜索服务').fill('');
  await page.getByRole('button',{name:'查看CSV 数据质量体检'}).click();
  await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
});
