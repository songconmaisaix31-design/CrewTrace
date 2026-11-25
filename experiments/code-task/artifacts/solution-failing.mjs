// 负例样本：缺少大写转换，无法通过固定测试集合。
function normalizeTicketCode(value) {
  const cleaned = String(value).replace(/[^A-Za-z0-9]/g, '');
  const withoutPrefix = cleaned.toUpperCase().startsWith('TC') ? cleaned.slice(2) : cleaned;
  return `TC-${withoutPrefix}`;
}

module.exports = { normalizeTicketCode };
