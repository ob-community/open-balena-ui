import { S3Client } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

dotenv.config();

const s3Url = process.env.OPEN_BALENA_S3_URL;
const accessKey = process.env.OPEN_BALENA_S3_ACCESS_KEY;
const secretKey = process.env.OPEN_BALENA_S3_SECRET_KEY;
const region = process.env.OPEN_BALENA_S3_REGION ?? 'us-east-1';

if (typeof s3Url !== 'string' || s3Url.length === 0) {
  throw new Error('OPEN_BALENA_S3_URL is not set in environment');
}

if (typeof accessKey !== 'string' || typeof secretKey !== 'string') {
  throw new Error('OPEN_BALENA_S3 access credentials are not set in environment');
}

const endpointUrl = new URL(s3Url);

const s3Client = new S3Client({
  endpoint: endpointUrl.toString(),
  region,
  credentials: {
    accessKeyId: accessKey,
    secretAccessKey: secretKey,
  },
  forcePathStyle: true,
});

export default s3Client;
