import { createServer, type IncomingHttpHeaders } from 'node:http';

export interface FixtureRequest {
  url: string;
  method?: string;
  headers: IncomingHttpHeaders;
  body: string;
}

export interface FixtureResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export const createFixtureTransport = (execute: (request: FixtureRequest) => Promise<FixtureResponse>) =>
  createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const pathname = request.url ?? '/';
      const service = pathname.split('/')[1];
      const origin =
        service === 'api' ? 'http://api:80' : service === 'postgrest' ? 'http://postgrest:3000' : 'http://source:8080';
      const payload: FixtureRequest = {
        url: origin + pathname.slice(service.length + 1),
        method: request.method,
        headers: request.headers,
        body: Buffer.concat(chunks).toString('base64'),
      };
      delete payload.headers.host;
      delete payload.headers.connection;
      payload.headers['x-forwarded-proto'] = 'https';
      const actual = await execute(payload);
      response.statusCode = actual.status;
      for (const [key, value] of Object.entries(actual.headers)) {
        if (!['content-encoding', 'transfer-encoding', 'content-length'].includes(key)) {
          response.setHeader(key, value);
        }
      }
      response.end(Buffer.from(actual.body, 'base64'));
    } catch (error) {
      console.error('Fixture transport request failed:', error);
      response.statusCode = 502;
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.end('Fixture transport request failed.');
    }
  });
