import { test, expect } from '@playwright/test';
import { RunDetailSchema } from '@co-vibe/contracts';

const ids=process.env.LIVE_RUN_IDS?.split(',');
if(!ids||ids.length!==2)throw new Error('LIVE_RUN_IDS 必须包含两轮真实运行');

test('真实两轮页面：公告筛选排序、报告、下载、比较、离线保留及刷新恢复',async({page,context})=>{
  test.setTimeout(480000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:1440,height:900});
  await page.goto(`/?run=${encodeURIComponent(ids[0])}`);
  await expect(page.locator('.run-summary')).toContainText('验收通过');
  await expect(page.locator('.input-evidence')).toContainText('本地验证链（31337）');
  await expect(page.locator('.board-note').first()).toBeVisible();
  await page.getByRole('button',{name:/^进度/}).click();
  await expect(page.getByRole('button',{name:/^进度/})).toHaveAttribute('aria-pressed','true');
  expect(await page.locator('.board-note').evaluateAll(notes=>notes.every(note=>note.getAttribute('data-type')==='PROGRESS'))).toBe(true);
  await page.getByRole('button',{name:/^全部/}).click();
  await page.getByRole('combobox').selectOption('oldest');
  const dates=await page.locator('.board-note time').evaluateAll(nodes=>nodes.map(node=>Date.parse(node.getAttribute('datetime')!)));
  expect(dates).toEqual([...dates].sort((a,b)=>a-b));
  await page.getByRole('button',{name:'查看数据整理的执行者与分工依据'}).click();
  await expect(page.getByRole('dialog')).toContainText('综合');
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('.agent-edge button').first().click();
  await expect(page.getByRole('dialog',{name:'交接详情'})).toContainText('已接收');
  await page.keyboard.press('Escape');
  await page.locator('.artifact-tabs button').first().click();
  await expect(page.locator('.report-markdown h1')).toBeVisible();
  const download=page.waitForEvent('download');
  await page.getByRole('link',{name:'下载 report.md',exact:true}).click();
  expect((await download).suggestedFilename()).toBe('report.md');
  console.log(JSON.stringify({runId:ids[0],phase:'REPORT_DOWNLOAD_AND_HANDOFF_PASSED'}));
  await expect.poll(async()=>{
    const response=await page.request.get(`/api/web?path=${encodeURIComponent(`/api/runs/${ids[1]}`)}`);
    expect(response.status()).toBe(200);
    return RunDetailSchema.parse(await response.json()).status;
  },{timeout:420000,intervals:[2000]}).toBe('VERIFIED_PASS');
  await page.getByRole('button',{name:'比较另一轮'}).click();
  await page.locator('#compare-id').fill(ids[1]);await page.getByRole('button',{name:'开始比较',exact:true}).click();
  await expect(page.locator('.compare-role')).toHaveCount(3);await expect(page.locator('.compare-grid article')).toHaveCount(6);
  await expect(page.locator('.compare-role').first()).toContainText('样本');
  await page.getByRole('button',{name:'← 返回本次分析'}).click();
  await context.setOffline(true);
  await expect(page.locator('.notice').filter({hasText:/中断|无法|超时|不可用/}).first()).toBeVisible();
  await expect(page.locator('.run-summary')).toContainText('验收通过');
  await context.setOffline(false);
  await expect(page.locator('.notice').filter({hasText:/保留上次状态/})).toHaveCount(0);
  await expect(page.locator('.board-error')).toHaveCount(0);
  await page.reload();await expect(page.locator('.run-summary')).toContainText(ids[0]);await expect(page.locator('.run-summary')).toContainText('验收通过');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('实际 Worker 下线后，已完成结果可读且创建入口说明等待条件',async({page})=>{
  await page.goto('/?view=csv');
  await expect(page.getByRole('button',{name:'开始分析',exact:true})).toBeEnabled();
  await expect(page.locator('.launch-form .notice')).toContainText('协作成员暂未就绪，创建后将等待分工');
  await page.getByRole('button',{name:'开始分析',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('协作成员暂未就绪，创建后将等待分工');
  await page.keyboard.press('Escape');
  await page.goto(`/?run=${ids[0]}`);
  await expect(page.locator('.run-summary')).toContainText('验收通过');
});
