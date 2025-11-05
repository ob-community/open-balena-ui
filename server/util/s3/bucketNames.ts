import dotenv from 'dotenv';

dotenv.config();

const bucketNames = {
  registry: process.env.OPEN_BALENA_S3_REGISTRY_BUCKET ?? 'registry-data',
};

export default bucketNames;
