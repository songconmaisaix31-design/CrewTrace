import {test,expect} from '@playwright/test';
test.use({channel:'chrome',launchOptions:{args:['--enable-unsafe-swiftshader']}});
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('crewtrace:music:v1','off'));});

test('真实 A/B 素材仅开启音效后加载，划过不叠放，点击与暂停静音有效',async({page})=>{
  const session=await page.context().newCDPSession(page);await session.send('WebAudio.enable');
  const nodes:string[]=[],assets:string[]=[];
  session.on('WebAudio.audioNodeCreated',({node})=>nodes.push(node.nodeType));
  page.on('request',request=>{if(request.url().includes('/audio/hero/'))assets.push(request.url());});
  await page.goto('/');expect(assets).toHaveLength(0);
  await page.getByRole('button',{name:'音乐与音效设置',exact:true}).click();
  await page.getByRole('switch',{name:'开启音效',exact:true}).click();
  await expect.poll(()=>nodes.filter(type=>type==='Oscillator').length).toBe(1);
  expect(assets.some(url=>url.endsWith('ring.wav'))).toBe(true);expect(assets.some(url=>url.endsWith('sweep.wav'))).toBe(true);
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
  const scene=(await page.locator('.lens-scene').boundingBox())!,x=scene.x+scene.width/2,y=scene.y+scene.height/2;
  await page.mouse.move(x-60,y);await page.mouse.move(x+60,y,{steps:12});
  await expect.poll(()=>nodes.filter(type=>type==='AudioBufferSource').length).toBe(1);
  await page.mouse.move(x-60,y,{steps:12});expect(nodes.filter(type=>type==='AudioBufferSource')).toHaveLength(1);
  await page.mouse.click(x,y);await expect.poll(()=>nodes.filter(type=>type==='AudioBufferSource').length).toBe(2);
  await page.waitForTimeout(700);
  // 从真实圆环像素选取外缘，避免只测中心空洞而漏掉外圈点击。
  const edge=await page.locator('.signal-scene canvas').evaluate(element=>{
    const canvas=element as HTMLCanvasElement,box=canvas.getBoundingClientRect(),pixels=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;
    for(let row=0;row<canvas.height;row++)for(let column=Math.floor(canvas.width*.2);column<canvas.width*.8;column++){
      const index=(row*canvas.width+column)*4;
      if(pixels[index]>150&&pixels[index+2]>220&&pixels[index+3]>180)return {x:box.x+column/canvas.width*box.width,y:box.y+row/canvas.height*box.height};
    }
    throw new Error('No visible ring edge found');
  });
  await page.mouse.move(edge.x,edge.y);
  await test.info().attach('ring-edge-target',{body:JSON.stringify(await page.evaluate(point=>({point,target:document.elementFromPoint(point.x,point.y)?.outerHTML.slice(0,300)}),edge)),contentType:'application/json'});
  const beforeEdge=nodes.filter(type=>type==='AudioBufferSource').length;
  await page.mouse.down();await page.mouse.up();await expect.poll(()=>nodes.filter(type=>type==='AudioBufferSource').length,{timeout:5000}).toBe(beforeEdge+1);
  await page.getByRole('button',{name:'暂停动态效果',exact:true}).click();
  const paused=nodes.length;await page.mouse.click(x,y);await page.waitForTimeout(300);expect(nodes).toHaveLength(paused);
  await page.getByRole('button',{name:'播放动态效果',exact:true}).click();
  await page.getByRole('button',{name:'音乐与音效设置',exact:true}).click();await page.getByRole('switch',{name:'关闭音效',exact:true}).click();
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
  const muted=nodes.length;await page.mouse.move(x-60,y);await page.mouse.move(x+60,y,{steps:10});await page.mouse.click(x,y);await page.waitForTimeout(300);expect(nodes).toHaveLength(muted);
});

test('实际素材解码与淡出：文字比圆环轻、输出低于试听音量、停止后无尾响',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    // @ts-expect-error 从当前 Vite 加载真实音频模块和 WAV，不替换接口。
    const {loadHeroSounds}=await import('/src/hero-sound.ts');
    const results=[];
    for(const mode of ['text','ring','strike','stop','strike-leave']){
      const context=new OfflineAudioContext(2,132300,44100),master=context.createGain();master.gain.value=.22;master.connect(context.destination);
      const hero=await loadHeroSounds(context,master);
      if(mode.startsWith('strike'))hero.strike();else hero.move(.8,mode==='ring'?1:0);
      if(mode==='stop')hero.stop();
      if(mode==='strike-leave')hero.stop();
      const buffer=await context.startRendering(),samples=buffer.getChannelData(0);
      let energy=0,tail=0,peak=0,early=0;
      for(const sample of samples){energy+=sample*sample;peak=Math.max(peak,Math.abs(sample));}
      for(const sample of samples.slice(-4410))tail=Math.max(tail,Math.abs(sample));
      for(const sample of samples.slice(0,4410))early=Math.max(early,Math.abs(sample));
      results.push({energy,tail,peak,early});
    }
    return results;
  });
  for(const item of result){expect(item.peak).toBeLessThan(.07);expect(item.tail).toBeLessThan(.0001);}
  expect(result[0].energy).toBeGreaterThan(0);expect(result[2].energy).toBeGreaterThan(0);
  expect(result[1].energy).toBeGreaterThan(result[0].energy*2);expect(result[3].energy).toBe(0);
  expect(result[2].early).toBeGreaterThan(.0005);
  expect(result[4].energy).toBeCloseTo(result[2].energy,8);
});
