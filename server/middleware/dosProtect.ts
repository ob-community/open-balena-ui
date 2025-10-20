const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');

const rateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 100,
});

const speedLimiter = slowDown({
  windowMs: 5 * 60 * 1000,
  delayAfter: 25,
  delayMs: (hits) => (hits - 25) * 100,
});

module.exports = [rateLimiter, speedLimiter];
