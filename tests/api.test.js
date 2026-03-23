const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../server');
const { validateResponseShape } = require('../src/lib/responseSchemas');

describe('🧪 DisputeGPT Unified API Tests', () => {
  it('GET / should return service metadata', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toBe(200);
    expect(res.body.service).toBe('disputegpt-rebuttal-api');
    expect(res.body).toHaveProperty('schemaVersion');
    expect(res.headers).toHaveProperty('x-request-id');
    expect(validateResponseShape(res.body, 'root').ok).toBe(true);
  });

  it('GET /terms should redirect to terms html index', async () => {
    const res = await request(app).get('/terms');
    expect([301, 302]).toContain(res.statusCode);
  });

  it('GET /.well-known/ai-plugin.json should return plugin JSON', async () => {
    const res = await request(app).get('/.well-known/ai-plugin.json');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('name_for_human');
  });

  it('GET /reasons/visa/13.1 should return canonical reason details', async () => {
    const res = await request(app).get('/reasons/visa/13.1');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('evidenceRequirements');
    expect(res.body).toHaveProperty('customerStrategy');
    expect(validateResponseShape(res.body, 'reasonDetails').ok).toBe(true);
  });

  it('POST /builder/evidence-packet should validate required fields', async () => {
    const res = await request(app).post('/builder/evidence-packet').send({ network: 'visa' });
    expect(res.statusCode).toBe(400);
  });

  it('POST /builder/evidence-packet should validate transactionDate format', async () => {
    const res = await request(app).post('/builder/evidence-packet').send({
      network: 'visa',
      reasonCode: '13.1',
      transactionDate: '03/01/2026'
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('YYYY-MM-DD');
  });

  it('GET /bins/:bin should resolve canonical BIN metadata', async () => {
    const res = await request(app).get('/bins/414720');
    expect(res.statusCode).toBe(200);
    expect(res.body.network).toBe('visa');
  });

  it('GET /issuers/:issuer/contact should return issuer contacts', async () => {
    const res = await request(app).get('/issuers/chase/contact');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('mailingAddress');
  });

  it('OpenAPI parity check: key documented paths should be available', async () => {
    const openapi = fs.readFileSync(path.join(__dirname, '..', 'src', 'static', 'openapi.yaml'), 'utf8');
    const documentedPaths = [
      '/meta/capabilities',
      '/bins/{bin}',
      '/issuers/{issuer}/contact',
      '/reasons/lookup',
      '/reasons/{network}/{code}',
      '/builder/evidence-packet',
      '/letter/generate',
      '/letter/download',
      '/disputes/estimate-success',
      '/rebuttal/strategy',
      '/cfpb/complaint-summary'
    ];

    documentedPaths.forEach((p) => {
      expect(openapi).toContain(p);
    });

    const probes = await Promise.all([
      request(app).get('/reasons/lookup?network=visa&scenario=not_received'),
      request(app).post('/rebuttal/strategy').send({ network: 'visa', reasonCode: '13.1' }),
      request(app).post('/disputes/estimate-success').send({ network: 'visa', reasonCode: '13.1' }),
      request(app).post('/cfpb/complaint-summary').send({ issuer: 'Chase', summary: 'Dispute denied without explanation.' })
    ]);

    probes.forEach((res) => {
      expect(res.statusCode).toBe(200);
    });
  });

  it('GET /meta/schema should provide schema health and counts', async () => {
    const res = await request(app).get('/meta/schema');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('schemaVersion');
    expect(res.body.reasonCodeCount).toBeGreaterThan(0);
    expect(validateResponseShape(res.body, 'schemaMeta').ok).toBe(true);
  });

  it('GET /meta/capabilities should return capability matrix', async () => {
    const res = await request(app).get('/meta/capabilities');
    expect(res.statusCode).toBe(200);
    expect(res.body.capabilities).toContain('rebuttal-strategy');
    expect(res.body.performance).toHaveProperty('cacheTtlMs');
  });

  it('Rate limiting should be profile-based by route category', async () => {
    const readRes = await request(app).get('/status');
    const writeRes = await request(app).post('/disputes/estimate-success').send({ network: 'visa', reasonCode: '13.1' });

    expect(readRes.statusCode).toBe(200);
    expect(writeRes.statusCode).toBe(200);
    expect(readRes.headers['x-ratelimit-profile']).toBe('read');
    expect(writeRes.headers['x-ratelimit-profile']).toBe('write');
    expect(Number(readRes.headers['x-ratelimit-limit'])).toBeGreaterThan(Number(writeRes.headers['x-ratelimit-limit']));
  });

  it('POST /disputes/estimate-success should match response contract', async () => {
    const res = await request(app).post('/disputes/estimate-success').send({ network: 'visa', reasonCode: '13.1' });
    expect(res.statusCode).toBe(200);
    expect(validateResponseShape(res.body, 'estimateSuccess').ok).toBe(true);
  });
});
