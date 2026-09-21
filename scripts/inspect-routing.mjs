import { SIDEBAR_MODULES, visibleSidebar, validateSidebarRegistry } from '../src/sidebar-registry.js';
import '../src/module-registry.js';

const roles = ['ACCOUNTANT_BURSAR', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'TEACHER'];
const permissions = new Set(['*']);
for (const roleKey of roles) {
  const groups = visibleSidebar({ modules: SIDEBAR_MODULES, permissions, roleKey, portal: 'school' });
  console.log(`\n## ${roleKey}`);
  for (const group of groups) {
    console.log(`[${group.category}]`);
    for (const module of group.modules) {
      console.log(`${module.moduleKey}\t${module.moduleName}\t${module.route}\t${module.requiredPermissions.join(',') || '-'}\t${module.allowedRoles.join(',') || '*'}`);
      for (const child of module.children ?? []) console.log(`${child.moduleKey}\t${child.moduleName}\t${child.route}\t${child.requiredPermissions.join(',') || '-'}\t${child.allowedRoles.join(',') || '*'}`);
    }
  }
}
console.log('\n## REGISTRY ERRORS');
console.log(JSON.stringify(validateSidebarRegistry(SIDEBAR_MODULES, { strictRoutes: true }), null, 2));
console.log('\n## ROUTE DUPLICATES');
const byRoute = new Map();
for (const module of SIDEBAR_MODULES) {
  if (!byRoute.has(module.route)) byRoute.set(module.route, []);
  byRoute.get(module.route).push(module.moduleKey);
}
for (const [route, keys] of byRoute) if (keys.length > 1) console.log(`${route}\t${keys.join(',')}`);
