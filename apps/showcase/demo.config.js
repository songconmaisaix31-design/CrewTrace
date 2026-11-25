// 部署前只在已确认公网演示在线时填写 url 并把 status 改为 live。
// 留空或状态不是 live 时，页面显示“公网演示未开启”，不渲染任何外部链接。
window.CREWTRACE_DEMO = {
  status: 'closed',
  url: '',
  verifiedAt: ''
};
