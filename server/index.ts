import express from 'express';
import dotenv from 'dotenv';
import path from 'node:path';
import registryImageRoutes from './routes/registryImage';

dotenv.config();

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = '0.0.0.0';
const CLIENT_DIR = 'dist/client';

const app = express();

app.use('/', registryImageRoutes);
app.use(express.static(CLIENT_DIR));
app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(process.cwd(), CLIENT_DIR, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Running open-balena-ui on http://${HOST}:${PORT}`);
});
