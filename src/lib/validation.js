const validateRequiredFields = (payload, fields) => {
  const missing = fields.filter((field) => {
    const value = payload[field];
    if (Array.isArray(value)) return value.length === 0;
    return value === undefined || value === null || String(value).trim() === '';
  });

  return {
    ok: missing.length === 0,
    missing
  };
};

const isIsoDate = (value = '') => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());

const normalizeString = (value = '') => String(value || '').trim();

module.exports = {
  validateRequiredFields,
  isIsoDate,
  normalizeString
};
