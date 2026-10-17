import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('CrewTrace一句接入、MCP引导文件下载、隐藏配置及窄屏交互',async({browser},testInfo)=>{
  const context=await browser.newContext({permissions:['clipboard-read','clipboard-write']});
  const page=await context.newPage(),errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto('/');
    await expect(page).toHaveTitle('CrewTrace · Agent 协作工作台');
    await expect(page.getByRole('link',{name:'CrewTrace 公开协作',exact:true})).toBeVisible();
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content',/^CrewTrace：/);
    await expect(page.locator('footer')).toContainText('CrewTrace');
    await page.getByRole('button',{name:'接入 MCP',exact:true}).click();
    const guide=page.getByRole('region',{name:'通过 MCP 起名加入'});
    await expect(guide.locator('[data-mcp-advanced]')).not.toHaveAttribute('open');
    await expect(page.getByLabel('MCP 服务地址',{exact:true})).not.toBeVisible();
    await expect(guide.getByRole('button')).toHaveCount(1);
    await page.getByRole('button',{name:'一键复制给 Agent',exact:true}).click();
    await expect(page.getByRole('status')).toContainText('接入指令已复制');
    const instruction='连接 https://mcp.davidwang.space/mcp，调用 get_collaboration_guide 获取指引，按我的需求加入协作、发布或参与悬赏。';
    expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(instruction);
    expect(readFileSync(new URL('../public/agent-prompt.md',import.meta.url),'utf8').trim()).toBe(instruction);
    await expect(page.getByRole('link',{name:'下载 Skill',exact:true})).not.toBeVisible();
    await page.getByText('高级说明',{exact:true}).click();
    const [skillDownload]=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:'下载 Skill',exact:true}).click()]);
    const skillPath=testInfo.outputPath('SKILL.md');await skillDownload.saveAs(skillPath);
    expect(readFileSync(skillPath)).toEqual(readFileSync(new URL('../public/skills/crewtrace/SKILL.md',import.meta.url)));
    const [promptDownload]=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:'下载接入指令',exact:true}).click()]);
    const promptPath=testInfo.outputPath('agent-prompt.md');await promptDownload.saveAs(promptPath);
    expect(readFileSync(promptPath)).toEqual(readFileSync(new URL('../public/agent-prompt.md',import.meta.url)));
    await expect(page.getByLabel('MCP 服务地址',{exact:true})).toHaveValue('https://mcp.davidwang.space/mcp');
    await page.getByRole('button',{name:'复制MCP 配置',exact:true}).click();
    expect(await page.evaluate(async()=>JSON.parse(await navigator.clipboard.readText()))).toEqual({mcpServers:{crewtrace:{type:'http',url:'https://mcp.davidwang.space/mcp'}}});
    await expect(guide.locator('ol,.public-tools')).toHaveCount(0);
    await page.setViewportSize({width:390,height:844});
    expect(await page.getByRole('dialog').evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button',{name:'接入 MCP',exact:true})).toBeFocused();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.locator('.public-identity').click();
    await expect(page.getByLabel('Agent 名称',{exact:true})).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('link',{name:'CSV 验证',exact:true})).toHaveCount(0);
    await expect(page.getByRole('heading',{name:'MON 悬赏',exact:true})).toHaveCount(0);
    expect(errors).toEqual([]);
  }finally{await context.close();}
});
