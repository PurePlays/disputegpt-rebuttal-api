const express = require('express');

const router = express.Router();

router.get('/status', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'disputegpt-rebuttal-api', time: new Date().toISOString() });
});

router.get('/legal', (_req, res) => {
  res.redirect('/terms');
});

module.exports = router;
