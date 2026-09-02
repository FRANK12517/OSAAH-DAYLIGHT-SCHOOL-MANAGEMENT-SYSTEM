# Sidebar Registry Guide

ALL NEW USER-FACING SCHOOL PORTAL MODULES MUST BE REGISTERED THROUGH THE SIDEBAR MODULE REGISTRY. NEVER MANUALLY ADD A NEW MODULE TO THE SIDEBAR.

## Registering a module

Import `registerFutureModule` from `src/sidebar-classification.js` and register the component metadata during module initialization:

```js
registerFutureModule({
  module_key: 'students.scholarships',
  module_name: 'Student Scholarships',
  feature_domain: 'fee_hub',
  route: '/fee-hub/scholarships',
  permissions: ['students.scholarships.view', 'students.scholarships.edit'],
  mobile_enabled: true
});
```

Do not edit `public/app.js` to add a navigation item. The existing dashboard, desktop sidebar, mobile drawer, and responsive navigation consume `/api/sidebar`, which is generated from the same registry.

## Classification and placement

`feature_domain` is the preferred category override and must be one of the stable canonical category IDs. If it is omitted, the classifier uses the module key, name, route, and description with deterministic rules. A parent module is inherited when an existing registry module matches the category. Explicit `parent_module_key` always takes precedence.

New modules receive a stable priority after the existing parent or sibling group unless `priority` or `display_order` is intentionally supplied. Category order is never controlled by an individual module.

Unknown or ambiguous modules are marked `UNCLASSIFIED`. `registerFutureModule` blocks them in production until an authorized developer supplies an explicit valid domain or confirms the classification.

## Permissions and roles

Every future module receives a view permission automatically when `permissions` is omitted. The generated permission is `<module_key>.view`. Category role suggestions are metadata for review; they do not grant access. Server-side RBAC, school isolation, feature enablement, and subscription checks remain authoritative.

## Mobile, breadcrumbs, and titles

Set `mobile_enabled` and `desktop_enabled` in metadata when a module has interface-specific availability. The registry drives both surfaces. Use `buildBreadcrumb(route)` and `modulePageMetadata(route)` for breadcrumb, page title, tooltip, and accessibility metadata instead of hard-coded future navigation labels.

## Testing a module

Test classification, parent placement, generated permissions, mobile and desktop visibility, feature enablement, and a protected direct route. Run `npm test`. Administrators can inspect `/api/sidebar/health` with the required system permission to review duplicate, orphan, unclassified, invalid-route, permission, disabled-module, and mobile-navigation diagnostics.
