import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('CrewTrace一键接入、完整提示词与Skill下载、隐藏字段及窄屏交互',async({browser},testInfo)=>{
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
    await expect(page.getByRole('status')).toContainText('完整接入说明已复制');
    // Windows 剪贴板使用 CRLF；下载文件另外按原始字节核对。
    expect((await page.evaluate(()=>navigator.clipboard.readText())).replaceAll('\r\n','\n')).toBe(readFileSync(new URL('../public/agent-prompt.md',import.meta.url),'utf8').replaceAll('\r\n','\n'));
    const [skillDownload]=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:'下载 Skill',exact:true}).click()]);
    const skillPath=testInfo.outputPath('SKILL.md');await skillDownload.saveAs(skillPath);
    expect(readFileSync(skillPath)).toEqual(readFileSync(new URL('../public/skills/crewtrace/SKILL.md',import.meta.url)));
    await page.getByText('高级说明',{exact:true}).click();
    await expect(guide.locator('ol>li>h3')).toHaveText(['连接 CrewTrace','给 Agent 起名','保存个人凭证','开始交流']);
    const [promptDownload]=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:'下载提示词',exact:true}).click()]);
    const promptPath=testInfo.outputPath('agent-prompt.md');await promptDownload.saveAs(promptPath);
    expect(readFileSync(promptPath)).toEqual(readFileSync(new URL('../public/agent-prompt.md',import.meta.url)));
    await expect(page.getByLabel('MCP 服务地址',{exact:true})).toHaveValue('https://mcp.davidwang.space/mcp');
    await page.getByRole('button',{name:'复制MCP 配置',exact:true}).click();
    expect(await page.evaluate(async()=>JSON.parse(await navigator.clipboard.readText()))).toEqual({mcpServers:{crewtrace:{type:'http',url:'https://mcp.davidwang.space/mcp'}}});
    await page.getByRole('button',{name:'复制起名加入指令',exact:true}).click();
    expect(await page.evaluate(()=>navigator.clipboard.readText())).toContain('join_collaboration');
    await expect(guide.locator('details').filter({has:page.getByText('查看调用示例与凭证设置',{exact:true})}).last()).not.toHaveAttribute('open');
    await page.getByText('查看调用示例与凭证设置',{exact:true}).click();
    await expect(guide.locator('pre').first()).toContainText('join_collaboration');
    await page.getByText('查看全部协作工具和参数',{exact:true}).click();
    const joinTool=page.locator('.public-tools li').filter({has:page.getByText('join_collaboration',{exact:true})});
    await joinTool.locator('summary').click();
    expect(JSON.parse((await joinTool.locator('pre').textContent())!).required).toEqual(['name']);
    await page.setViewportSize({width:390,height:844});
    expect(await page.getByRole('dialog').evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button',{name:'接入 MCP',exact:true})).toBeFocused();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.locator('.public-identity').click();
    await expect(page.getByLabel('Agent 名称',{exact:true})).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('link',{name:'CSV 验证',exact:true}).click();
    await expect(page.getByRole('button',{name:'CrewTrace 工作台',exact:true})).toBeVisible();
    await expect(page.locator('.launch-kicker')).toContainText('CrewTrace');
    await expect(page.locator('footer')).toContainText('CrewTrace');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  }finally{await context.close();}
});
