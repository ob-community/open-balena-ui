const jwt = require('njwt');

module.exports = (req, res, next) => {
  try {
    const token = req.headers.authorization.split('Bearer ')[1];
    jwt.verify(token, process.env.OPEN_BALENA_JWT_SECRET);
    next();
  } catch (err) {
    res.status(401).json({ success: false, message: 'Invalid token' });
    throw new Error('Unauthorized');
  }
};
