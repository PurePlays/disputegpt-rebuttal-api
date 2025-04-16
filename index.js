const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const pdf = require('html-pdf'); // Make sure this is installed

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());

// Example existing endpoint
app.get('/', (req, res) => {
  res.send('WinMyDispute GPT API is running.');
});

// Your other endpoints (e.g. getRebuttalStrategy, generateCfpbComplaintSummary, etc.)
// Keep them here 👇 and unchanged

// ✅ NEW: Dispute Letter PDF Download Endpoint
app.post('/letter/download', (req, res) => {
  const { letterText, cardholderName, merchantName } = req.body;

  if (!letterText) {
    return res.status(400).send('Missing letter text');
  }

  const htmlContent = `
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; padding: 40px; }
          h1 { font-size: 22px; margin-bottom: 20px; }
          p, pre { font-size: 16px; line-height: 1.5; }
          pre { white-space: pre-wrap; }
        </style>
      </head>
      <body>
        <h1>Dispute Letter</h1>
        <p><strong>To:</strong> ${merchantName || 'Merchant'}</p>
        <p><strong>From:</strong> ${cardholderName || 'Cardholder'}</p>
        <hr/>
        <pre>${letterText}</pre>
      </body>
    </html>
  `;

  const options = { format: 'Letter' };

  pdf.create(htmlContent, options).toBuffer((err, buffer) => {
    if (err) {
      console.error('PDF generation error:', err);
      return res.status(500).send('Failed to generate PDF');
    }

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename=dispute-letter.pdf',
      'Content-Length': buffer.length,
    });

    res.send(buffer);
  });
});

app.listen(port, () => {
  console.log(`WinMyDispute API running on port ${port}`);
});
