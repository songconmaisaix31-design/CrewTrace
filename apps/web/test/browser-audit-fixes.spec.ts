import {test,expect} from '@playwright/test';

test.use({channel:'chrome',launchOptions:{args:['--enable-unsafe-swiftshader']}});
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('crewtrace:music:v1','off'));
  page.on('request',request=>{
    if(request.method()!=='GET'&&request.url().includes('path='))throw new Error('本组只读审查禁止写入协作数据');
  });
});

test('横屏真实任务标题与入口完整可见，详情顶部可加入认领',async({page})=>{
  await page.setViewportSize({width:844,height:390});await page.goto('/');
  await page.getByRole('link',{name:'向下探索',exact:true}).click();
  const panel=page.locator('.stage-tasks');
  const entry=panel.locator('.public-record h3 button').first();
  await expect(entry).toBeVisible();await page.waitForTimeout(400);
  const bounds=await entry.evaluate(button=>{
    const box=button.getBoundingClientRect(),window=button.closest('.stage-card-scroll')!.getBoundingClientRect();
    return {top:box.top,bottom:box.bottom,start:window.top,end:window.bottom};
  });
  expect(bounds.top).toBeGreaterThanOrEqual(bounds.start);expect(bounds.bottom).toBeLessThanOrEqual(bounds.end);
  await expect(panel.getByRole('button',{name:'发布任务',exact:true})).toBeInViewport();
  await page.screenshot({path:'.local/audit-landscape-task.png'});
  await entry.click();
  const detail=page.getByRole('dialog',{name:'协作详情',exact:true});
  await expect(detail.locator('.task-participation')).toBeVisible();
  await expect(detail.getByRole('link',{name:/arxiv.org/})).toBeVisible();
  const claim=detail.getByRole('button',{name:'加入并认领',exact:true});
  await expect(claim).toBeVisible();
  const beforeTrace=await claim.evaluate(button=>Boolean(button.compareDocumentPosition(document.querySelector('.collaboration-trace')!)&Node.DOCUMENT_POSITION_FOLLOWING));
  expect(beforeTrace).toBe(true);
  await claim.click();await expect(page.getByRole('dialog',{name:'你的 Agent 身份',exact:true})).toBeVisible();
});

test('320 英文导航均在屏内，消息公告直接加入，草稿关闭保护',async({page})=>{
  await page.setViewportSize({width:320,height:740});await page.goto('/');
  await page.getByRole('button',{name:'切换为英文',exact:true}).click();
  const boxes=await page.locator('.header-actions button').evaluateAll(nodes=>nodes.map(node=>{const rect=node.getBoundingClientRect();return {left:rect.left,right:rect.right};}));
  boxes.forEach(box=>{expect(box.left).toBeGreaterThanOrEqual(0);expect(box.right).toBeLessThanOrEqual(320);});
  await page.screenshot({path:'.local/audit-320-english.png'});
  await page.getByRole('link',{name:'Explore below',exact:true}).click();
  for(const [tab,entry] of [['02 Discussion','Post message'],['03 Announcements','Post announcement']]){
    await page.getByRole('button',{name:tab,exact:true}).click();
    await page.getByRole('button',{name:entry,exact:true}).click();
    const identity=page.getByRole('dialog',{name:'Your Agent identity',exact:true});
    const name=identity.getByRole('textbox',{name:'Agent name',exact:true});
    await expect(name).toBeVisible();await name.fill('Unsent draft');
    await page.keyboard.press('Escape');await expect(identity.getByRole('alert')).toContainText('unsent');
    if(tab==='02 Discussion'){await page.waitForTimeout(250);await page.screenshot({path:'.local/audit-draft-protection.png'});}
    await identity.getByRole('button',{name:'Keep editing',exact:true}).click();await expect(name).toHaveValue('Unsent draft');
    await page.keyboard.press('Escape');await identity.getByRole('button',{name:'Discard and close',exact:true}).click();
    await expect(identity).toHaveCount(0);
  }
});

test('真实断网保留任务与翻译原文，联网可重试，刷新失败不清空列表',async({page,context})=>{
  await page.goto('/');await page.getByRole('link',{name:'向下探索',exact:true}).click();
  const title=page.locator('.stage-tasks .public-record h3').first();await expect(title).toBeVisible();
  const original=await title.innerText();
  await context.setOffline(true);
  await page.getByRole('button',{name:'返回首页',exact:true}).click();
  await page.getByRole('button',{name:'切换为英文',exact:true}).click();
  await page.getByRole('link',{name:'Explore below',exact:true}).click();
  await expect(page.locator('.stage-tasks .translation-control')).toContainText('Original text retained');
  await expect(title).toHaveText(original);
  await page.getByRole('button',{name:'Refresh collaboration',exact:true}).click();
  await expect(page.locator('.public-section-head [role=status]')).toContainText('Update failed');
  await expect(title).toHaveText(original);
  await context.setOffline(false);
  const retry=page.waitForRequest(request=>request.url().includes('action=translate'));
  await page.locator('.stage-tasks').getByRole('button',{name:'Retry translation',exact:true}).click();await retry;
});
