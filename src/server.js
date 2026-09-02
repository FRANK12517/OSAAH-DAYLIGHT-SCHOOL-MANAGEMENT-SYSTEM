import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { visibleSidebar } from './sidebar-registry.js';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/api/sidebar') return json(response, { categories: visibleSidebar({ permissions: new Set(['settings.read', 'users.read']) }) });
  if (pathname === '/api/branding') return json(response, { schoolName: 'OSAAH DAYLIGHT SCH. COM.', location: 'BOGOSO', motto: 'AIM HIGH, ACADEMIC IS OUR CORE VALUE', logoPath: '/assets/osaah-daylight-logo.png', colours: { navy: '#102a43', royalBlue: '#1769aa', gold: '#d4a72c', white: '#ffffff' } });
  const file = pathname === '/' ? '/index.html' : pathname;
  try { const body = await readFile(join(root, file)); response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' }); response.end(body); } catch { response.writeHead(404); response.end('Not found'); }
});
const port = Number(process.env.OSAAH_PORT || 3000);
if (process.argv[1] === fileURLToPath(import.meta.url)) server.listen(port, () => console.log(`OsaaH foundation listening on http://localhost:${port}`));
export { server };
function json(response, value) { response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); }
