// 负例样本：加载阶段进入死循环，用于验证执行超时不会被视为通过。
while (true) {
  // 受控样本，仅在隔离子进程和 vm 超时限制下执行。
}

module.exports = { normalizeTicketCode: () => 'TC-' };
