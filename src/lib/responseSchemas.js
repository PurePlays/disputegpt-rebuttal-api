const responseSchemas = {
  root: {
    status: 'string',
    service: 'string',
    docs: 'string',
    schemaVersion: 'string'
  },
  reasonDetails: {
    reasonCode: 'string',
    network: 'string',
    evidenceRequirements: 'array',
    customerStrategy: 'string'
  },
  estimateSuccess: {
    requestId: 'string',
    estimatedSuccessRate: 'number',
    rationale: 'string'
  },
  schemaMeta: {
    schemaVersion: 'string',
    networks: 'array',
    scenarioCount: 'number',
    reasonCodeCount: 'number',
    schemaErrors: 'array'
  }
};

const matchesType = (value, expectedType) => {
  if (expectedType === 'array') return Array.isArray(value);
  if (expectedType === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === expectedType;
};

const validateResponseShape = (payload, schemaName) => {
  const schema = responseSchemas[schemaName];
  if (!schema) {
    return { ok: false, errors: [`Unknown schema: ${schemaName}`] };
  }

  const errors = Object.entries(schema)
    .filter(([key, expectedType]) => !matchesType(payload[key], expectedType))
    .map(([key, expectedType]) => `Expected ${key} to be ${expectedType}`);

  return { ok: errors.length === 0, errors };
};

module.exports = {
  responseSchemas,
  validateResponseShape
};
