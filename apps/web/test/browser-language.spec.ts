import { test, expect } from '@playwright/test';

test.use({channel:'chrome',launchOptions:{args:['--enable-unsafe-swiftshader']}});

async function expectCentered(page:import('@playwright/test').Page){
  const dialog=page.getByRole('dialog').last();
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(350);
  const box=(await dialog.boundingBox())!,viewport=page.viewportSize()!;
  expect(Math.abs(box.x+box.width/2-viewport.width/2)).toBeLessThan(3);
  expect(Math.abs(box.y+box.height/2-viewport.height/2)).toBeLessThan(3);
  expect(box.height).toBeLessThanOrEqual(viewport.height-32);
}

test('语言切换保留表单、真实任务和刷新偏好',async({page})=>{
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'&&/shader|WebGL/i.test(message.text()))errors.push(message.text());});
  await page.goto('/');
  await expect(page.locator('#public-title')).toContainText('以履历驱动的');
  await expect(page.locator('.lens-scene canvas')).toHaveCount(2);
  await expect(page.locator('.public-topbar .public-identity')).toHaveCount(0);
  await expect(page.locator('.orbit-join')).toHaveText('起名加入');
  const phase=()=>page.locator('.lens-hero').evaluate(el=>el.style.getPropertyValue('--flow-position'));
  const initialPhase=await phase();
  await expect.poll(phase).not.toBe(initialPhase);
  await page.getByRole('button',{name:'暂停首页动画'}).click();
  await page.waitForTimeout(200);
  const pausedPhase=await phase();
  await page.waitForTimeout(200);
  expect(await phase()).toBe(pausedPhase);
  await page.getByRole('button',{name:'播放首页动画'}).click();
  await page.getByRole('button',{name:'切换为英文',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  await expect(page.locator('#public-title')).toContainText('A track-record-driven');
  await expect(page.getByRole('link',{name:'Workspace',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Join',exact:true}).click();
  await expectCentered(page);
  await page.getByLabel('Agent name',{exact:true}).fill('Draft kept locally');
  await page.getByRole('dialog').getByRole('button',{name:'Switch to Chinese'}).click();
  await expect(page.getByLabel('Agent 名称',{exact:true})).toHaveValue('Draft kept locally');
  await page.getByRole('dialog').getByRole('button',{name:'切换为英文'}).click();
  await expect(page.getByLabel('Agent name',{exact:true})).toHaveValue('Draft kept locally');
  await page.getByRole('button',{name:'Close dialog'}).click();
  await page.getByRole('button',{name:'Connect MCP',exact:true}).click();
  await expect(page.locator('.public-topbar').getByRole('button',{name:'Connect MCP',exact:true})).toHaveCount(1);
  await page.waitForTimeout(350);
  const modalBox=await page.getByRole('dialog').boundingBox();
  const viewport=page.viewportSize()!;
  expect(Math.abs(modalBox!.x+modalBox!.width/2-viewport.width/2)).toBeLessThan(3);
  expect(Math.abs(modalBox!.y+modalBox!.height/2-viewport.height/2)).toBeLessThan(3);
  await expect(page.getByRole('dialog')).toContainText('Connect to https://mcp.davidwang.space/mcp');
  await page.getByText('Advanced setup',{exact:true}).click();
  await expect(page.getByRole('link',{name:'Download instructions'})).toHaveAttribute('href','/agent-prompt.en.md');
  await expect(page.getByRole('link',{name:'Download Skill'})).toHaveAttribute('href','/skills/crewtrace/SKILL.en.md');
  await page.getByRole('button',{name:'Close dialog'}).click();
  // 只读线上真实任务，不创建身份或写入生产数据。
  await page.getByRole('link',{name:'Explore below',exact:true}).click();
  const firstTask=page.locator('.public-record h3 button').first();
  await expect(firstTask).toBeVisible();
  const title=await firstTask.innerText();
  await firstTask.click();
  await expect(page.locator('.public-task-detail h2')).toHaveText(title);
  await expectCentered(page);
  const selected=new URL(page.url()).searchParams.get('task');
  await page.getByRole('dialog').getByRole('button',{name:'Switch to Chinese'}).click();
  await expect(page.locator('.public-task-detail h2')).toHaveText(title);
  await expect(page.getByRole('heading',{name:'承担与分工'})).toBeVisible();
  await page.getByRole('dialog').getByRole('button',{name:'切换为英文'}).click();
  await expect(page.getByRole('heading',{name:'Claims and assignments'})).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  expect(new URL(page.url()).searchParams.get('task')).toBe(selected);
  await expect(page.locator('.public-task-detail h2')).toHaveText(title);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has('task')).toBe(false);
  await expect(page.locator('.stage-tasks')).toHaveAttribute('aria-hidden','false');
  expect(errors).toEqual([]);
});

test('手机双语布局与减少动态效果',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/');
  await page.getByRole('button',{name:'切换为英文'}).click();
  await expect(page.locator('.lens-pause')).toBeHidden();
  await expect(page.locator('#public-title')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Join',exact:true}).click();
  await expectCentered(page);
  await page.getByRole('dialog').getByRole('button',{name:'Switch to Chinese'}).click();
  await expect(page.getByRole('dialog')).toContainText('你的 Agent 身份');
  expect(await page.getByRole('dialog').evaluate(el=>el.getBoundingClientRect().right<=innerWidth)).toBe(true);
});
