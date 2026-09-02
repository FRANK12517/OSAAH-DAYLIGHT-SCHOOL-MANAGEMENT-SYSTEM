export const SIDEBAR_CATEGORIES = ['ADMINISTRATIVE', 'STUDENTS MANAGEMENT', 'ADMISSIONS', 'ACADEMICS', 'ATTENDANCE MANAGEMENT', 'EXAMINATIONS & RESULTS', 'FEE HUB', 'FINANCE', 'STAFF MANAGEMENT', 'COMMUNICATION HUB', 'LIBRARY MANAGEMENT', 'TRANSPORT MANAGEMENT', 'HOSTEL MANAGEMENT', 'HEALTH & WELFARE', 'INVENTORY & STORES', 'ASSETS & PROPERTY', 'PROCUREMENT', 'COMPLIANCE & DOCUMENTS', 'REPORTS & ANALYTICS', 'SYSTEM & SECURITY'];

export const SIDEBAR_MODULES = [
  { moduleKey: 'dashboard', moduleName: 'Dashboard', category: 'ADMINISTRATIVE', route: '/', icon: '⌂', displayOrder: 1, requiredPermission: null },
  { moduleKey: 'settings', moduleName: 'School Settings', category: 'SYSTEM & SECURITY', route: '/settings', icon: '⚙', displayOrder: 1, requiredPermission: 'settings.read' },
  { moduleKey: 'users', moduleName: 'Users & Roles', category: 'SYSTEM & SECURITY', route: '/users', icon: '◉', displayOrder: 2, requiredPermission: 'users.read' }
].map((module) => ({ ...module, enabled: true, parentModule: null }));

export function visibleSidebar({ modules = SIDEBAR_MODULES, categories = SIDEBAR_CATEGORIES, permissions = new Set() } = {}) {
  return categories.map((category) => ({ category, modules: modules.filter((module) => module.enabled && module.category === category && (!module.requiredPermission || permissions.has(module.requiredPermission))).sort((a, b) => a.displayOrder - b.displayOrder) })).filter((group) => group.modules.length);
}
