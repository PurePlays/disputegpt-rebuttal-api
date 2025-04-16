// routes/checkout.js — Final Plugin Router for WinMyDispute GPT
const express = require('express');
const router = express.Router();

const copyright = `© ${new Date().getFullYear()} PurePlays & Daniel Neville. All rights reserved.`;

// Plugin health check
router.get('/status', (req, res) => {
  res.status(200).json({ status: '✅ WinMyDispute API is operational.' });
});

// Legal / License metadata
router.get('/legal', (req, res) => {
  res.send(`
    <h3>Legal</h3>
    <p>${copyright}</p>
    <p>All rights reserved. Unauthorized use, reproduction, or redistribution is strictly prohibited.</p>
    <a href="/terms">View Full Terms</a>
  `);
});

module.exports = router;

