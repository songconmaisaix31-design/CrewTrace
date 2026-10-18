import {test,expect} from '@playwright/test';
test.use({channel:'chrome',launchOptions:{args:['--enable-unsafe-swiftshader']}});
test('圆环暂停、恢复和页面往返保持画布与相位',async({page})=>{
  await page.goto('/');
  const ring=page.locator('.lens-scene .signal-scene canvas');
  await expect.poll(async()=>Number(await ring.getAttribute('data-phase'))).toBeGreaterThan(.2);
  await page.getByRole('button',{name:'暂停动态效果',exact:true}).click();
  await page.waitForTimeout(150);
  const phase=Number(await ring.getAttribute('data-phase'));
  const canvas=await ring.elementHandle();
  await page.waitForTimeout(250);
  expect(Number(await ring.getAttribute('data-phase'))).toBe(phase);
  await page.getByRole('link',{name:'向下探索',exact:true}).click();
  await page.waitForTimeout(500);
  await expect(page.locator('.journey-trace path')).toHaveAttribute('d',/^M/);
  await page.getByRole('button',{name:'上一屏：首页',exact:true}).click();
  await page.waitForTimeout(500);
  expect(Number(await ring.getAttribute('data-phase'))).toBe(phase);
  expect(await ring.evaluate((el,original)=>el===original,canvas)).toBe(true);
  await page.getByRole('button',{name:'播放动态效果',exact:true}).click();
  await expect.poll(async()=>Number(await ring.getAttribute('data-phase'))).toBeGreaterThan(phase);
});
test('桌面、竖屏、横屏面板稳定且导航可见，真实预览避让',async({page})=>{
  for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:844,height:390}]){
    await page.setViewportSize(viewport);await page.goto('/');
    await page.getByRole('link',{name:'向下探索',exact:true}).click();
    await page.waitForTimeout(500);
    const first=(await page.locator('.stage-tasks').boundingBox())!;
    await page.getByRole('button',{name:'02 交流与公告',exact:true}).click();
    await page.waitForTimeout(350);
    const second=(await page.locator('.stage-discussion').boundingBox())!;
    expect(Math.abs(first.y-second.y)).toBeLessThan(1);expect(Math.abs(first.height-second.height)).toBeLessThan(1);
    expect((await page.locator('.stage-directions').boundingBox())!.y+48).toBeLessThanOrEqual(viewport.height+8);
    await page.getByRole('button',{name:'01 协作任务',exact:true}).click();
    await page.locator('.public-record h3 button').first().hover();
    await expect(page.getByRole('tooltip')).toContainText('读取于');
    const preview=(await page.getByRole('tooltip').boundingBox())!;
    expect(preview.y).toBeGreaterThanOrEqual(15);expect(preview.y+preview.height).toBeLessThanOrEqual(viewport.height-15);
    await page.screenshot({path:`.local/polish-${viewport.width}.png`});
  }
});
test('触屏点击直接打开，快速经过不弹预览',async({page,browser})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'接入 MCP',exact:true}).hover();
  await page.mouse.move(4,350);await page.waitForTimeout(350);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const phone=await context.newPage();await phone.goto('http://127.0.0.1:5173/');
  await phone.getByRole('button',{name:'接入 MCP',exact:true}).tap();
  await expect(phone.getByRole('dialog')).toBeVisible();await expect(phone.getByRole('tooltip')).toHaveCount(0);
  await context.close();
});
