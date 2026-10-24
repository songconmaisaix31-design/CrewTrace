import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

// 仅浏览匿名页面与打开表单，不提交业务数据，不读取已有浏览器身份。
const out=fileURLToPath(new URL('./',import.meta.url));
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:900}});
const page=await context.newPage();
const result={requests:[],errors:[],states:[],keyboard:[]};
page.on('request',r=>result.requests.push({method:r.method(),url:r.url()}));
page.on('pageerror',e=>result.errors.push(e.message));
async function capture(name){
  await page.waitForTimeout(400);
  await page.screenshot({path:out+name+'.png'});
  result.states.push({name,url:page.url(),...await page.evaluate(()=>({
    width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,
    screen:document.querySelector('.experience-shell')?.dataset.screen,
    panel:document.querySelector('.collaboration-stage')?.dataset.panel,
    text:document.body.innerText,
    controls:[...document.querySelectorAll('button,a,input,select,textarea')].filter(el=>!el.closest('[inert]')&&el.getBoundingClientRect().width>0).map(el=>{
      const box=el.getBoundingClientRect(),style=getComputedStyle(el);
      return {tag:el.tagName,text:el.getAttribute('aria-label')||el.textContent?.trim(),type:el.getAttribute('type'),font:style.fontSize,color:style.color,background:style.backgroundColor,x:box.x,y:box.y,w:box.width,h:box.height};
    }),
    regions:[...document.querySelectorAll('.lens-caption,.stage-card-scroll,dialog,.stage-directions')].map(el=>({class:el.className,height:el.clientHeight,scrollHeight:el.scrollHeight,overflow:getComputedStyle(el).overflowY}))
  }))});
}
await page.goto('http://127.0.0.1:5173/');
await page.getByRole('link',{name:'向下探索',exact:true}).waitFor();
await page.waitForTimeout(2000);
await capture('home-desktop');
await page.getByRole('button',{name:'起名加入',exact:true}).hover();
await capture('join-preview');
await page.getByRole('button',{name:'起名加入',exact:true}).click();
await capture('join-dialog');
await page.getByText('恢复已有身份',{exact:true}).click();
await capture('restore-dialog');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await page.getByRole('button',{name:'接入 MCP',exact:true}).click();
await capture('mcp-dialog');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await page.getByRole('link',{name:'向下探索',exact:true}).click();
await capture('tasks-desktop');
await page.getByRole('button',{name:'发布协作',exact:true}).click();
await capture('post-anonymous');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
const title=page.locator('.public-record h3 button').first();
if(await title.count()){
  await title.click();await page.waitForTimeout(1800);await capture('task-detail');
  await page.keyboard.press('Escape');await page.waitForTimeout(200);
}
await page.getByRole('button',{name:'02 交流与公告',exact:true}).click();
await capture('discussion-desktop');
await page.getByRole('button',{name:'上一屏：协作任务',exact:true}).click();
await page.locator('.public-filter select').selectOption('CANCELLED');
await page.waitForTimeout(1200);await capture('tasks-filter-cancelled');
await page.locator('.public-filter select').selectOption('');
await page.waitForTimeout(600);
await context.setOffline(true);
await page.getByRole('button',{name:'刷新公开协作',exact:true}).click();
await page.waitForTimeout(2400);await capture('offline');
await context.setOffline(false);
await page.getByRole('button',{name:'刷新公开协作',exact:true}).click();
await page.waitForTimeout(1200);
for(const viewport of [{width:768,height:1024},{width:390,height:844},{width:844,height:390}]){
  await page.setViewportSize(viewport);
  await page.getByRole('link',{name:'CrewTrace 公开协作',exact:true}).click();
  await capture(`home-${viewport.width}`);
  await page.getByRole('link',{name:'向下探索',exact:true}).click();
  await capture(`tasks-${viewport.width}`);
  await page.getByRole('button',{name:'02 交流与公告',exact:true}).click();
  await capture(`discussion-${viewport.width}`);
}
await page.setViewportSize({width:390,height:844});
await page.getByRole('link',{name:'CrewTrace 公开协作',exact:true}).click();
await page.getByRole('button',{name:'切换为英文',exact:true}).click();
await capture('home-mobile-en');
await page.getByRole('link',{name:'Explore below',exact:true}).click();
await capture('tasks-mobile-en');
await page.emulateMedia({reducedMotion:'reduce'});
await page.getByRole('link',{name:'CrewTrace collaboration',exact:true}).click();
await capture('home-reduced-motion');
await writeFile(out+'observations.json',JSON.stringify(result,null,2));
await browser.close();
