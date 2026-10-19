import {test,expect,chromium,type Page} from '@playwright/test';

async function media(page:Page){
  const session=await page.context().newCDPSession(page);
  const {result}=await session.send('Runtime.evaluate',{expression:'HTMLAudioElement.prototype',objectGroup:'autoplay-check'});
  const {objects}=await session.send('Runtime.queryObjects',{prototypeObjectId:result.objectId!});
  const snapshot=await session.send('Runtime.callFunctionOn',{objectId:objects.objectId!,functionDeclaration:'function(){return Array.from(this).filter(a=>a.src.includes("futuristic-pulse")).map(a=>({paused:a.paused,volume:a.volume,muted:a.muted}));}',returnByValue:true});
  await session.send('Runtime.releaseObjectGroup',{objectGroup:'autoplay-check'});await session.detach();
  return snapshot.result.value as {paused:boolean;volume:number;muted:boolean}[];
}

test.describe('浏览器允许自动播放',()=>{
  test('实际开始播放后由轻音量逐渐升到设定音量',async()=>{
    const browser=await chromium.launch({channel:'chrome',args:['--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
    const page=await browser.newPage();
    try{
      await page.goto(process.env.WEB_BASE_URL??'http://127.0.0.1:5173/',{waitUntil:'domcontentloaded'});
      await expect.poll(async()=>(await media(page))[0]?.paused,{intervals:[30]}).toBe(false);
      const first=(await media(page))[0];
      expect(first.volume).toBeGreaterThan(0);
      expect(first.volume).toBeLessThan(.08);
      await page.waitForTimeout(500);
      const middle=(await media(page))[0];
      expect(middle.volume).toBeGreaterThan(first.volume);
      expect(middle.volume).toBeLessThan(.12);
      await expect.poll(async()=>(await media(page))[0]?.volume).toBeCloseTo(.12,3);
    }finally{await browser.close();}
  });
  test('首次入场自动渐入，记住开启与音量，主动关闭后保持关闭',async()=>{
    const browser=await chromium.launch({channel:'chrome',args:['--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
    const page=await browser.newPage();
    try{
    let requests=0;page.on('request',request=>{if(request.url().includes('/audio/futuristic-pulse.mp3'))requests++;});
    await page.goto(process.env.WEB_BASE_URL??'http://127.0.0.1:5173/');
    await expect.poll(async()=>(await media(page))[0]?.volume).toBeCloseTo(.12,3);
    expect((await media(page))[0]).toMatchObject({paused:false,muted:false});
    await expect(page.getByRole('button',{name:'轻点开启氛围声音',exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'音乐与音效设置',exact:true}).click();
    await page.getByRole('slider').fill('8');
    await page.locator('[data-music-toggle]').click();
    await page.locator('[data-music-toggle]').click();
    await page.reload();
    await expect.poll(async()=>(await media(page))[0]?.volume).toBeCloseTo(.024,3);
    await page.getByRole('button',{name:'音乐与音效设置',exact:true}).click();
    await page.locator('[data-music-toggle]').click();
    await page.reload();
    const before=requests;await page.waitForTimeout(500);
    expect(requests).toBe(before);
    await expect(page.locator('.sound-entry-prompt')).toHaveCount(0);
    await page.getByRole('button',{name:'音乐与音效设置',exact:true}).click();
    await expect(page.locator('[data-music-toggle]')).toHaveAttribute('aria-checked','false');
    }finally{await browser.close();}
  });
});

test.describe('浏览器要求主动开启',()=>{
  test('被拦截后明确提示，一次点击直接播放，不弹设置',async()=>{
    const browser=await chromium.launch({channel:'chrome',timeout:20000,args:['--enable-unsafe-swiftshader','--autoplay-policy=document-user-activation-required','--disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies']});
    const page=await browser.newPage({viewport:{width:320,height:740}});
    try{
    await page.goto(process.env.WEB_BASE_URL??'http://127.0.0.1:5173/');
    const prompt=page.getByRole('button',{name:'轻点开启氛围声音',exact:true});
    await expect.poll(async()=>{
      if(await prompt.isVisible())return 'blocked';
      const state=(await media(page))[0];return state&&!state.paused&&state.volume>=.119?'allowed':'pending';
    }).not.toBe('pending');
    const state=(await media(page))[0];
    await test.info().attach('autoplay-media-state',{body:JSON.stringify(state),contentType:'application/json'});
    test.skip(!state.paused,'当前 Chrome 实例仍允许自动播放，未实际触发拦截；不将此分支计为通过。');
    await expect(prompt).toBeVisible();
    expect((await media(page))[0]).toMatchObject({paused:true,volume:0,muted:false});
    const box=(await prompt.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(320);
    await page.screenshot({path:'.local/music-autoplay-blocked.png'});
    await prompt.click();
    await expect(prompt).toHaveCount(0);await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(async()=>(await media(page))[0]?.volume).toBeCloseTo(.12,3);
    expect((await media(page))[0].paused).toBe(false);
    }finally{await browser.close();}
  });
});
