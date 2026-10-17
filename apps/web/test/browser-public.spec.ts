import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { keccak256 } from 'viem';

async function register(page:Page,name:string){
  await page.goto('/');
  await page.locator('.public-identity').click();
  await page.getByLabel('Agent 名称',{exact:true}).fill(name);
  await page.getByRole('button',{name:'注册并加入',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.public-identity')).toContainText(name);
}

test('真实公开协作：两身份注册、消息互读、认领、实际CSV摘要交付与接受、刷新和MCP',async({browser})=>{
  test.setTimeout(180000);
  const ownerContext=await browser.newContext({permissions:['clipboard-read','clipboard-write']}),workerContext=await browser.newContext();
  const owner=await ownerContext.newPage(),worker=await workerContext.newPage(),errors:string[]=[];
  owner.on('pageerror',error=>errors.push(error.message));worker.on('pageerror',error=>errors.push(error.message));
  const suffix=randomUUID(),ownerName=`web-owner-${suffix}`,workerName=`web-worker-${suffix}`;
  try{
    await register(owner,ownerName);
    await owner.getByLabel('交流内容',{exact:true}).fill(`公开交流验证 ${suffix}`);
    await owner.getByRole('button',{name:'发布消息',exact:true}).click();
    await expect(owner.locator('.public-message').filter({hasText:`公开交流验证 ${suffix}`})).toBeVisible();
    await register(worker,workerName);
    await expect(worker.locator('.public-message').filter({hasText:`公开交流验证 ${suffix}`})).toBeVisible();
    await worker.getByLabel('交流内容',{exact:true}).fill(`独立浏览器身份已读取 ${suffix}`);
    await worker.getByRole('button',{name:'发布消息',exact:true}).click();
    await expect(owner.locator('.public-message').filter({hasText:`独立浏览器身份已读取 ${suffix}`})).toBeVisible();
    await owner.getByRole('button',{name:'发布协作',exact:true}).click();
    await owner.getByLabel('任务标题',{exact:true}).fill(`前端真实验收：公开CSV原始摘要核对 ${suffix}`);
    await owner.getByLabel('任务说明',{exact:true}).fill('读取本公开仓库的固定CSV原文字节，计算并交付keccak256摘要。');
    await owner.getByLabel('模拟悬赏标价（MON，可选）',{exact:true}).fill('1.5');
    await owner.getByRole('button',{name:'发布任务',exact:true}).click();
    await expect(owner).toHaveURL(/[?&]task=/);
    const taskId=new URL(owner.url()).searchParams.get('task');expect(taskId).toBeTruthy();
    console.log(JSON.stringify({baseURL:new URL(owner.url()).origin,taskId,phase:'created'}));
    await worker.goto(`/?task=${taskId}`);
    await expect(worker.locator('.public-task-detail h2')).toContainText(suffix);
    await expect(worker.locator('.public-task-detail')).toContainText('模拟标价，未付款、未上链');
    await expect(worker.locator('.public-identity')).toContainText(workerName);
    await worker.getByLabel('我愿意承担的工作',{exact:true}).fill('核对公开CSV原始字节的摘要');
    await worker.getByRole('button',{name:'认领这部分工作',exact:true}).click();
    await expect(worker.getByRole('combobox',{name:'对应承担',exact:true})).toBeVisible();
    const source=readFileSync(new URL('../../../workers/fixtures/round-1.csv',import.meta.url));
    const content=`已读取公开CSV原始${source.length}字节，keccak256=${keccak256(source)}。`;
    await worker.getByLabel('成果内容',{exact:true}).fill(content);
    await worker.getByRole('button',{name:'提交成果交接',exact:true}).click();
    await expect(owner.locator('.public-task-detail')).toContainText(content);
    await owner.getByRole('button',{name:'确认交接处理',exact:true}).click();
    await expect(owner.locator('.public-task-detail')).toContainText('成果已接收');
    await owner.getByRole('button',{name:'确认任务完成',exact:true}).click();
    await expect(owner.locator('.public-task-detail>header .public-pill')).toHaveText('已完成');
    await worker.reload();
    await expect(worker.locator('.public-task-detail>header .public-pill')).toHaveText('已完成');
    await expect(worker.locator('.public-identity')).toContainText(workerName);
    await expect(worker.locator('.public-task-detail')).toContainText(content);
    await workerContext.setOffline(true);
    await expect(worker.getByRole('status').filter({hasText:'连接中断'}).first()).toBeVisible();
    await expect(worker.locator('.public-task-detail')).toContainText(content);
    await workerContext.setOffline(false);
    await expect(worker.getByRole('status').filter({hasText:'连接中断'})).toHaveCount(0);
    await owner.bringToFront();
    await owner.getByRole('button',{name:'接入 MCP',exact:true}).click();
    await expect(owner.getByRole('dialog')).toContainText('publish_collaboration_message');
    await expect(owner.getByRole('region',{name:'通过 MCP 起名加入'})).toContainText('onboarding.nextCall');
    await expect(owner.getByLabel('MCP 服务地址',{exact:true})).toHaveValue('https://mon.davidwang.space/mcp');
    await owner.getByRole('button',{name:'复制MCP 配置',exact:true}).click();
    expect(await owner.evaluate(async()=>{
      const copied=JSON.parse(await navigator.clipboard.readText());
      return copied.mcpServers['co-vibe'].headers.Authorization===`Bearer ${localStorage.getItem('co-vibe-collaboration-credential')}`;
    })).toBe(true);
    await owner.keyboard.press('Escape');
    await expect(owner.getByRole('button',{name:'接入 MCP',exact:true})).toBeFocused();
    await worker.setViewportSize({width:390,height:844});
    expect(await worker.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    console.log(JSON.stringify({taskId,owner:ownerName,worker:workerName,status:'COMPLETED',bountyMode:'MOCK',sourceHash:keccak256(source)}));
  }finally{await ownerContext.close();await workerContext.close();}
});

test('只读独立MCP真实任务与刷新同步',async({page})=>{
  const id=process.env.PUBLIC_REFERENCE_TASK;test.skip(!id,'需要独立MCP验证产生的真实任务编号');
  await page.goto(`/?task=${id}`);
  await expect(page.locator('.public-task-detail>header .public-pill')).toHaveText('已完成');
  await expect(page.locator('.public-task-detail')).toContainText('成果已接收');
  await expect(page.locator('.public-message').first()).toBeVisible();
  await page.reload();
  await expect(page.locator('.public-task-detail>header .public-pill')).toHaveText('已完成');
});
