const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const pdf = require('html-pdf');
const { v4: uuidv4 } = require('uuid');
const Stripe = require('stripe');
const { validateRequiredFields, isIsoDate, normalizeString } = require('./src/lib/validation');
require('dotenv').config();

const app = express();
const port = Number(process.env.PORT) || 3000;
const tokensPath = path.join(__dirname, 'src', 'tokens.json');
const staticPath = path.join(__dirname, 'src', 'static');
const disputeSchemaPath = path.join(__dirname, 'mock-data', 'disputeSchema.json');

const safeReadJson = (filePath, fallback = null) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_err) {
    return fallback;
  }
};

const writeJson = (filePath, payload) => {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
};

if (!fs.existsSync(tokensPath)) {
  writeJson(tokensPath, []);
}

const disputeSchema = safeReadJson(disputeSchemaPath, { networks: {}, scenarios: {}, bins: {}, issuers: {} });
const allowedNetworks = Object.keys(disputeSchema.networks || {});
const schemaVersion = disputeSchema.schemaVersion || 'unknown';

const schemaErrors = [];
if (!schemaVersion) schemaErrors.push('schemaVersion is required');
if (allowedNetworks.length === 0) schemaErrors.push('At least one network must exist');

const normalizeNetwork = (value = '') => normalizeString(value).toLowerCase();
const normalizeScenario = (value = '') => normalizeString(value).toLowerCase();
const getReasonNode = (network, code) => disputeSchema?.networks?.[network]?.reasonCodes?.[code] || null;

const getScenarioKey = (scenario = '') => {
  const normalized = normalizeScenario(scenario);
  if (disputeSchema.scenarios[normalized]) return normalized;

  if (normalized.includes('unauthor') || normalized.includes('fraud')) return 'unauthorized';
  if (normalized.includes('cancel') || normalized.includes('renew')) return 'canceled';
  return 'not_received';
};

// Lightweight rate-limit middleware (memory-only, single instance process).
const buckets = new Map();
const rateLimitWindowMs = 60 * 1000;
const rateLimitProfiles = {
  heavy: Number(process.env.RATE_LIMIT_HEAVY || 20),
  write: Number(process.env.RATE_LIMIT_WRITE || 60),
  read: Number(process.env.RATE_LIMIT_READ || 180),
  static: Number(process.env.RATE_LIMIT_STATIC || 300)
};
const getRouteProfile = (req) => {
  const routeKey = `${req.method} ${req.path}`;
  if (routeKey === 'POST /webhook' || routeKey === 'POST /letter/download') return 'heavy';
  if (req.path.startsWith('/.well-known') || req.path === '/openapi.yaml' || req.path.startsWith('/terms')) return 'static';
  if (req.method === 'GET') return 'read';
  return 'write';
};
const cache = new Map();
const cacheTtlMs = Number(process.env.RESPONSE_CACHE_TTL_MS || 5 * 60 * 1000);
const getCache = (key) => {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }

  return hit.payload;
};
const setCache = (key, payload) => {
  cache.set(key, { payload, expiresAt: Date.now() + cacheTtlMs });
};

app.disable('x-powered-by');
app.use((req, res, next) => {
  const requestId = uuidv4();
  req.requestId = requestId;
  res.set('X-Request-Id', requestId);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'no-referrer');
  next();
});

app.use((req, res, next) => {
  const profile = getRouteProfile(req);
  const routeLimit = rateLimitProfiles[profile];
  const key = req.ip || 'unknown';
  const now = Date.now();
  const bucketKey = `${key}:${profile}`;
  const current = buckets.get(bucketKey) || { count: 0, resetAt: now + rateLimitWindowMs };

  if (now > current.resetAt) {
    current.count = 0;
    current.resetAt = now + rateLimitWindowMs;
  }

  current.count += 1;
  buckets.set(bucketKey, current);

  res.set('X-RateLimit-Limit', String(routeLimit));
  res.set('X-RateLimit-Remaining', String(Math.max(routeLimit - current.count, 0)));
  res.set('X-RateLimit-Profile', profile);

  if (current.count > routeLimit) {
    return res.status(429).json({
      error: 'Too many requests',
      retryAfterSeconds: Math.ceil((current.resetAt - now) / 1000)
    });
  }

  return next();
});

app.use(bodyParser.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));

app.get('/', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'disputegpt-rebuttal-api',
    message: 'Unified DisputeGPT + WinMyDispute API is live.',
    docs: '/openapi.yaml',
    schemaVersion: disputeSchema.schemaVersion
  });
});

app.get('/status', (_req, res) => {
  const status = schemaErrors.length > 0 ? 'degraded' : 'ok';
  res.status(200).json({ status, time: new Date().toISOString(), version: schemaVersion, schemaErrors });
});

app.get('/meta/schema', (_req, res) => {
  res.status(200).json({
    schemaVersion,
    networks: allowedNetworks,
    scenarioCount: Object.keys(disputeSchema.scenarios || {}).length,
    reasonCodeCount: allowedNetworks.reduce((count, network) => count + Object.keys(disputeSchema.networks[network].reasonCodes || {}).length, 0),
    schemaErrors
  });
});

app.get('/meta/capabilities', (_req, res) => {
  res.status(200).json({
    service: 'disputegpt-rebuttal-api',
    capabilities: [
      'reason-code-lookup',
      'rebuttal-strategy',
      'evidence-packet-builder',
      'success-estimation',
      'cfpb-complaint-summary',
      'pdf-letter-generation',
      'bin-resolution',
      'issuer-contact-lookup'
    ],
    performance: {
      cacheTtlMs,
      rateLimitProfiles
    }
  });
});

app.get('/legal', (_req, res) => res.redirect('/terms'));
app.use('/terms', express.static(path.join(staticPath, 'terms')));
app.use('/.well-known', express.static(path.join(staticPath, '.well-known')));
app.get('/openapi.yaml', (_req, res) => res.sendFile(path.join(staticPath, 'openapi.yaml')));

app.get('/bins/:bin', (req, res) => {
  const { bin } = req.params;
  if (!/^\d{6}$/.test(bin)) {
    return res.status(400).json({ error: 'bin must be a 6 digit string' });
  }

  const metadata = disputeSchema.bins?.[bin];
  if (!metadata) {
    return res.status(404).json({ error: 'BIN not found' });
  }

  return res.status(200).json({ bin, ...metadata });
});

app.get('/issuers/:issuer/contact', (req, res) => {
  const issuerKey = String(req.params.issuer || '').toLowerCase().trim();
  const details = disputeSchema.issuers?.[issuerKey];

  if (!details) {
    return res.status(404).json({ error: 'Issuer not found' });
  }

  return res.status(200).json({ issuer: details.name, ...details.contact });
});

app.get('/reasons/lookup', (req, res) => {
  const network = normalizeNetwork(req.query.network);
  const scenarioInput = String(req.query.scenario || '');

  const valid = validateRequiredFields({ network, scenario: scenarioInput }, ['network', 'scenario']);
  if (!valid.ok) {
    return res.status(400).json({ error: `Missing required fields: ${valid.missing.join(', ')}` });
  }

  if (!allowedNetworks.includes(network)) {
    return res.status(400).json({ error: `Unsupported network. Allowed: ${allowedNetworks.join(', ')}` });
  }

  const scenarioKey = getScenarioKey(scenarioInput);
  const scenario = disputeSchema?.scenarios?.[scenarioKey];
  const reason = scenario?.networks?.[network];

  if (!reason) {
    return res.status(404).json({ error: 'No matching reason code found for provided network/scenario' });
  }

  const cacheKey = `lookup:${network}:${scenarioKey}`;
  const cached = getCache(cacheKey);
  if (cached) {
    return res.status(200).json({ ...cached, cached: true });
  }

  const response = { reasonCode: reason.code, title: reason.title, description: reason.description, network, scenario: scenarioKey };
  setCache(cacheKey, response);
  return res.status(200).json(response);
});

app.get('/reasons/:network/:code', (req, res) => {
  const network = normalizeNetwork(req.params.network);
  const code = String(req.params.code || '').trim();

  const reasonNode = getReasonNode(network, code);
  if (!reasonNode) {
    return res.status(404).json({ error: 'Reason code not found in canonical schema' });
  }

  const cacheKey = `reason:${network}:${code}`;
  const cached = getCache(cacheKey);
  if (cached) {
    return res.status(200).json({ ...cached, cached: true });
  }

  const response = {
    reasonCode: code,
    network,
    title: reasonNode.title,
    description: reasonNode.description,
    evidenceRequirements: reasonNode.evidenceToFocusOn,
    commonMerchantRebuttals: reasonNode.commonMerchantRebuttals,
    strategyTips: reasonNode.strategyTips,
    customerStrategy: reasonNode.customerStrategy,
    maxDisputeWindow: reasonNode.maxDisputeWindow || 'Typically up to 120 days depending on issuer policy.'
  };
  setCache(cacheKey, response);
  return res.status(200).json(response);
});

const rebuttalStrategyHandler = (network, code, res) => {
  const reasonNode = getReasonNode(network, code);
  if (!reasonNode) {
    return res.status(404).json({ error: 'No rebuttal strategy found for network/code' });
  }

  return res.status(200).json({
    network,
    code,
    merchantArguments: reasonNode.commonMerchantRebuttals,
    rebuttalTips: reasonNode.strategyTips,
    evidenceToFocusOn: reasonNode.evidenceToFocusOn,
    customerStrategy: reasonNode.customerStrategy
  });
};

app.get('/rebuttal/strategy', (req, res) => {
  const network = normalizeNetwork(req.query.network);
  const code = String(req.query.code || '').trim();

  const valid = validateRequiredFields({ network, code }, ['network', 'code']);
  if (!valid.ok) {
    return res.status(400).json({ error: `Missing required fields: ${valid.missing.join(', ')}` });
  }

  return rebuttalStrategyHandler(network, code, res);
});

app.post('/rebuttal/strategy', (req, res) => {
  const network = normalizeNetwork(req.body.network);
  const code = String(req.body.reasonCode || req.body.code || '').trim();

  const valid = validateRequiredFields({ network, code }, ['network', 'code']);
  if (!valid.ok) {
    return res.status(400).json({ error: `Missing required fields: ${valid.missing.join(', ')}` });
  }

  return rebuttalStrategyHandler(network, code, res);
});

app.post('/rebuttal/simulate', (req, res) => {
  const network = normalizeNetwork(req.body.network);
  const code = String(req.body.code || req.body.reasonCode || '').trim();
  const merchantRebuttal = String(req.body.merchantRebuttal || '');

  const valid = validateRequiredFields({ network, code, merchantRebuttal }, ['network', 'code', 'merchantRebuttal']);
  if (!valid.ok) {
    return res.status(400).json({ error: `Missing required fields: ${valid.missing.join(', ')}` });
  }

  const reasonNode = getReasonNode(network, code);
  if (!reasonNode) {
    return res.status(404).json({ error: 'No rebuttal strategy found for network/code' });
  }

  const matches = reasonNode.commonMerchantRebuttals.filter((point) => merchantRebuttal.toLowerCase().includes(point.toLowerCase()));

  return res.status(200).json({
    network,
    code,
    merchantRebuttal,
    matchedRebuttals: matches,
    recommendedCounterMoves: reasonNode.strategyTips,
    evidenceToAttach: reasonNode.evidenceToFocusOn,
    customerStrategy: reasonNode.customerStrategy
  });
});

app.post('/builder/evidence-packet', (req, res) => {
  const payload = req.body || {};
  const network = normalizeNetwork(payload.network);
  const reasonCode = String(payload.reasonCode || '').trim();

  const valid = validateRequiredFields({ network, reasonCode, transactionDate: payload.transactionDate }, ['network', 'reasonCode', 'transactionDate']);
  if (!valid.ok) {
    return res.status(400).json({ error: `Missing required fields: ${valid.missing.join(', ')}` });
  }
  if (!isIsoDate(payload.transactionDate)) {
    return res.status(400).json({ error: 'transactionDate must be in YYYY-MM-DD format' });
  }

  const reasonNode = getReasonNode(network, reasonCode);
  const compiledEvidence = [
    ...(reasonNode?.evidenceToFocusOn || []),
    payload.transactionAmount ? `Transaction amount documentation: $${payload.transactionAmount}` : null,
    payload.transactionDate ? `Transaction date timeline entry: ${payload.transactionDate}` : null,
    payload.trackingNumber ? `Tracking number validation: ${payload.trackingNumber}` : null,
    payload.activityLog ? 'Account activity narrative included' : null,
    payload.merchantResponse ? 'Merchant response attached for contradiction analysis' : null,
    ...(payload.postTransactionEmails || []).map((_, index) => `Post-transaction communication #${index + 1}`)
  ].filter(Boolean);

  return res.status(200).json({
    compiledEvidence,
    submissionTips: [
      'Order evidence chronologically for faster issuer review.',
      'Lead with objective proof (receipts, logs, timestamps).',
      'Keep narrative concise and map each point to the selected reason code.'
    ],
    estimatedSuccessRate: reasonNode ? 0.82 : 0.61
  });
});

app.post('/disputes/estimate-success', (req, res) => {
  const network = normalizeNetwork(req.body.network);
  const reasonCode = String(req.body.reasonCode || '').trim();
  const priorAttemptsToResolve = Boolean(req.body.priorAttemptsToResolve);
  const merchantResponse = String(req.body.merchantResponse || '').toLowerCase();
  const consumerEvidence = String(req.body.consumerEvidence || '');

  const reasonNode = getReasonNode(network, reasonCode);
  let score = reasonNode ? 0.68 : 0.52;

  if (priorAttemptsToResolve) score += 0.08;
  if (consumerEvidence.length > 20) score += 0.1;
  if (merchantResponse.includes('refund denied')) score += 0.04;
  if (Number(req.body.transactionAmount) > 1000) score -= 0.03;

  const estimatedSuccessRate = Math.max(0.2, Math.min(0.95, Number(score.toFixed(2))));

  return res.status(200).json({
    requestId: req.requestId,
    estimatedSuccessRate,
    rationale: reasonNode
      ? 'Score is boosted by network-specific reason code strategy and available evidence quality.'
      : 'Score is based on generic model because no canonical reason profile matched the network/reasonCode.'
  });
});

app.post('/cfpb/complaint-summary', (req, res) => {
  const { issuer, transaction = {}, summary = '' } = req.body || {};
  const valid = validateRequiredFields({ issuer, summary }, ['issuer', 'summary']);

  if (!valid.ok) {
    return res.status(400).json({ error: `Missing required fields: ${valid.missing.join(', ')}` });
  }

  const complaintSummary = [
    `I am filing this CFPB complaint regarding dispute handling by ${issuer}.`,
    `Transaction date: ${transaction.date || 'N/A'}, amount: ${transaction.amount || 'N/A'}, merchant: ${transaction.merchant || 'N/A'}.`,
    `Issue summary: ${summary}`,
    'I request a complete review of the chargeback investigation process and a written explanation of the final determination.'
  ].join(' ');

  return res.status(200).json({ summary: complaintSummary });
});

app.post('/letter/generate', (req, res) => {
  const {
    token,
    cardholderName,
    issuer,
    transactionAmount,
    transactionDate,
    merchantName,
    reasonCode,
    preferredTone = 'professional'
  } = req.body || {};

  const valid = validateRequiredFields({ cardholderName, issuer, merchantName, reasonCode }, ['cardholderName', 'issuer', 'merchantName', 'reasonCode']);
  if (!valid.ok) {
    return res.status(400).json({ error: `Missing required fields: ${valid.missing.join(', ')}` });
  }

  if (process.env.REQUIRE_DISPUTE_TOKEN === 'true') {
    if (!token) {
      return res.status(403).json({ error: 'Missing token' });
    }

    const tokens = safeReadJson(tokensPath, []);
    const tokenEntry = tokens.find((entry) => entry.token === token && !entry.used);

    if (!tokenEntry) {
      return res.status(403).json({ error: 'Invalid or already used token' });
    }

    tokenEntry.used = true;
    writeJson(tokensPath, tokens);
  }

  const opener = preferredTone === 'firm'
    ? 'I am writing to formally contest this charge and request immediate correction.'
    : 'I am writing to dispute this charge and request a prompt review.';

  const letterText = [
    `Dear ${issuer} Disputes Team,`,
    '',
    opener,
    `The transaction in question is $${transactionAmount || 'N/A'} dated ${transactionDate || 'N/A'} from ${merchantName}.`,
    `Reason code cited: ${reasonCode}.`,
    '',
    'I have attempted to resolve this issue directly with the merchant and am submitting supporting evidence for your review.',
    '',
    'Sincerely,',
    cardholderName
  ].join('\n');

  return res.status(200).json({
    letterText,
    recommendedSubjectLine: `Charge Dispute Request (${reasonCode})`,
    letterPdfUrl: null
  });
});

app.post('/letter/download', (req, res) => {
  const { letterText, cardholderName, merchantName } = req.body || {};

  if (!letterText) {
    return res.status(400).json({ error: 'Missing letterText' });
  }

  const htmlContent = `
    <html><head><style>
      body { font-family: Arial, sans-serif; padding: 40px; }
      h1 { font-size: 22px; margin-bottom: 20px; }
      p, pre { font-size: 16px; line-height: 1.5; }
      pre { white-space: pre-wrap; }
    </style></head><body>
      <h1>Dispute Letter</h1>
      <p><strong>To:</strong> ${merchantName || 'Merchant'}</p>
      <p><strong>From:</strong> ${cardholderName || 'Cardholder'}</p>
      <hr/>
      <pre>${letterText}</pre>
    </body></html>
  `;

  pdf.create(htmlContent, { format: 'Letter' }).toBuffer((err, buffer) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to generate PDF' });
    }

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename=dispute-letter.pdf',
      'Content-Length': buffer.length
    });

    return res.send(buffer);
  });

  return undefined;
});

app.post('/webhook', (req, res) => {
  const secret = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret || !webhookSecret) {
    return res.status(503).json({ error: 'Stripe webhook is not configured' });
  }

  const stripe = Stripe(secret);
  const signature = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, signature, webhookSecret);
  } catch (error) {
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const tokens = safeReadJson(tokensPath, []);

    tokens.push({
      token: uuidv4(),
      email: session.customer_email || null,
      sessionId: session.id,
      used: false,
      createdAt: new Date().toISOString()
    });

    writeJson(tokensPath, tokens);
  }

  return res.status(200).json({ received: true });
});

app.use((_req, _res, next) => {
  const error = new Error('Route not found');
  error.statusCode = 404;
  next(error);
});

app.use((error, _req, res, _next) => {
  const statusCode = error.statusCode || 500;
  const message = statusCode === 500 ? 'Internal server error' : error.message;
  res.status(statusCode).json({
    error: message,
    requestId: _req.requestId || null
  });
});

module.exports = app;

if (require.main === module) {
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`✅ DisputeGPT API running on port ${port}`);
  });
}
