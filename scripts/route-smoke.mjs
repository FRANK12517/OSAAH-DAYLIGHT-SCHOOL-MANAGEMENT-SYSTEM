import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';
import { scryptSync } from 'node:crypto';
import { createAuthService } from '../src/auth.js';
import { createApp } from '../src/server.mjs';
import { SIDEBAR_MODULES, visibleSidebar } from '../src/sidebar-registry.js';
import '../src/module-registry.js';

const roles = ['ACCOUNTANT_BURSAR', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'TEACHER'];
const password = 'RouteSmoke123!';
const users = roles.map((roleKey) => ({
  id: `route-smoke-${roleKey.toLowerCase()}`,
  username: `${roleKey.toLowerCase()}@route-smoke.local`,
  passwordHash: `route-smoke-salt:${scryptSync(password, 'route-smoke-salt', 32).toString('hex')}`,
  roleKey,
  portal: 'school',
  schoolId: 'route-smoke-school',
  permissions: new Set(['*'])
}));
const auth = createAuthService({ users, sessionSecret: 'route-smoke-session-secret-0123456789012345' });
const server = createServer(createApp({ auth }));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const request = (path, token) => new Promise((resolve, reject) => {
  const req = httpRequest({ hostname: '127.0.0.1', port, path: `${path}?embedded=1&route=${encodeURIComponent(path)}`, headers: { Authorization: `Bearer ${token}` } }, (res) => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => resolve({ status: res.statusCode, body }));
  });
  req.on('error', reject);
  req.end();
});
try {
  let total = 0;
  let failures = 0;
  for (const roleKey of roles) {
    const login = auth.login({ username: `${roleKey.toLowerCase()}@route-smoke.local`, password, portal: 'school', role: roleKey });
    if (!login.ok) throw new Error(`${roleKey} smoke login failed: ${login.error}`);
    const modules = visibleSidebar({ modules: SIDEBAR_MODULES, permissions: new Set(['*']), roleKey, portal: 'school' })
      .flatMap((group) => group.modules.flatMap((module) => [module, ...(module.children ?? [])]))
      .filter((module) => !['dashboard', 'logout'].includes(module.moduleKey));
    for (const module of modules) {
      total += 1;
      const response = await request(module.route, login.token);
      const result = response.status === 200 && /<!doctype html>/i.test(response.body) ? 'PASS' : 'FAIL';
      if (result === 'FAIL') failures += 1;
      console.log(`${roleKey}\t${module.navigationKey}\t${module.route}\t${response.status}\t${result}`);
    }
  }
  console.log(`SUMMARY\ttotal=${total}\tfailures=${failures}`);
  if (failures) process.exitCode = 1;
} finally {
  await new Promise((resolve) => server.close(resolve));
}
