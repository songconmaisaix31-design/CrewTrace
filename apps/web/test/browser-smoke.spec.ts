import { test, expect } from '@playwright/test';

for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  test(`真实公开页面 ${viewport.width}px：协作读取、筛选、抽屉焦点及断线恢复`,async({page,context})=>{
    await page.setViewportSize(viewport);
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    const loaded=page.waitForResponse(response=>new URL(response.url()).searchParams.get('path')==='/api/collaboration/tasks?limit=50&offset=0'&&response.ok());
    await page.goto('/');await loaded;
    await expect(page.getByRole('heading',{level:1})).toBeVisible();
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    await expect(page.getByRole('link',{name:'CSV 验证',exact:true})).toHaveCount(0);
    await expect(page.locator('#mock-bounties')).toHaveCount(0);
    const filtered=page.waitForResponse(response=>new URL(response.url()).searchParams.get('path')?.endsWith('&status=OPEN')===true&&response.ok());
    await page.getByRole('combobox',{name:'任务状态',exact:true}).selectOption('OPEN');await filtered;
    await expect(page.getByRole('combobox',{name:'任务状态',exact:true})).toHaveValue('OPEN');
    const connect=page.getByRole('button',{name:'接入 MCP',exact:true});await connect.click();
    await expect(page.getByRole('dialog',{name:'接入 MCP',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'一键复制给 Agent',exact:true})).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);await expect(connect).toBeFocused();
    const records=await page.locator('section[aria-label="协作任务"] .public-record').allTextContents();
    await context.setOffline(true);
    await expect(page.locator('.notice').filter({hasText:'保留'}).first()).toBeVisible();
    expect(await page.locator('section[aria-label="协作任务"] .public-record').allTextContents()).toEqual(records);
    await context.setOffline(false);
    const recovered=page.waitForResponse(response=>new URL(response.url()).searchParams.get('path')?.endsWith('&status=OPEN')===true&&response.ok());
    await page.getByRole('button',{name:'刷新公开协作',exact:true}).click();await recovered;
    await expect(page.locator('.notice').filter({hasText:'保留'})).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('旧演示链接进入公开协作且旧网关路径关闭',async({page})=>{
  const requested:string[]=[];page.on('request',request=>{const path=new URL(request.url()).searchParams.get('path');if(path)requested.push(path);});
  for(const query of ['?view=csv','?run=closed-entry','?view=csv&run=closed-entry']){
    await page.goto(`/${query}`);
    await expect(page.getByRole('region',{name:'公开协作工作台',exact:true})).toBeVisible();
    expect(new URL(page.url()).searchParams.has('run')).toBe(false);
    expect(new URL(page.url()).searchParams.has('view')).toBe(false);
    await expect(page.getByRole('button',{name:'预览数据',exact:true})).toHaveCount(0);
  }
  expect(requested.every(path=>path.startsWith('/api/collaboration/'))).toBe(true);
  for(const path of ['/api/runs/closed-entry','/api/artifacts/closed-entry','/api/template','/api/criteria']){
    const response=await page.request.get(`/api/web?path=${encodeURIComponent(path)}`);expect(response.status()).toBe(405);
  }
  const create=await page.request.post('/api/web?path=%2Fapi%2Fruns');expect(create.status()).toBe(405);
});
