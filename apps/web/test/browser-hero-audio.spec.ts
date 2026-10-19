import {test,expect} from '@playwright/test';
test.use({channel:'chrome',launchOptions:{args:['--enable-unsafe-swiftshader']}});
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('crewtrace:music:v1','off'));});

test('开启普通音效后，圆环与文字交互仍保持安静且不请求试验素材',async({page})=>{
  const session=await page.context().newCDPSession(page);await session.send('WebAudio.enable');
  const nodes:string[]=[],assets:string[]=[];
  session.on('WebAudio.audioNodeCreated',({node})=>nodes.push(node.nodeType));
  page.on('request',request=>{if(request.url().includes('/audio/hero/'))assets.push(request.url());});
  await page.goto('/');
  await page.getByRole('button',{name:'音乐与音效设置',exact:true}).click();
  await page.getByRole('switch',{name:'开启音效',exact:true}).click();
  await expect.poll(()=>nodes.filter(type=>type==='Oscillator').length).toBe(1);
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
  const scene=(await page.locator('.lens-scene').boundingBox())!,x=scene.x+scene.width/2,y=scene.y+scene.height/2;
  const before=nodes.length;
  await page.mouse.move(x-80,y);await page.mouse.move(x+80,y,{steps:16});await page.mouse.click(x,y);
  await page.mouse.move(scene.x+scene.width*.85,y,{steps:16});await page.mouse.click(scene.x+scene.width*.85,y);
  await page.waitForTimeout(400);
  expect(nodes).toHaveLength(before);expect(assets).toHaveLength(0);
  await expect(page.locator('.signal-scene canvas')).toBeVisible();
});
