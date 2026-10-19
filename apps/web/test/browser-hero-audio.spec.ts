import {test,expect} from '@playwright/test';
test.use({channel:'chrome',launchOptions:{args:['--enable-unsafe-swiftshader']}});
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('crewtrace:music:v1','off'));});

test('圆环共鸣、移动泛音、暂停与静音使用同一个真实音效开关',async({page})=>{
  const session=await page.context().newCDPSession(page);await session.send('WebAudio.enable');
  const nodes:string[]=[];session.on('WebAudio.audioNodeCreated',({node})=>nodes.push(node.nodeType));
  await page.goto('/');
  await page.getByRole('button',{name:'音乐与音效设置',exact:true}).click();
  await page.getByRole('switch',{name:'开启音效',exact:true}).click();await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const scene=await page.locator('.lens-scene').boundingBox();expect(scene).not.toBeNull();
  const x=scene!.x+scene!.width/2,y=scene!.y+scene!.height/2;
  await page.mouse.move(x-60,y);await page.mouse.move(x+60,y,{steps:12});
  await expect.poll(()=>nodes.filter(type=>type==='AudioBufferSource').length).toBe(1);
  const before=nodes.filter(type=>type==='Oscillator').length;
  await page.mouse.click(x,y);
  await expect.poll(()=>nodes.filter(type=>type==='Oscillator').length).toBe(before+2);
  await page.getByRole('button',{name:'暂停动态效果',exact:true}).click();
  const paused=nodes.filter(type=>type==='Oscillator').length;
  await page.mouse.click(x,y);await page.waitForTimeout(300);
  expect(nodes.filter(type=>type==='Oscillator').length).toBe(paused);
  await page.getByRole('button',{name:'播放动态效果',exact:true}).click();
  await page.getByRole('button',{name:'音乐与音效设置',exact:true}).click();
  await page.getByRole('switch',{name:'关闭音效',exact:true}).click();await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const muted=nodes.length;await page.mouse.move(x-60,y);await page.mouse.move(x+60,y,{steps:10});await page.mouse.click(x,y);await page.waitForTimeout(300);
  expect(nodes.length).toBe(muted);
});

test('移动泛音在指针停下后衰减，文字区域比圆环区域轻',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    // @ts-expect-error 从当前 Vite 加载实际音频实现。
    const {createHeroAir}=await import('/src/sound-cues.ts');
    const results=[];
    for(const region of [0,1]){
      const context=new OfflineAudioContext(1,44100,44100),master=context.createGain();master.gain.value=.22;master.connect(context.destination);
      const air=createHeroAir(context,master);air.move(.8,region);
      const buffer=await context.startRendering(),samples=buffer.getChannelData(0);
      let energy=0,tail=0,peak=0;
      for(const sample of samples){energy+=sample*sample;peak=Math.max(peak,Math.abs(sample));}
      for(const sample of samples.slice(-4410))tail=Math.max(tail,Math.abs(sample));
      results.push({energy,tail,peak});
    }
    return results;
  });
  for(const item of result){expect(item.energy).toBeGreaterThan(0);expect(item.peak).toBeLessThan(.08);expect(item.tail).toBeLessThan(.0001);}
  expect(result[1].energy).toBeGreaterThan(result[0].energy*2);
});
