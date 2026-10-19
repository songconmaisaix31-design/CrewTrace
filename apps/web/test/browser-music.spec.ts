import {test,expect} from '@playwright/test';
test.use({channel:'chrome',launchOptions:{args:['--enable-unsafe-swiftshader']}});

test('真实音乐主动加载、弹窗压低、切页暂停和返回恢复',async({page})=>{
  let requests=0;
  page.on('request',request=>{if(request.url().includes('/audio/futuristic-pulse.mp3'))requests++;});
  await page.goto('/');
  await expect(page.getByRole('button',{name:'音乐与音效设置',exact:true})).toBeVisible();
  expect(requests).toBe(0);
  await page.getByRole('button',{name:'音乐与音效设置',exact:true}).click();
  await expect(page.getByRole('button',{name:'开启音乐',exact:true})).toBeVisible();
  expect(requests).toBe(0);
  await page.locator('[data-music-toggle]').click();
  await expect(page.locator('[data-music-toggle]')).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(()=>requests).toBeGreaterThan(0);
  // 从实际播放中的媒体节点读取状态，不替换音频或浏览器播放实现。
  const session=await page.context().newCDPSession(page);
  await session.send('Runtime.enable');
  const media=async()=>{
    const {result}=await session.send('Runtime.evaluate',{expression:'HTMLAudioElement.prototype',objectGroup:'music'});
    const {objects}=await session.send('Runtime.queryObjects',{prototypeObjectId:result.objectId!});
    const values=await session.send('Runtime.callFunctionOn',{objectId:objects.objectId!,functionDeclaration:'function(){return Array.from(this).filter(a=>a.src.includes("futuristic-pulse")).map(a=>({paused:a.paused,volume:a.volume,time:a.currentTime,duration:a.duration,error:a.error?.code}));}',returnByValue:true});
    await session.send('Runtime.releaseObjectGroup',{objectGroup:'music'});
    return values.result.value as {paused:boolean;volume:number;time:number;duration:number;error?:number}[];
  };
  await expect.poll(async()=>(await media())[0]?.volume).toBeCloseTo(.12,2);
  const initial=(await media())[0];expect(initial.duration).toBeGreaterThan(90);expect(initial.duration).toBeLessThan(110);expect(initial.error).toBeUndefined();
  await expect.poll(async()=>(await media())[0]?.time).toBeGreaterThan(initial.time);
  await page.getByRole('button',{name:'接入 MCP',exact:true}).click();
  await expect.poll(async()=>(await media())[0]?.volume).toBeLessThan(.04);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link',{name:'向下探索',exact:true}).click();
  await expect.poll(async()=>(await media())[0]?.paused).toBe(true);
  await page.locator('.brand').click();
  await expect.poll(async()=>(await media())[0]?.paused).toBe(false);
  await page.getByRole('button',{name:'音乐与音效设置',exact:true}).click();
  await page.locator('[data-music-toggle]').click();
  await expect.poll(async()=>(await media())[0]?.paused).toBe(true);
  await page.reload();
  await page.getByRole('button',{name:'音乐与音效设置',exact:true}).click();
  await expect(page.getByRole('button',{name:'开启音乐',exact:true})).toBeVisible();
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
    await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
  }
});

test('音乐记忆选择但刷新后主动恢复，音效保持独立',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'音乐与音效设置',exact:true}).click();
  await page.locator('[data-music-toggle]').click();
  await page.getByRole('slider',{name:'音乐音量',exact:true}).fill('8');
  await page.reload();
  await page.getByRole('button',{name:'音乐与音效设置',exact:true}).click();
  await expect(page.locator('[data-effects-toggle]')).toHaveAttribute('aria-pressed','false');
  await expect(page.getByRole('button',{name:'恢复音乐',exact:true})).toHaveAttribute('aria-pressed','false');
  await expect(page.getByRole('slider',{name:'音乐音量',exact:true})).toHaveValue('8');
  await page.locator('[data-music-toggle]').click();
  await expect(page.locator('[data-music-toggle]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('[data-effects-toggle]')).toHaveAttribute('aria-pressed','false');
});

test('声音悬停只预览，移入保持，点击固定为设置弹窗',async({page})=>{
  let requests=0;
  page.on('request',request=>{if(request.url().includes('/audio/futuristic-pulse.mp3'))requests++;});
  await page.goto('/');
  const entry=page.getByRole('button',{name:'音乐与音效设置',exact:true});
  await entry.hover();
  const preview=page.getByRole('tooltip');
  await expect(preview).toContainText('首页音乐');
  await preview.hover();
  await page.waitForTimeout(400);
  await expect(preview).toBeVisible();
  expect(requests).toBe(0);
  await entry.click();
  await expect(preview).toHaveCount(0);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('[data-effects-toggle]')).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('[data-music-toggle]')).toHaveAttribute('aria-pressed','false');
  await page.mouse.move(0,400);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link',{name:'向下探索',exact:true}).click();
  await entry.click();
  await expect(page.locator('[data-music-toggle]')).toBeVisible();
});
