import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir:'./test',
  testMatch:'browser-*.spec.ts',
  workers:1,
  reporter:[['list'],['json',{outputFile:process.env.BROWSER_REPORT??'../../.local/web-integration/browser-smoke.json'}]],
  timeout:90000,
  expect:{timeout:45000},
  outputDir:'../../.local/web-integration/playwright',
  use:{baseURL:process.env.WEB_BASE_URL??'http://127.0.0.1:5175',headless:true,screenshot:'off',trace:'off',video:'off',...(process.env.BROWSER_PROXY?{proxy:{server:process.env.BROWSER_PROXY}}:{})},
});
