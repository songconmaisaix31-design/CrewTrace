import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { RunDetailSchema } from '@co-vibe/contracts';

const sample=process.env.SAMPLE;
if(sample!=='round-1'&&sample!=='round-2')throw new Error('SAMPLE 必须明确指定 round-1 或 round-2');
if(!process.env.DEMO_ACCESS_CODE)throw new Error('需要私有演示访问码');

test('通过真实页面创建指定轮次并读取持久记录',async({page})=>{
  await page.goto('/?view=csv');
  await page.getByRole('button',{name:`示例数据 0${sample==='round-1'?'1':'2'}`}).click();
  const start=page.getByRole('button',{name:'开始分析',exact:true});await expect(start).toBeEnabled();await start.click();
  const input=page.getByLabel('访问码',{exact:true});await expect(input).toBeVisible();await input.fill(process.env.DEMO_ACCESS_CODE!);
  await page.getByRole('button',{name:'确认开始',exact:true}).click();
  await expect(page).toHaveURL(/[?&]run=/);
  const runId=new URL(page.url()).searchParams.get('run');expect(runId).toBeTruthy();
  const response=await page.request.get(`/api/web?path=${encodeURIComponent(`/api/runs/${runId}`)}`);
  expect(response.status()).toBe(200);
  const run=RunDetailSchema.parse(await response.json());expect(run.runId).toBe(runId);
  expect(run.validator).toBe(process.env.VALIDATOR_ADDRESS!.toLowerCase());
  const result={sample,runId,createdAt:run.createdAt,validator:run.validator,inputHash:run.inputHash,criteriaHash:run.criteriaHash,status:run.status,url:page.url()};
  writeFileSync(new URL(`../../../.local/web-integration/ui-${sample}.json`,import.meta.url),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.locator('#demo-code').count()).toBe(0);
});
