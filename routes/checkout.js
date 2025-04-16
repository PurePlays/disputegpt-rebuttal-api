// routes/checkout.js
const express = require('express');
const router = express.Router();

router.get('/status', (req, res) => {
  res.status(200).send({ status: '✅ API OK', time: new Date().toISOString() });
});

router.get('/legal', (req, res) => {
  res.redirect('/terms');
});

module.exports = router;

