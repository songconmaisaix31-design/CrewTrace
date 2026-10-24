import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir:'./test',
  testMatch:'browser-*.spec.ts',
  workers:1,
  reporter:[['list'],['json',{outputFile:process.env.BROWSER_REPORT??'../../.local/web-integration/browser-smoke.json'}]],
  timeout:90000,
  expect:{timeout:45000},
  webServer:{command:'node --import tsx ../../services/runtime/src/local.ts',url:'http://127.0.0.1:3000/health',reuseExistingServer:false,timeout:30000,env:{DATABASE_URL:'pglite://../../.local/browser-automation',PAYMENT_MODE:'disabled',PORT:'3000'}},
  outputDir:'../../.local/web-integration/playwright',
  use:{baseURL:process.env.WEB_BASE_URL??'http://127.0.0.1:3000',headless:true,screenshot:'off',trace:'off',video:'off',launchOptions:process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']}:{}},
});
