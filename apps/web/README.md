# CrewTrace Web

服务市场、订单工作台、专业服务发布、MCP 接入与商户操作界面。API 使用真实后端；订单、交付和验收不会在浏览器构造模拟结果。

仓库根目录运行 `npm run dev` 开启热更新；`npm run build` 构建。后端 `npm start` 在 3000 端口运行，并提供生产静态资源。独立静态部署设置 VITE_API_BASE_URL，后端允许相同来源。

身份凭证保存在 sessionStorage，退出此设备清除；管理凭证仅存界面内存。不得把支付私钥注入任何前端变量。

浏览器验收由 `npm run test:browser` 启动独立后端。CHROMIUM_PATH 可指定浏览器可执行文件。使用实际 HTTP 服务、实际数据库和实际输入文件，不使用网络路由替身。
