const Minio = require('minio');
require('dotenv').config();

if (!process.env.OPEN_BALENA_S3_URL || typeof process.env.OPEN_BALENA_S3_URL !== 'string') {
  throw new Error('OPEN_BALENA_S3_URL is not set in environment');
}

module.exports = new Minio.Client({
  endPoint: process.env.OPEN_BALENA_S3_URL.split('://')[1],
  useSSL: !!process.env.OPEN_BALENA_S3_URL.includes('https'),
  accessKey: process.env.OPEN_BALENA_S3_ACCESS_KEY,
  secretKey: process.env.OPEN_BALENA_S3_SECRET_KEY,
});
