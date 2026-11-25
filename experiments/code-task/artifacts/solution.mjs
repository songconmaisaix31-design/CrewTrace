function normalizeTicketCode(value) {
  const cleaned = String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const withoutPrefix = cleaned.startsWith('TC') ? cleaned.slice(2) : cleaned;
  return `TC-${withoutPrefix}`;
}

module.exports = { normalizeTicketCode };
