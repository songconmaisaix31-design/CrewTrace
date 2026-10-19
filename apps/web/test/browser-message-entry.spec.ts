import {test,expect} from '@playwright/test';
test.use({channel:'chrome',launchOptions:{args:['--enable-unsafe-swiftshader']}});

for(const width of [1440,390])test(`交流和公告入口可达 ${width}`,async({page})=>{
  await page.setViewportSize({width,height:844});
  await page.goto('/');
  await page.getByRole('link',{name:'向下探索',exact:true}).click();
  await page.getByRole('button',{name:'浏览全部任务',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'全部任务',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  for(const [tab,card,publish,browse,title] of [
    ['02 交流','.stage-discussion','发布消息','查看全部交流','全部交流'],
    ['03 公告','.stage-announcements','发布公告','查看全部公告','全部公告'],
  ]){
    await page.getByRole('button',{name:tab,exact:true}).click();
    const panel=page.locator(card);
    await expect(page.getByRole('button',{name:'发布任务',exact:true})).not.toBeVisible();
    const entry=panel.getByRole('button',{name:publish,exact:true});
    await expect(entry).toBeInViewport();
    await expect(panel.locator('.public-panel > .public-muted')).toContainText('最近同步');
    if(await panel.locator('.public-message').count()){
    if(tab==='02 交流')await expect(panel.locator('.message-preview-list header strong')).toHaveText(['niko','Hana']);
    await panel.getByRole('button',{name:browse,exact:true}).click();
    const dialog=page.getByRole('dialog',{name:title,exact:true});
    await expect(dialog).toBeVisible();
    const records=await dialog.locator('.public-message').evaluateAll(nodes=>nodes.map(node=>({id:node.getAttribute('data-message-id'),time:node.querySelector('time')?.getAttribute('datetime')})));
    expect(records.map(item=>item.time)).toEqual(records.map(item=>item.time).sort());
    await expect(panel.locator('.message-preview-list .public-message').first()).toHaveAttribute('data-message-id',(tab==='02 交流'?records[0]:records.at(-1))!.id!);
    const box=(await dialog.boundingBox())!;
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
    await page.mouse.wheel(0,900);
    await expect(panel).toHaveAttribute('aria-hidden','false');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    }else{await expect(panel.getByRole('button',{name:browse,exact:true})).toHaveCount(0);}
    await entry.click();
    const compose=page.getByRole('dialog',{name:publish,exact:true});
    await expect(compose).toBeVisible();
    await expect(compose.getByRole('button',{name:'立即加入，参与协作',exact:true})).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(compose).toHaveCount(0);
    await expect(panel).toHaveAttribute('aria-hidden','false');
  }
  await page.getByRole('button',{name:'02 交流',exact:true}).click();
  await page.waitForTimeout(350);
  const preview=page.locator('.stage-discussion .stage-card-scroll');
  expect(await preview.evaluate(el=>el.scrollHeight<=el.clientHeight+1)).toBe(true);
  await page.screenshot({path:`.local/message-entry-${width}.png`});
});
