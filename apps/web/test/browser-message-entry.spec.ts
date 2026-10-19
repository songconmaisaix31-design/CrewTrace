import {test,expect} from '@playwright/test';
test.use({channel:'chrome',launchOptions:{args:['--enable-unsafe-swiftshader']}});

for(const width of [1440,390])test(`交流和公告入口可达 ${width}`,async({page})=>{
  await page.setViewportSize({width,height:844});
  await page.goto('/');
  await page.getByRole('link',{name:'向下探索',exact:true}).click();
  for(const [tab,card,publish,browse,title] of [
    ['02 交流','.stage-discussion','发布消息','查看全部交流','全部交流'],
    ['03 公告','.stage-announcements','发布公告','查看全部公告','全部公告'],
  ]){
    await page.getByRole('button',{name:tab,exact:true}).click();
    const panel=page.locator(card);
    const entry=panel.getByRole('button',{name:publish,exact:true});
    await expect(entry).toBeInViewport();
    await panel.getByRole('button',{name:browse,exact:true}).click();
    const dialog=page.getByRole('dialog',{name:title,exact:true});
    await expect(dialog).toBeVisible();
    const box=(await dialog.boundingBox())!;
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
    await page.mouse.wheel(0,900);
    await expect(panel).toHaveAttribute('aria-hidden','false');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
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
  await page.screenshot({path:`.local/message-entry-${width}.png`});
});
