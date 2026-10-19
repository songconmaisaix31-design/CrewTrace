import {test,expect} from '@playwright/test';
test.use({channel:'chrome',launchOptions:{args:['--enable-unsafe-swiftshader']}});

test('声音默认关闭、主动开启、切页发声、静音及偏好持久化',async({page})=>{
  const input=await page.context().newCDPSession(page);
  let contexts=0,oscillators=0;
  await input.send('WebAudio.enable');
  input.on('WebAudio.contextCreated',()=>contexts++);
  input.on('WebAudio.audioNodeCreated',({node})=>{if(node.nodeType==='Oscillator')oscillators++;});
  await page.goto('/');
  const entry=page.locator('.sound-toggle[data-sound-toggle]');
  const toggle=page.locator('[data-effects-toggle]');
  await expect(entry).not.toHaveAttribute('data-active','true');
  await page.getByRole('button',{name:'接入 MCP',exact:true}).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(contexts).toBe(0);
  await entry.click();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed','true');
  await expect.poll(()=>oscillators).toBe(1);
  expect(contexts).toBe(1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.getByRole('link',{name:'向下探索',exact:true}).click();
  await expect.poll(()=>oscillators).toBe(3);
  await page.waitForTimeout(150);
  await page.getByRole('button',{name:'02 交流',exact:true}).click();
  await expect.poll(()=>oscillators).toBe(5);
  await page.getByRole('button',{name:'接入 MCP',exact:true}).click();
  await expect.poll(()=>oscillators).toBe(6);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await entry.click();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed','false');
  await page.keyboard.press('Escape');
  const muted=oscillators;
  await page.getByRole('button',{name:'03 公告',exact:true}).click();
  await page.waitForTimeout(250);
  expect(oscillators).toBe(muted);
  await page.reload();
  await entry.click();
  await expect(toggle).toHaveAttribute('aria-pressed','false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed','true');
  await page.reload();
  await entry.click();
  await expect(toggle).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'管理协作身份',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('四种合成音实际渲染有限波形且平滑结束',async({page})=>{
  await page.goto('/');
  const results=await page.evaluate(async()=>{
    // @ts-expect-error 浏览器从 Vite 加载实际模块。
    const {renderSoundCue}=await import('/src/sound-cues.ts');
    const results=[];
    for(const cue of ['click','page','success','error']){
      const context=new OfflineAudioContext(1,22050,44100);
      const master=context.createGain();master.gain.value=.22;master.connect(context.destination);
      renderSoundCue(context,master,cue);
      const buffer=await context.startRendering(),samples=buffer.getChannelData(0);
      let peak=0,energy=0,tail=0;
      for(const value of samples){peak=Math.max(peak,Math.abs(value));energy+=value*value;}
      for(const value of samples.slice(-2205))tail=Math.max(tail,Math.abs(value));
      results.push({cue,peak,energy,tail});
    }
    return results;
  });
  for(const result of results){expect(result.peak).toBeGreaterThan(.005);expect(result.peak).toBeLessThan(.1);expect(Number.isFinite(result.energy)).toBe(true);expect(result.energy).toBeGreaterThan(0);expect(result.tail).toBe(0);}
});

for(const width of [320,390])test(`手机音效开关及其他顶部入口不重叠 ${width}`,async({page})=>{
  await page.setViewportSize({width,height:844});
  await page.goto('/');
  for(const workspace of [false,true]){
    if(workspace)await page.getByRole('link',{name:'向下探索',exact:true}).click();
    await expect(page.locator('.sound-toggle[data-sound-toggle]')).toBeVisible();
    await page.waitForTimeout(400);
    const controls=page.locator('.public-topbar .header-actions > button');
    const brand=(await page.locator('.public-topbar .brand').boundingBox())!;
    let right=brand.x+brand.width;
    for(const control of await controls.all()){
      const box=(await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(right-1);expect(box.x+box.width).toBeLessThanOrEqual(width);
      right=box.x+box.width;
    }
    await page.screenshot({path:`.local/sound-${width}-${workspace?'workspace':'home'}.png`});
  }
});
