import {test,expect} from '@playwright/test';

test.use({channel:'chrome',launchOptions:{args:['--enable-unsafe-swiftshader']}});

test('真实公开任务的英文展示、原文切换和翻译状态',async({page},testInfo)=>{
  await page.goto('/');
  const response=await page.request.get('/api/web?path='+encodeURIComponent('/api/collaboration/tasks?limit=50&offset=0'));
  expect(response.ok()).toBeTruthy();
  const {tasks}=await response.json();
  const task=tasks.find((item:{title:string})=>/\p{Script=Han}/u.test(item.title));
  test.skip(!task,'当前真实列表中没有中文任务，无法验证中文译文。');
  const translationResponses:number[]=[];
  page.on('response',response=>{if(response.url().includes('action=translate'))translationResponses.push(response.status());});
  page.on('request',request=>{
    if(request.url().includes('action=translate'))expect(request.headers().authorization).toBeUndefined();
    if(request.method()!=='GET'&&request.url().includes('path='))throw new Error('只读验证不应修改协作记录');
  });
  await page.getByRole('button',{name:'切换为英文',exact:true}).click();
  await expect(page.locator('.language-toggle')).toHaveText('ZH/EN');
  await page.goto('/?task='+task.taskId);
  const dialog=page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const title=dialog.locator('.public-task-detail header h2');
  await expect.poll(()=>translationResponses.length,{timeout:60000}).toBeGreaterThan(0);
  const unavailable=translationResponses.some(status=>status>=400);
  if(unavailable){await expect(title).toHaveText(task.title);await expect(dialog.locator('.translation-control')).toContainText('Original text retained');}
  else await expect(title).not.toHaveText(task.title,{timeout:60000});
  testInfo.annotations.push({type:'translation-service',description:unavailable?'真实翻译未完成；本次验证错误状态与原文访问':'真实阶跃星辰译文已显示'});
  await dialog.getByRole('button',{name:'View original',exact:true}).click();
  await expect(title).toHaveText(task.title);
  await expect(dialog.locator('.public-task-detail')).toContainText(task.description);
  await dialog.getByRole('button',{name:'Show English',exact:true}).click();
  if(unavailable)await expect(title).toHaveText(task.title);else expect(await title.innerText()).not.toMatch(/\p{Script=Han}/u);
  if(unavailable)await expect(dialog.getByRole('button',{name:'Retry translation'})).toBeVisible();
  expect(translationResponses.length).toBeGreaterThan(0);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  await expect(dialog.getByRole('button',{name:'View original',exact:true})).toBeVisible();
});
