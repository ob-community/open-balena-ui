require('dotenv').config();

module.exports = {
  registry: process.env.OPEN_BALENA_S3_REGISTRY_BUCKET || 'registry-data',
};
