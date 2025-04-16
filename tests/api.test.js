const request = require('supertest');
const app = require('../server'); // Your server.js must export app

describe('🧪 WinMyDispute API Tests', () => {
  it('GET / should return homepage HTML', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('WinMyDispute GPT API is live');
  });

  it('GET /terms should return license terms', async () => {
    const res = await request(app).get('/terms/terms.html');
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('All rights reserved');
  });

  it('GET /.well-known/ai-plugin.json should return plugin JSON', async () => {
    const res = await request(app).get('/.well-known/ai-plugin.json');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('name_for_human');
  });

  it('GET /nonexistent should 404', async () => {
    const res = await request(app).get('/this-does-not-exist');
    expect(res.statusCode).toBe(404);
  });
});

