(function () {
  var config = window.CREWTRACE_DEMO || {};
  var title = document.getElementById('demo-title');
  var note = document.getElementById('demo-note');
  var state = document.getElementById('demo-state');
  var link = document.getElementById('demo-link');
  var headerState = document.getElementById('header-demo-state');
  var url = typeof config.url === 'string' ? config.url : '';
  var valid = false;
  try {
    var parsed = new URL(url);
    valid = parsed.protocol === 'https:' && /(^|\.)trycloudflare\.com$/.test(parsed.hostname);
  } catch (error) {
    valid = false;
  }
  if (config.status === 'live' && valid) {
    state.textContent = 'LIVE';
    state.setAttribute('data-state', 'live');
    if (headerState) {
      headerState.textContent = 'DEMO LIVE';
      headerState.setAttribute('data-state', 'live');
    }
    title.textContent = '公网演示进行中';
    note.textContent = '这是临时演示地址，演示结束后立即失效。演示使用测试数据，不代表真实客户交易。';
    link.href = url;
    link.hidden = false;
  } else {
    state.textContent = 'CLOSED';
    state.setAttribute('data-state', 'closed');
    if (headerState) {
      headerState.textContent = 'DEMO CLOSED';
      headerState.setAttribute('data-state', 'closed');
    }
    link.hidden = true;
  }
})();
