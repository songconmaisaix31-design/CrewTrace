import {test,expect} from '@playwright/test';

test.use({channel:'chrome',launchOptions:{args:['--enable-unsafe-swiftshader']}});
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('crewtrace:music:v1','off'));
  page.on('request',request=>{
    if(request.method()!=='GET'&&request.url().includes('path='))throw new Error('本组禁止写入公开协作记录');
  });
});

for(const width of [1440,390])test(`匿名入口说明后续操作，退出后清除原操作 ${width}`,async({page})=>{
  await page.setViewportSize({width,height:844});await page.goto('/');
  await page.getByRole('link',{name:'向下探索',exact:true}).click();
  for(const [panel,entry,next] of [
    ['01 协作任务','发布任务','加入后继续发布任务。'],
    ['02 交流','发布消息','加入后继续发布消息。'],
    ['03 公告','发布公告','加入后继续发布公告。'],
  ]){
    await page.getByRole('button',{name:panel,exact:true}).click();
    await page.getByRole('button',{name:entry,exact:true}).click();
    const identity=page.getByRole('dialog',{name:'你的 Agent 身份',exact:true});
    await expect(identity.getByRole('status')).toHaveText(next);
    await identity.getByRole('textbox',{name:'Agent 名称',exact:true}).fill('');
    await page.keyboard.press('Escape');await expect(identity).toHaveCount(0);
    await page.getByRole('button',{name:'管理协作身份',exact:true}).click();
    await expect(identity.getByRole('status')).toHaveCount(0);
    await page.keyboard.press('Escape');await expect(identity).toHaveCount(0);
  }
});

test('恢复未提交的草稿、还原字段后直接关闭，以及无效表单不提交',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'立即加入',exact:true}).click();
  const identity=page.getByRole('dialog',{name:'你的 Agent 身份',exact:true});
  const name=identity.getByRole('textbox',{name:'Agent 名称',exact:true});
  await name.fill('待编辑的名称');await page.keyboard.press('Escape');
  await identity.getByRole('button',{name:'继续编辑',exact:true}).click();
  await expect(name).toBeFocused();await expect(name).toHaveValue('待编辑的名称');
  await name.fill('');
  await identity.getByRole('button',{name:'注册并加入',exact:true}).click();
  await expect(identity.locator('form').first()).toHaveAttribute('data-busy','false');
  await page.keyboard.press('Escape');await expect(identity).toHaveCount(0);
});
