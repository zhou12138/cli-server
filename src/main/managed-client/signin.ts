import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { shell } from 'electron';

const DEFAULT_SIGNIN_PAGE_URL = 'http://localhost:3000/desktop-signin';
const CALLBACK_PATH = '/managed-client/signin/callback';
const CALLBACK_HOST = '127.0.0.1';
const SIGNIN_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_SIGNIN_PAGE_PATH = '/desktop-signin';

interface SigninCallbackPayload {
  token?: unknown;
  nonce?: unknown;
}

export interface ManagedClientSigninResult {
  token: string;
  signinUrl: string;
}

function normalizeSigninPageUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    if (url.hostname === '127.0.0.1' || url.hostname === '0.0.0.0' || url.hostname === '::1') {
      url.hostname = 'localhost';
    }
  }

  if (url.pathname === '' || url.pathname === '/') {
    url.pathname = DEFAULT_SIGNIN_PAGE_PATH;
  }

  return url.toString();
}

function getSigninPageUrl(signinPageUrl?: string | null, baseUrl?: string | null): string {
  const configuredUrl = signinPageUrl?.trim();
  if (configuredUrl) {
    return normalizeSigninPageUrl(configuredUrl);
  }

  const fallbackBaseUrl = baseUrl?.trim();
  if (fallbackBaseUrl) {
    return normalizeSigninPageUrl(fallbackBaseUrl);
  }

  return DEFAULT_SIGNIN_PAGE_URL;
}

function setCorsHeaders(request: IncomingMessage, response: ServerResponse): void {
  const origin = request.headers.origin;
  response.setHeader('Access-Control-Allow-Origin', typeof origin === 'string' && origin ? origin : '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  const requestedHeaders = request.headers['access-control-request-headers'];
  response.setHeader('Access-Control-Allow-Headers', typeof requestedHeaders === 'string' && requestedHeaders ? requestedHeaders : 'Content-Type');
  if (request.headers['access-control-request-private-network'] === 'true') {
    response.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  response.setHeader('Vary', 'Origin, Access-Control-Request-Headers, Access-Control-Request-Private-Network');
  response.setHeader('Cache-Control', 'no-store');
}

function writeJson(request: IncomingMessage, response: ServerResponse, statusCode: number, body: Record<string, unknown>): void {
  setCorsHeaders(request, response);
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

function writeHtml(response: ServerResponse, statusCode: number, title: string, message: string): void {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { font-family: Segoe UI, Arial, sans-serif; background: #020617; color: #e2e8f0; margin: 0; }
      main { max-width: 640px; margin: 10vh auto; padding: 24px; border: 1px solid #334155; border-radius: 16px; background: rgba(15, 23, 42, 0.95); }
      h1 { margin-top: 0; font-size: 20px; }
      p { line-height: 1.6; color: #cbd5e1; }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${message}</p>
    </main>
  </body>
</html>`);
}

function expectsHtml(request: IncomingMessage): boolean {
  const contentType = request.headers['content-type'];
  if (typeof contentType === 'string' && contentType.includes('application/x-www-form-urlencoded')) {
    return true;
  }

  const accept = request.headers.accept;
  return typeof accept === 'string' && accept.includes('text/html');
}

function readCallbackBody(request: IncomingMessage): Promise<SigninCallbackPayload> {
  return new Promise((resolve, reject) => {
    let body = '';

    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('Signin callback payload is too large'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        const contentType = request.headers['content-type'];
        if (typeof contentType === 'string' && contentType.includes('application/x-www-form-urlencoded')) {
          const form = new URLSearchParams(body);
          resolve({
            token: form.get('token') ?? undefined,
            nonce: form.get('nonce') ?? undefined,
          });
          return;
        }

        resolve(body ? (JSON.parse(body) as SigninCallbackPayload) : {});
      } catch {
        reject(new Error('Signin callback payload must be valid JSON or form data'));
      }
    });
    request.on('error', reject);
  });
}

export async function startManagedClientSignin(options?: {
  signinPageUrl?: string | null;
  baseUrl?: string | null;
}): Promise<ManagedClientSigninResult> {
  const nonce = randomUUID();

  let settled = false;
  let timeoutHandle: NodeJS.Timeout | null = null;

  const result = await new Promise<ManagedClientSigninResult>((resolve, reject) => {
    const cleanup = (server: ReturnType<typeof createServer>): void => {
      if (settled) {
        return;
      }

      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }

      server.close();
    };

    const server = createServer(async (request, response) => {
      const url = new URL(request.url ?? '/', `http://${CALLBACK_HOST}`);

      if (request.method === 'OPTIONS') {
        setCorsHeaders(request, response);
        response.statusCode = 204;
        response.end();
        return;
      }

      if (url.pathname !== CALLBACK_PATH) {
        writeJson(request, response, 404, { error: 'Not found' });
        return;
      }

      if (request.method !== 'POST') {
        writeJson(request, response, 405, { error: 'Method not allowed' });
        return;
      }

      try {
        const payload = await readCallbackBody(request);
        const token = typeof payload.token === 'string' ? payload.token.trim() : '';
        const payloadNonce = typeof payload.nonce === 'string' ? payload.nonce.trim() : '';

        console.log('[managed-client signin] Received callback request', {
          path: url.pathname,
          hasToken: Boolean(token),
          nonceMatches: payloadNonce === nonce,
        });

        if (!token) {
          if (expectsHtml(request)) {
            writeHtml(response, 400, 'Desktop sign-in failed', 'Token is required. Return to the desktop app and try the sign-in flow again.');
          } else {
            writeJson(request, response, 400, { error: 'Token is required' });
          }
          return;
        }

        if (payloadNonce !== nonce) {
          if (expectsHtml(request)) {
            writeHtml(response, 400, 'Desktop sign-in failed', 'The desktop sign-in nonce did not match. Restart the sign-in flow from the desktop app.');
          } else {
            writeJson(request, response, 400, { error: 'Invalid signin nonce' });
          }
          return;
        }

        if (expectsHtml(request)) {
          writeHtml(response, 200, 'Desktop sign-in complete', 'The access token has been returned to the desktop app. You can close this browser tab and return to the desktop client.');
        } else {
          writeJson(request, response, 200, { ok: true });
        }
        cleanup(server);
        resolve({
          token,
          signinUrl,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid signin callback payload';
        if (expectsHtml(request)) {
          writeHtml(response, 400, 'Desktop sign-in failed', message);
        } else {
          writeJson(request, response, 400, { error: message });
        }
      }
    });

    server.once('error', (error) => {
      cleanup(server);
      reject(error);
    });

    let signinUrl = '';

    server.listen(0, CALLBACK_HOST, async () => {
      try {
        const address = server.address() as AddressInfo | null;
        if (!address) {
          throw new Error('Failed to allocate a local signin callback port');
        }

        const callbackUrl = `http://${CALLBACK_HOST}:${address.port}${CALLBACK_PATH}`;
        const browserUrl = new URL(getSigninPageUrl(options?.signinPageUrl, options?.baseUrl));
        browserUrl.searchParams.set('callback_url', callbackUrl);
        browserUrl.searchParams.set('nonce', nonce);
        signinUrl = browserUrl.toString();

        console.log('[managed-client signin] Waiting for browser callback', {
          callbackUrl,
          signinUrl,
        });

        timeoutHandle = setTimeout(() => {
          cleanup(server);
          reject(new Error('Signin timed out before the browser returned an access token'));
        }, SIGNIN_TIMEOUT_MS);

        await shell.openExternal(signinUrl);
      } catch (error) {
        cleanup(server);
        reject(error);
      }
    });
  });

  return result;
}