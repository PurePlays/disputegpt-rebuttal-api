// server.js — Final Production API for WinMyDispute GPT
const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const pdf = require('html-pdf');
const { v4: uuidv4 } = require('uuid');
const Stripe = require('stripe');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

app.use(bodyParser.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

app.use(express.json());

const tokensFile = path.join(__dirname, 'tokens.json');
if (!fs.existsSync(tokensFile)) {
  fs.writeFileSync(tokensFile, JSON.stringify([]));
}

app.get('/', (req, res) => {
  const copyright = `© ${new Date().getFullYear()} PurePlays & Daniel Neville. All rights reserved.`;
  res.send(`
    <h2>✅ WinMyDispute GPT API is live.</h2>
    <p>${copyright}<br>
    Unauthorized reproduction or reverse engineering is strictly prohibited.<br>
    <a href="/terms">View full license terms</a></p>
  `);
});

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
  } catch (err) {
    console.error('❌ Invalid webhook signature:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const token = uuidv4();

    const tokens = JSON.parse(fs.readFileSync(tokensFile));
    tokens.push({
      token,
      email: session.customer_email || null,
      sessionId: session.id,
      used: false,
      createdAt: new Date().toISOString()
    });
    fs.writeFileSync(tokensFile, JSON.stringify(tokens, null, 2));
    console.log(`✅ Token issued: ${token}`);
  }

  res.status(200).send({ received: true });
});

app.post('/letter/generate', (req, res) => {
  const {
    token, cardholderName, issuer, statementDate,
    transactionAmount, transactionDate, merchantName,
    reasonCode, preferredTone
  } = req.body;

  if (!token) return res.status(403).send('Missing token');

  const tokens = JSON.parse(fs.readFileSync(tokensFile));
  const tokenEntry = tokens.find(t => t.token === token && !t.used);

  if (!tokenEntry) return res.status(403).send('Invalid or already used token');

  tokenEntry.used = true;
  fs.writeFileSync(tokensFile, JSON.stringify(tokens, null, 2));

  const letterText = `Dear ${issuer},\n\nI am disputing a charge of $${transactionAmount} on ${transactionDate} from ${merchantName}, for the following reason: ${reasonCode}.\n\nThank you,\n${cardholderName}`;

  res.status(200).json({
    letterText,
    recommendedSubjectLine: 'Dispute Letter - Unauthorized Transaction',
    letterPdfUrl: null
  });
});

app.post('/letter/download', (req, res) => {
  const { letterText, cardholderName, merchantName } = req.body;

  if (!letterText) return res.status(400).send('Missing letter text');

  const htmlContent = `
    <html><head><style>
    body { font-family: Arial; padding: 40px; }
    h1 { font-size: 22px; }
    p, pre { font-size: 16px; line-height: 1.5; }
    pre { white-space: pre-wrap; }
    </style></head><body>
    <h1>Dispute Letter</h1>
    <p><strong>To:</strong> ${merchantName || 'Merchant'}</p>
    <p><strong>From:</strong> ${cardholderName || 'Cardholder'}</p>
    <hr/><pre>${letterText}</pre></body></html>
  `;

  pdf.create(htmlContent, { format: 'Letter' }).toBuffer((err, buffer) => {
    if (err) {
      console.error('PDF error:', err);
      return res.status(500).send('PDF generation failed');
    }
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename=dispute-letter.pdf',
      'Content-Length': buffer.length
    });
    res.send(buffer);
  });
});

app.use('/terms', express.static(path.join(__dirname, 'static')));

app.get('/openapi.yaml', (req, res) => {
  res.sendFile(path.join(__dirname, 'openapi.yaml'));
});
app.get('/.well-known/ai-plugin.json', (req, res) => {
  res.sendFile(path.join(__dirname, '.well-known/ai-plugin.json'));
});

module.exports = app;

const server = app.listen(port, () => {
  console.log(`✅ WinMyDispute API live on port ${port}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`⚠️ Port ${port} in use. Trying 3001...`);
    app.listen(3001, () => console.log('✅ API running on port 3001'));
  } else {
    console.error('❌ Server error:', err);
  }
});

