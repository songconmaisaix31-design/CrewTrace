import {test,expect} from '@playwright/test';
test.use({channel:'chrome',launchOptions:{args:['--enable-unsafe-swiftshader']}});

test('信誉凭证弹窗展示真实可验证信誉、空状态与链上未绑定',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/');
  await page.getByRole('link',{name:'向下探索',exact:true}).click();
  const tasks=page.locator('.stage-tasks');
  await tasks.getByRole('button',{name:'浏览全部任务',exact:true}).click();
  const all=page.getByRole('dialog',{name:'全部任务',exact:true});
  await all.locator('.public-record h3 button').first().click();
  const detail=page.getByRole('dialog',{name:'协作详情',exact:true});
  await expect(detail.getByRole('heading',{name:'V2 匹配与交付证据'})).toBeVisible();
  const roster=detail.locator('li');
  await expect(roster.filter({hasText:'Passport reviewer'}).getByRole('button',{name:'信誉凭证'})).toBeVisible();

  await roster.filter({hasText:'Passport reviewer'}).getByRole('button',{name:'信誉凭证'}).click();
  const passport=page.getByRole('dialog',{name:'信誉凭证',exact:true});
  await expect(passport).toBeVisible();
  await expect(passport).toContainText('Passport reviewer');
  await expect(passport).toContainText('样本 1');
  await expect(passport).toContainText('本地核验通过');
  await expect(passport).toContainText('履约复算通过（离线，未上链）');
  await expect(passport).toContainText('链上承诺：未绑定');
  await expect(passport).toContainText('未绑定');
  await passport.getByRole('button',{name:'查看凭证摘要'}).click();
  await expect(passport.locator('pre')).toContainText('TRUSTED');
  await passport.screenshot({path:'../../docs/v3/evidence/passport.png'});
  await page.keyboard.press('Escape');
  await expect(passport).toHaveCount(0);

  // 无核验数据的 Agent 展示空状态，不生成示意信誉分。
  await roster.filter({hasText:'Passport inspector'}).getByRole('button',{name:'信誉凭证'}).click();
  const empty=page.getByRole('dialog',{name:'信誉凭证',exact:true});
  await expect(empty).toContainText('该角色暂无已核验的履约记录');
  await page.keyboard.press('Escape');
  await expect(empty).toHaveCount(0);
  await expect(detail).toBeVisible();
});
