import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { visibleSidebar } from './sidebar-registry.js';
import { canAccess, createAuthService } from './auth.js';
import { createAuditLog } from './audit.js';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
const branding = { schoolName: 'OSAAH DAYLIGHT SCH. COM.', location: 'BOGOSO', motto: 'AIM HIGH, ACADEMIC IS OUR CORE VALUE', logoPath: '/assets/osaah-daylight-logo.png', colours: { navy: '#102a43', royalBlue: '#1769aa', gold: '#d4a72c', white: '#ffffff' } };

export function createApp({ auth = createAuthService(), audit = () => {} } = {}) {
  return async function handle(request, response) {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/api/branding') return json(response, branding);
    if (pathname === '/api/auth/login' && request.method === 'POST') return login(request, response, auth);
    if (pathname === '/api/auth/logout' && request.method === 'POST') { auth.logout(readCookie(request, 'osaah_session')); return json(response, { ok: true }, 204); }
    if (pathname === '/api/auth/password-reset' && request.method === 'POST') { const body = await readJson(request); return json(response, auth.requestPasswordReset(body.username ?? '')); }
    if (pathname === '/api/auth/password-reset/complete' && request.method === 'POST') { const body = await readJson(request); const result = auth.completePasswordReset(body.token ?? '', body.newPassword ?? ''); return json(response, result, result.ok ? 200 : 400); }
    if (pathname.startsWith('/api/')) {
      const user = auth.authenticate(readCookie(request, 'osaah_session') ?? bearer(request));
      if (!user) return json(response, { error: 'Authentication required.' }, 401);
      if (pathname === '/api/sidebar') return json(response, { user: publicUser(user), categories: visibleSidebar({ permissions: user.permissions, roleKey: user.roleKey }) });
      if (pathname === '/api/parent/children') { if (user.portal !== 'parent' || !canAccess(user, 'children.read')) return json(response, { error: 'Forbidden.' }, 403); return json(response, { children: user.children }); }
      if (pathname === '/api/management') { if (!canAccess(user, 'users.read')) return json(response, { error: 'Forbidden.' }, 403); audit(createAuditLog({ schoolId: user.schoolId, userId: user.id, action: 'ACCESS', entity: 'ManagementDashboard' })); return json(response, { authorized: true, schoolId: user.schoolId }); }
      return json(response, { error: 'Not found.' }, 404);
    }
    const file = pathname === '/' ? '/index.html' : pathname;
    try { const body = await readFile(join(root, file)); response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' }); response.end(body); } catch { response.writeHead(404); response.end('Not found'); }
  };
}
const server = createServer(createApp());
const port = Number(process.env.OSAAH_PORT || 3000);
if (process.argv[1] === fileURLToPath(import.meta.url)) server.listen(port, () => console.log(`OsaaH foundation listening on http://localhost:${port}`));
export { server };
function publicUser(user) { return { id: user.id, username: user.username, portal: user.portal, roleKey: user.roleKey, schoolId: user.schoolId, children: user.children ?? [] }; }
async function login(request, response, auth) { const body = await readJson(request); const result = auth.login(body); if (!result.ok) return json(response, { error: result.error }, result.status); return json(response, { user: result.user, expiresAt: result.expiresAt }, 200, `osaah_session=${result.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(auth.sessionTtlMs / 1000)}`); }
function readCookie(request, name) { return (request.headers.cookie ?? '').split(';').map((part) => part.trim().split('=')).find(([key]) => key === name)?.[1]; }
function bearer(request) { const value = request.headers.authorization ?? ''; return value.startsWith('Bearer ') ? value.slice(7) : null; }
function readJson(request) { return new Promise((resolve, reject) => { let data = ''; request.on('data', (chunk) => { data += chunk; if (data.length > 100_000) request.destroy(); }); request.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('Invalid JSON')); } }); }); }
function json(response, value, status = 200, cookie) { const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }; if (cookie) headers['Set-Cookie'] = cookie; response.writeHead(status, headers); response.end(status === 204 ? '' : JSON.stringify(value)); }
