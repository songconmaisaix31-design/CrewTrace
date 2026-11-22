import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test.use({ channel: process.env.CI?'chromium':'chrome' });

test('任务发布者能保存 CSV 候选排名并读取真实验证证据', async ({ page, request, baseURL }) => {
  test.setTimeout(120_000);
  test.skip(baseURL !== 'http://127.0.0.1:55173', '此测试只向实验用本地 Runtime 写入');
  const configured = await request.get('/api/web?action=collaboration-config');
  expect(await configured.json()).toMatchObject({ mcpURL: 'http://127.0.0.1:55581/mcp' });
  const post = async (path: string, data: unknown, credential?: string) => {
    const response = await request.post('http://127.0.0.1:55581/api/collaboration'+path,{
      data, headers:credential?{ Authorization:`Bearer ${credential}` }:{},
    });
    expect(response.ok(),await response.text()).toBeTruthy();
    return response.json();
  };
  const owner = await post('/agents',{name:'Portfolio browser coordinator'});
  const worker = await post('/agents',{name:'Portfolio browser CSV worker',capabilities:['csv-data-review']});
  await post('/agents/me/heartbeat', {}, worker.credential);
  const task = await post('/tasks',{title:'Portfolio browser verification',description:'Validate inline CSV',requiredCapabilities:['csv-data-review']},owner.credential);
  const claim = await post(`/tasks/${task.taskId}/claims`,{expectedVersion:task.version,scope:'csv-data-review',proposalId:null},worker.credential);
  await post(`/tasks/${task.taskId}/handoffs`,{claimId:claim.claimId,content:'record_id,amount_cents\nsource-1,88\n'},worker.credential);
  await page.addInitScript(credential=>localStorage.setItem('co-vibe-collaboration-credential',credential),owner.credential);
  await page.goto(`/?task=${task.taskId}#collaborate`);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading',{name:'V2 匹配与交付证据'})).toBeVisible();
  await expect(dialog.getByText('PASS · csv-ledger-v1',{exact:false})).toBeVisible();
  await dialog.getByRole('button',{name:'生成并保存候选排名'}).click();
  await expect(dialog.getByText('csv-role-reputation-v1',{exact:false})).toBeVisible();
  await expect(dialog.getByText('Portfolio browser CSV worker',{exact:true}).first()).toBeVisible();
  await page.reload();
  await expect(dialog.getByText('csv-role-reputation-v1',{exact:false})).toBeVisible();
  await page.screenshot({path:'../../.local/portfolio-web-evidence.png'});
  const workflowTitle=`Portfolio browser workflow ${randomUUID().slice(0,8)}`;
  const managed = await post('/tasks',{title:workflowTitle,description:'Three-step fixed input',requiredCapabilities:['csv-data-review']},owner.credential);
  await page.goto(`/?task=${managed.taskId}#collaborate`);
  await dialog.getByText('配置三步骤 CSV 工作流',{exact:true}).click();
  await dialog.getByLabel('公开 CSV 输入').fill('record_id,amount_cents\nsource-1,88\n');
  await dialog.getByRole('button',{name:'保存工作流'}).click();
  await expect(dialog.getByText('csv-workflow-v1 · 自动分工',{exact:true})).toBeVisible();
  for(let step=0;step<3;step++){
    const review=dialog.getByRole('button',{name:'确认交接处理',exact:true});
    await expect(review).toHaveCount(1);
    await review.click();
    await expect(dialog.getByText('成果已接收',{exact:false})).toHaveCount(step+1);
  }
  await expect(dialog.getByText('成果已接收',{exact:false})).toHaveCount(3);
  await expect(dialog.getByText('PASS · csv-ledger-v1 · 已计入信誉',{exact:true})).toBeVisible();
  await page.screenshot({path:'../../.local/portfolio-rc-web.png'});
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'运行与评测',exact:true}).click();
  await expect(dialog.getByRole('button',{name:workflowTitle,exact:true})).toBeVisible();
  await expect(dialog.getByRole('link',{name:'下载原始评测记录',exact:true})).toBeVisible();
});
