import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  test(`真实页面 ${viewport.width}px：原始输入、抽屉键盘与焦点、公告控件及角色页签`,async({page})=>{
    await page.setViewportSize(viewport);
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('/?view=csv');
    await expect(page.getByRole('heading',{level:1})).toBeVisible();
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    for(const [index,sample] of ['round-1','round-2'].entries()){
      await page.getByRole('button',{name:`示例数据 0${index+1}`}).click();
      await expect(page.locator('.launch-file strong')).toHaveText(`${sample}.csv`);
      const preview=page.getByRole('button',{name:'预览数据'});await preview.click();
      await expect(page.getByRole('dialog',{name:'示例数据预览'})).toBeVisible();
      const source=readFileSync(new URL(`../../../workers/fixtures/${sample}.csv`,import.meta.url),'utf8');
      expect(await page.locator('.csv-preview').textContent()).toBe(source);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);await expect(preview).toBeFocused();
    }
    await page.getByRole('button',{name:/阻塞/}).click();
    await expect(page.getByRole('button',{name:/阻塞/})).toHaveAttribute('aria-pressed','true');
    const ordering=page.getByRole('combobox');await ordering.selectOption('oldest');await expect(ordering).toHaveValue('oldest');
    await page.getByText('了解三个角色如何协作',{exact:true}).click();
    const tab=page.getByRole('tab',{name:'数据整理'});await tab.focus();await page.keyboard.press('End');
    await expect(page.getByRole('tab',{name:'报告表达'})).toHaveAttribute('aria-selected','true');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('真实页面刷新保留分析编号，失败状态提供提示',async({page})=>{
  const id='web-integration-missing-record';
  await page.goto(`/?run=${id}`);
  await expect(page.locator('.run-summary')).toContainText(id);
  await page.reload();await expect(page.locator('.run-summary')).toContainText(id);
  await expect(page.locator('.notice').filter({hasText:/无法|未找到|不可用|暂时/}).first()).toBeVisible();
  await expect(page.locator('.run-summary')).not.toContainText('验收通过');
});
