import { SIDEBAR_MODULES } from '../sidebar-registry.js';
import '../module-registry.js';
import { ROLE_KEYS } from '../roles.js';
import { createAICapabilityRegistry } from './capability-registry.js';
import { discoverAICapabilityManifests } from './discovery.js';
import { createAIToolRegistry } from './tool-registry.js';

export async function buildAIRegistry(options = {}) {
  const knownModuleIds = new Set((options.modules ?? SIDEBAR_MODULES).map((module) => module.moduleId ?? module.moduleKey));
  const capabilityRegistry = createAICapabilityRegistry([], { knownModuleIds, knownRoleIds: ROLE_KEYS });
  const toolRegistry = createAIToolRegistry();
  const manifests = options.manifests ?? await discoverAICapabilityManifests(options.discovery);
  for (const manifest of manifests) {
    const registered = capabilityRegistry.register(manifest.capability);
    for (const tool of manifest.tools ?? []) {
      if (tool.capabilityId !== registered.id) throw new Error(`AI tool ${tool.name ?? tool.id} references the wrong capability`);
      const registeredTool = toolRegistry.register(tool);
      if (!registeredTool.requiredPermissions.every((permission) => registered.requiredPermissions.includes(permission))) throw new Error(`AI tool ${registeredTool.name} permission conflicts with capability ${registered.id}`);
    }
    for (const toolName of registered.tools) if (!toolRegistry.get(toolName)) throw new Error(`AI capability ${registered.id} references an unregistered tool: ${toolName}`);
  }
  return Object.freeze({ capabilities: capabilityRegistry, tools: toolRegistry });
}
