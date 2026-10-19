import {test,expect} from '@playwright/test';
test.use({channel:'chrome',launchOptions:{args:['--enable-unsafe-swiftshader']}});
// 本组验证用户已选择关闭之后的手动控制；自动入场另有真实浏览器策略测试。
test.beforeEach(async({page})=>{await page.addInitScript(()=>{if(localStorage.getItem('crewtrace:music:v1')===null)localStorage.setItem('crewtrace:music:v1','off');});});

test('真实音乐主动加载、协作区连续轻声播放、弹窗压低和返回恢复',async({page})=>{
  let requests=0;
  page.on('request',request=>{if(request.url().includes('/audio/futuristic-pulse.mp3'))requests++;});
  await page.goto('/');
  await expect(page.getByRole('button',{name:'音乐与音效设置',exact:true})).toBeVisible();
  expect(requests).toBe(0);
  await page.getByRole('button',{name:'音乐与音效设置',exact:true}).click();
  await expect(page.getByRole('switch',{name:'开启音乐',exact:true})).toBeVisible();
  expect(requests).toBe(0);
  await page.locator('[data-music-toggle]').click();
  await expect(page.locator('[data-music-toggle]')).toHaveAttribute('aria-checked','true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(()=>requests).toBeGreaterThan(0);
  // 从实际播放中的媒体节点读取状态，不替换音频或浏览器播放实现。
  const session=await page.context().newCDPSession(page);
  await session.send('Runtime.enable');
  const media=async()=>{
    const {result}=await session.send('Runtime.evaluate',{expression:'HTMLAudioElement.prototype',objectGroup:'music'});
    const {objects}=await session.send('Runtime.queryObjects',{prototypeObjectId:result.objectId!});
    const values=await session.send('Runtime.callFunctionOn',{objectId:objects.objectId!,functionDeclaration:'function(){return Array.from(this).filter(a=>a.src.includes("futuristic-pulse")).map(a=>({paused:a.paused,volume:a.volume,time:a.currentTime,duration:a.duration,error:a.error?.code,readyState:a.readyState,networkState:a.networkState,buffered:Array.from({length:a.buffered.length},(_,i)=>[a.buffered.start(i),a.buffered.end(i)])}));}',returnByValue:true});
    await session.send('Runtime.releaseObjectGroup',{objectGroup:'music'});
    return values.result.value as {paused:boolean;volume:number;time:number;duration:number;error?:number}[];
  };
  await expect.poll(async()=>(await media())[0]?.volume).toBeCloseTo(.12,2);
  const initial=(await media())[0];expect(initial.duration).toBeGreaterThan(90);expect(initial.duration).toBeLessThan(110);expect(initial.error).toBeUndefined();
  try{await expect.poll(async()=>(await media())[0]?.time).toBeGreaterThan(initial.time);}
  catch(problem){await test.info().attach('real-media-state',{body:JSON.stringify(await media()),contentType:'application/json'});throw problem;}
  await page.getByRole('button',{name:'接入 MCP',exact:true}).click();
  await expect.poll(async()=>(await media())[0]?.volume).toBeLessThan(.04);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(async()=>(await media())[0]?.volume).toBeCloseTo(.12,3);
  await page.getByRole('link',{name:'向下探索',exact:true}).click();
  await expect.poll(async()=>(await media())[0]?.volume).toBeCloseTo(.03,3);
  const workspace=(await media())[0];expect(workspace.paused).toBe(false);
  expect(await media()).toHaveLength(1);
  await expect.poll(async()=>(await media())[0]?.time).toBeGreaterThan(workspace.time);
  await page.getByRole('button',{name:'02 交流',exact:true}).click();
  await expect.poll(async()=>(await media())[0]?.volume).toBeCloseTo(.03,3);
  await page.getByRole('button',{name:'03 公告',exact:true}).click();
  await expect.poll(async()=>(await media())[0]?.volume).toBeCloseTo(.03,3);
  await page.getByRole('button',{name:'接入 MCP',exact:true}).click();
  await expect.poll(async()=>(await media())[0]?.volume).toBeCloseTo(.0084,4);
  expect((await media())[0].paused).toBe(false);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(async()=>(await media())[0]?.volume).toBeCloseTo(.03,3);
  await page.locator('.brand').click();
  await expect.poll(async()=>(await media())[0]?.volume).toBeCloseTo(.12,3);
  expect((await media())[0].time).toBeGreaterThan(workspace.time);
  await page.getByRole('button',{name:'音乐与音效设置',exact:true}).click();
  await page.locator('[data-music-toggle]').click();
  await expect.poll(async()=>(await media())[0]?.paused).toBe(true);
  await page.reload();
  await page.getByRole('button',{name:'音乐与音效设置',exact:true}).click();
  await expect(page.getByRole('switch',{name:'开启音乐',exact:true})).toBeVisible();
});

test('真实媒体音量随页面和弹窗变化，独立于播放时钟检查',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'音乐与音效设置',exact:true}).click();
  await page.locator('[data-music-toggle]').click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const session=await page.context().newCDPSession(page);
  const {result}=await session.send('Runtime.evaluate',{expression:'HTMLAudioElement.prototype',objectGroup:'gain-check'});
  const {objects}=await session.send('Runtime.queryObjects',{prototypeObjectId:result.objectId!});
  const media=async()=>{
    const snapshot=await session.send('Runtime.callFunctionOn',{objectId:objects.objectId!,functionDeclaration:'function(){return Array.from(this).filter(a=>a.src.includes("futuristic-pulse")).map(a=>({paused:a.paused,volume:a.volume}));}',returnByValue:true});
    return snapshot.result.value as {paused:boolean;volume:number}[];
  };
  await expect.poll(async()=>(await media())[0]?.volume).toBeCloseTo(.12,3);
  await page.getByRole('link',{name:'向下探索',exact:true}).click();
  await expect.poll(async()=>(await media())[0]?.volume).toBeCloseTo(.03,3);
  expect((await media())[0].paused).toBe(false);
  await page.getByRole('button',{name:'02 交流',exact:true}).click();
  await expect.poll(async()=>(await media())[0]?.volume).toBeCloseTo(.03,3);
  await page.getByRole('button',{name:'03 公告',exact:true}).click();
  await expect.poll(async()=>(await media())[0]?.volume).toBeCloseTo(.03,3);
  await page.getByRole('button',{name:'接入 MCP',exact:true}).click();
  await expect.poll(async()=>(await media())[0]?.volume).toBeCloseTo(.0084,4);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(async()=>(await media())[0]?.volume).toBeCloseTo(.03,3);
  await page.locator('.brand').click();
  await expect.poll(async()=>(await media())[0]?.volume).toBeCloseTo(.12,3);
  expect(await media()).toHaveLength(1);
  expect((await media())[0].paused).toBe(false);
  await page.getByRole('button',{name:'音乐与音效设置',exact:true}).click();
  await page.locator('[data-music-toggle]').click();
  await expect.poll(async()=>(await media())[0]?.paused).toBe(true);
  await session.send('Runtime.releaseObjectGroup',{objectGroup:'gain-check'});
});

for(const width of [320,390])test(`中英文统一声音入口位于顶部且无重复入口 ${width}`,async({page})=>{
  await page.setViewportSize({width,height:844});await page.goto('/');
  for(const english of [false,true]){
    if(english)await page.getByRole('button',{name:'切换为英文',exact:true}).click();
    const music=page.locator('.public-topbar .sound-toggle');
    await expect(music).toBeVisible();
    const a=(await music.boundingBox())!,b=(await page.locator('.lens-enter').boundingBox())!;
    expect(a.y+a.height).toBeLessThan(b.y);
    expect(a.x+a.width).toBeLessThanOrEqual(width);
    await expect(page.locator('.sound-toggle')).toHaveCount(1);
    await expect(page.locator('.ambient-music-entry')).toHaveCount(0);
    await music.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('slider')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCSS('opacity','1');
    expect((await page.getByRole('dialog').boundingBox())!.height).toBeLessThan(510);
    await page.screenshot({path:`.local/sound-settings-${width}-${english?'en':'zh'}.png`});
    await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
  }
});

test('音乐记忆音量，主动关闭后刷新仍关闭，音效保持独立',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'音乐与音效设置',exact:true}).click();
  await page.locator('[data-music-toggle]').click();
  await page.getByRole('slider',{name:'音乐音量',exact:true}).fill('8');
  await page.locator('[data-music-toggle]').click();
  await page.reload();
  await page.getByRole('button',{name:'音乐与音效设置',exact:true}).click();
  await expect(page.locator('[data-effects-toggle]')).toHaveAttribute('aria-checked','false');
  await expect(page.getByRole('switch',{name:'开启音乐',exact:true})).toHaveAttribute('aria-checked','false');
  await expect(page.getByRole('slider',{name:'音乐音量',exact:true})).toHaveValue('8');
  await page.locator('[data-music-toggle]').click();
  await expect(page.locator('[data-music-toggle]')).toHaveAttribute('aria-checked','true');
  await expect(page.locator('[data-effects-toggle]')).toHaveAttribute('aria-checked','false');
});

test('声音悬停只预览，移入保持，点击固定为设置弹窗',async({page})=>{
  let requests=0;
  page.on('request',request=>{if(request.url().includes('/audio/futuristic-pulse.mp3'))requests++;});
  await page.goto('/');
  const entry=page.getByRole('button',{name:'音乐与音效设置',exact:true});
  await entry.hover();
  const preview=page.getByRole('region',{name:'音乐与音效设置',exact:true});
  await expect(preview).toContainText('氛围音乐');
  await preview.hover();
  await page.waitForTimeout(400);
  await expect(preview).toBeVisible();
  expect(requests).toBe(0);
  await entry.click();
  await expect(preview).toHaveCount(0);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('[data-effects-toggle]')).toHaveAttribute('aria-checked','false');
  await expect(page.locator('[data-music-toggle]')).toHaveAttribute('aria-checked','false');
  await page.mouse.move(0,400);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link',{name:'向下探索',exact:true}).click();
  await entry.click();
  await expect(page.locator('[data-music-toggle]')).toBeVisible();
});

test('悬浮快捷控制与完整设置共享开关和音量，键盘可进入和退出',async({page})=>{
  await page.goto('/');
  const entry=page.getByRole('button',{name:'音乐与音效设置',exact:true});
  await entry.hover();
  const quick=page.getByRole('region',{name:'音乐与音效设置',exact:true});
  await expect(quick).toBeVisible();
  await expect(quick).toHaveCSS('opacity','1');
  const quickBox=(await quick.boundingBox())!,effectsBox=(await quick.locator('[data-quick-effects]').boundingBox())!;
  expect(quickBox.height).toBeLessThan(300);
  expect(effectsBox.y+effectsBox.height).toBeLessThan(quickBox.y+quickBox.height);
  await page.screenshot({path:'.local/sound-quick-controls.png'});
  await quick.locator('[data-quick-music]').click();
  await expect(quick.locator('[data-quick-music]')).toHaveAttribute('aria-checked','true');
  await quick.getByRole('slider').fill('8');
  await quick.locator('[data-quick-effects]').click();
  await expect(quick.locator('[data-quick-effects]')).toHaveAttribute('aria-checked','true');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await quick.getByRole('button',{name:'全部设置',exact:true}).click();
  await expect(quick).toHaveCount(0);
  await expect(page.locator('[data-music-toggle]')).toHaveAttribute('aria-checked','true');
  await expect(page.locator('[data-effects-toggle]')).toHaveAttribute('aria-checked','true');
  await expect(page.getByRole('slider')).toHaveValue('8');
  await expect(page.getByRole('dialog')).toHaveCSS('opacity','1');
  await page.screenshot({path:'.local/sound-full-settings.png'});
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button',{name:'接入 MCP',exact:true}).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(quick).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(quick.getByRole('button',{name:'全部设置',exact:true})).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(quick.locator('[data-quick-music]')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(quick.getByRole('slider')).toBeFocused();
  await quick.getByRole('slider').fill('0');
  await expect(quick).toContainText('已静音');
  await expect(quick.getByRole('slider')).toHaveAttribute('aria-valuetext','0%');
  await page.keyboard.press('ArrowRight');
  await expect(quick.getByRole('slider')).toHaveValue('1');
  await quick.getByRole('slider').fill('100');
  await expect(quick.getByRole('slider')).toHaveAttribute('aria-valuetext','100%');
  await page.keyboard.press('Escape');
  await expect(quick).toHaveCount(0);
  await expect(entry).toBeFocused();
});
