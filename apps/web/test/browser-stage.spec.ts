import {test,expect} from '@playwright/test';
test.use({channel:'chrome',launchOptions:{args:['--enable-unsafe-swiftshader']}});
test('五像素轻滑及短间隔重复滑动及时响应',async({page})=>{
  await page.goto('/');
  await expect(page.getByRole('link',{name:'向下探索',exact:true})).toBeVisible();
  await page.mouse.move(6,350);
  for(const panel of [0,1,2]){
    await page.mouse.wheel(0,5);
    await expect(page.locator('.experience-shell')).toHaveAttribute('data-screen','1');
    await expect(page.locator('.collaboration-stage')).toHaveAttribute('data-panel',String(panel));
    await page.waitForTimeout(140);
  }
  await page.mouse.wheel(0,-5);
  await expect(page.locator('.collaboration-stage')).toHaveAttribute('data-panel','1');
});
test('轻滑与惯性尾部渐进发力能连续切页',async({page})=>{
  await page.goto('/');
  await expect(page.getByRole('link',{name:'向下探索',exact:true})).toBeVisible();
  await page.mouse.move(6,350);
  await page.mouse.wheel(0,10);
  await expect(page.locator('.experience-shell')).toHaveAttribute('data-screen','1');
  for(const delta of [7,4,2,3,6,10]){
    await page.waitForTimeout(40);
    await page.mouse.wheel(0,delta);
  }
  await expect(page.locator('.collaboration-stage')).toHaveAttribute('data-panel','1');
  await page.waitForTimeout(190);
  await page.mouse.wheel(0,10);
  await expect(page.locator('.collaboration-stage')).toHaveAttribute('data-panel','2');
  await page.mouse.wheel(0,-10);
  await expect(page.locator('.collaboration-stage')).toHaveAttribute('data-panel','1');
});
test('轻滚动、惯性后再次发力与触屏即时响应',async({page})=>{
  await page.goto('/');
  const shell=page.locator('.experience-shell');
  await expect(page.getByRole('link',{name:'向下探索',exact:true})).toBeVisible();
  await page.mouse.move(6,350);
  await page.mouse.wheel(0,18);
  await expect(shell).toHaveAttribute('data-screen','1');
  for(const delta of [12,8,4]){
    await page.waitForTimeout(60);
    await page.mouse.wheel(0,delta);
  }
  await expect(page.locator('.stage-tasks')).toHaveAttribute('aria-hidden','false');
  await page.mouse.wheel(0,30);
  await expect(page.locator('.stage-discussion')).toHaveAttribute('aria-hidden','false');
  await page.mouse.wheel(0,-18);
  await expect(page.locator('.stage-tasks')).toHaveAttribute('aria-hidden','false');
  await page.waitForTimeout(250);
  await page.mouse.wheel(0,-18);
  await expect(shell).toHaveAttribute('data-screen','0');
  const input=await page.context().newCDPSession(page);
  await input.send('Emulation.setTouchEmulationEnabled',{enabled:true});
  await input.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:6,y:350}]});
  await input.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:6,y:300}]});
  await expect(shell).toHaveAttribute('data-screen','1');
  await input.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:6,y:180}]});
  await input.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(page.locator('.stage-tasks')).toHaveAttribute('aria-hidden','false');
});
test('连续手势不跳过01，三面板同位置双向切页',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('link',{name:'向下探索',exact:true})).toBeVisible();
  await expect.poll(()=>page.locator('.signal-scene canvas').getAttribute('data-phase')).not.toBeNull();
  await page.mouse.move(6,350);
  const input=await page.context().newCDPSession(page);
  await input.send('Input.synthesizeScrollGesture',{x:6,y:350,yDistance:-900,speed:1000,gestureSourceType:'mouse'});
  await expect(page.locator('.experience-shell')).toHaveAttribute('data-screen','1');
  await expect(page.locator('.stage-tasks')).toHaveAttribute('aria-hidden','false');
  await page.waitForTimeout(500);
  const first=(await page.locator('.stage-tasks').boundingBox())!;
  await page.mouse.wheel(0,400);
  await expect(page.locator('.stage-discussion')).toHaveAttribute('aria-hidden','false');
  await page.mouse.wheel(0,-400);
  await expect(page.locator('.stage-tasks')).toHaveAttribute('aria-hidden','false');
  await expect(page.locator('.experience-shell')).toHaveAttribute('data-screen','1');
  await page.locator('.stage-directions').getByRole('button',{name:'交流',exact:true}).click();
  await page.waitForTimeout(350);
  const second=(await page.locator('.stage-discussion').boundingBox())!;
  expect(Math.abs(first.y-second.y)).toBeLessThan(1);
  expect(Math.abs(first.height-second.height)).toBeLessThan(1);
  await expect(page.locator('.stage-discussion')).toHaveCSS('transition-property','opacity, transform');
  await page.mouse.move(6,350);
  await page.mouse.wheel(0,100);
  await expect(page.locator('.stage-announcements')).toHaveAttribute('aria-hidden','false');
  await page.waitForTimeout(350);
  const third=(await page.locator('.stage-announcements').boundingBox())!;
  expect(Math.abs(first.y-third.y)).toBeLessThan(1);
  expect(Math.abs(first.height-third.height)).toBeLessThan(1);
  await expect(page.locator('.experience-shell')).toHaveAttribute('data-screen','1');
  await page.mouse.wheel(0,-100);
  await expect(page.locator('.stage-discussion')).toHaveAttribute('aria-hidden','false');
  await page.mouse.move(6,350);
  await page.waitForTimeout(250);
  await input.send('Input.synthesizeScrollGesture',{x:6,y:350,yDistance:650,speed:1000,gestureSourceType:'mouse'});
  await expect(page.locator('.stage-tasks')).toHaveAttribute('aria-hidden','false');
  await expect(page.locator('.experience-shell')).toHaveAttribute('data-screen','1');
  await page.waitForTimeout(250);
  await page.mouse.wheel(0,-100);
  await expect(page.locator('.experience-shell')).toHaveAttribute('data-screen','0');
  await page.waitForTimeout(500);await page.screenshot({path:'.local/lens-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  await page.waitForTimeout(350);await page.screenshot({path:'.local/lens-mobile.png'});
  const caption=(await page.locator('.lens-caption').boundingBox())!;
  const entry=(await page.locator('.lens-enter').boundingBox())!;
  expect(caption.y+caption.height).toBeLessThan(entry.y);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.getByRole('link',{name:'向下探索',exact:true}).click();
  await page.getByRole('button',{name:'02 交流',exact:true}).click();
  await expect(page.locator('.stage-tasks')).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'.local/stage-mobile.png'});
  expect(errors).toEqual([]);
});

test('未展开的交流直接切到公告，展开阅读隔离滚动',async({page})=>{
  await page.setViewportSize({width:1440,height:700});
  await page.goto('/');
  await page.getByRole('link',{name:'向下探索',exact:true}).click();
  await page.getByRole('button',{name:'02 交流',exact:true}).click();
  await expect(page.locator('.stage-discussion .public-message').first()).toBeVisible();
  await page.waitForTimeout(350);
  const reading=page.locator('.stage-discussion .stage-card-scroll');
  expect(await reading.evaluate(el=>el.scrollHeight<=el.clientHeight+1)).toBe(true);
  const box=(await reading.boundingBox())!;
  const input=await page.context().newCDPSession(page);
  await input.send('Input.synthesizeScrollGesture',{x:Math.round(box.x+box.width/2),y:Math.round(box.y+box.height/2),yDistance:-1000,speed:1000,gestureSourceType:'mouse'});
  expect(await reading.evaluate(el=>el.scrollTop)).toBe(0);
  await expect(page.locator('.stage-announcements')).toHaveAttribute('aria-hidden','false');
  await expect(page.locator('.experience-shell')).toHaveAttribute('data-screen','1');
  await page.mouse.move(6,350);
  await page.mouse.wheel(0,-100);
  await expect(page.locator('.stage-discussion')).toHaveAttribute('aria-hidden','false');
  await page.locator('.stage-discussion').getByRole('button',{name:'查看全部交流',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const bounds=(await dialog.boundingBox())!;
  await input.send('Input.synthesizeScrollGesture',{x:Math.round(bounds.x+bounds.width/2),y:Math.round(bounds.y+bounds.height/2),yDistance:-1200,speed:1000,gestureSourceType:'mouse'});
  await expect(page.locator('.stage-discussion')).toHaveAttribute('aria-hidden','false');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.stage-discussion')).toHaveAttribute('aria-hidden','false');
});

test('手机面板中央触摸按首页01 02 03往返',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.getByRole('link',{name:'向下探索',exact:true})).toBeVisible();
  const input=await page.context().newCDPSession(page);
  await input.send('Emulation.setTouchEmulationEnabled',{enabled:true});
  for(const [direction,screen,panel] of [[1,1,0],[1,1,1],[1,1,2],[-1,1,1],[-1,1,0],[-1,0,0]]){
    await input.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:195,y:480}]});
    await input.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:195,y:480-direction*70}]});
    await input.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await expect(page.locator('.experience-shell')).toHaveAttribute('data-screen',String(screen));
    await expect(page.locator('.collaboration-stage')).toHaveAttribute('data-panel',String(panel));
    await page.waitForTimeout(350);
  }
});
