export const SIDEBAR_CATEGORIES = ['ADMINISTRATIVE', 'STUDENTS MANAGEMENT', 'ADMISSIONS', 'ACADEMICS', 'ATTENDANCE MANAGEMENT', 'EXAMINATIONS & RESULTS', 'FEE HUB', 'FINANCE', 'STAFF MANAGEMENT', 'COMMUNICATION HUB', 'LIBRARY MANAGEMENT', 'TRANSPORT MANAGEMENT', 'HOSTEL MANAGEMENT', 'HEALTH & WELFARE', 'INVENTORY & STORES', 'ASSETS & PROPERTY', 'PROCUREMENT', 'COMPLIANCE & DOCUMENTS', 'REPORTS & ANALYTICS', 'SYSTEM & SECURITY'];

export const SIDEBAR_MODULES = [
  { moduleKey: 'dashboard', moduleName: 'Dashboard', category: 'ADMINISTRATIVE', route: '/', icon: '⌂', displayOrder: 1, requiredPermission: null, roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'TEACHER', 'PARENT'] },
  { moduleKey: 'academics', moduleName: 'Academics', category: 'ACADEMICS', route: '/academics', icon: '▣', displayOrder: 1, requiredPermission: 'academics.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'TEACHER'] },
  { moduleKey: 'fees', moduleName: 'Fees', category: 'FEE HUB', route: '/fees', icon: '$', displayOrder: 1, requiredPermission: 'fees.read', roles: ['PROPRIETOR', 'ACCOUNTANT_BURSAR'] },
  { moduleKey: 'finance', moduleName: 'Finance', category: 'FINANCE', route: '/finance', icon: '₵', displayOrder: 1, requiredPermission: 'finance.read', roles: ['PROPRIETOR', 'ACCOUNTANT_BURSAR'] },
  { moduleKey: 'library', moduleName: 'Library', category: 'LIBRARY MANAGEMENT', route: '/library', icon: '▤', displayOrder: 1, requiredPermission: 'library.read', roles: ['PROPRIETOR', 'LIBRARIAN'] },
  { moduleKey: 'transport', moduleName: 'Transport', category: 'TRANSPORT MANAGEMENT', route: '/transport', icon: '▰', displayOrder: 1, requiredPermission: 'transport.read', roles: ['PROPRIETOR', 'TRANSPORT_MANAGER'] },
  { moduleKey: 'settings', moduleName: 'School Settings', category: 'SYSTEM & SECURITY', route: '/settings', icon: '⚙', displayOrder: 1, requiredPermission: 'settings.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN'] },
  { moduleKey: 'users', moduleName: 'Users & Roles', category: 'SYSTEM & SECURITY', route: '/users', icon: '◉', displayOrder: 2, requiredPermission: 'users.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN'] }
].map((module) => ({ ...module, enabled: true, parentModule: null }));

export function registerModule(module, modules = SIDEBAR_MODULES) { if (!module?.moduleKey || !module?.category) throw new Error('Module key and category are required'); const registered = { ...module, enabled: module.enabled ?? true, parentModule: module.parentModule ?? null }; modules.push(registered); return registered; }
export function visibleSidebar({ modules = SIDEBAR_MODULES, categories = SIDEBAR_CATEGORIES, permissions = new Set(), roleKey = null } = {}) {
  return categories.map((category) => ({ category, modules: modules.filter((module) => module.enabled && module.category === category && (!module.requiredPermission || permissions.has('*') || permissions.has(module.requiredPermission)) && (!module.roles?.length || !roleKey || module.roles.includes(roleKey) || roleKey === 'PROPRIETOR')).sort((a, b) => a.displayOrder - b.displayOrder) })).filter((group) => group.modules.length);
}
