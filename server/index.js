import express from 'express';
import cors from 'cors';
import { scanRouter } from './routes/scan.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.use('/api/scan', scanRouter);

const server = app.listen(PORT, () => {
  console.log(`LeanFetch server running on port ${PORT}`);
});

server.setTimeout(1_800_000);        // 30 minutes — large repo scans can take 10-20 min
server.keepAliveTimeout = 1_800_000;
server.headersTimeout = 1_860_000;   // must exceed keepAliveTimeout per Node.js docs
