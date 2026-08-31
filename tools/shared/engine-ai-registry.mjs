import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const bundledRegistryPath = path.join(repoRoot, 'ai', 'registry.json');
const maxRegistryBytes = 256 * 1024;
const validClients = new Set(['cli', 'game_runtime', 'shell']);
const validSchemaTypes = new Set(['array', 'boolean', 'integer', 'number', 'object', 'string']);
const supportedCapabilities = new Set(['ai:providers', 'ai:usage', 'profile:live']);
const idPattern = /^[a-z][a-z0-9_.-]{0,127}$/;
const capabilityPattern = /^[a-z][a-z0-9_.:-]{0,127}$/;
const propertyPattern = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;

function requireString(value, fieldName) {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) {
    throw new Error(`AI registry ${fieldName} is invalid.`);
  }
  return value.trim();
}

function requireId(value, fieldName) {
  const id = requireString(value, fieldName);
  if (!idPattern.test(id)) {
    throw new Error(`AI registry ${fieldName} must use lowercase capability-style characters.`);
  }
  return id;
}

function requireCapability(value) {
  const capability = requireString(value, 'tool capability');
  if (!capabilityPattern.test(capability)) {
    throw new Error('AI registry tool capability is invalid.');
  }
  if (!supportedCapabilities.has(capability)) {
    throw new Error(`AI registry tool capability is not implemented: ${capability}`);
  }
  return capability;
}

function requireClients(value, fieldName) {
  if (!Array.isArray(value) || !value.length || value.length > validClients.size
      || value.some((client) => typeof client !== 'string' || !validClients.has(client))
      || new Set(value).size !== value.length) {
    throw new Error(`AI registry ${fieldName} must contain unique supported clients.`);
  }
  return [...value];
}

function requireReadOnlyPermission(value, fieldName) {
  if (value !== 'read_only') {
    throw new Error(`AI registry ${fieldName} must be read_only in this slice.`);
  }
  return value;
}

function requireObjectSchema(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || value.type !== 'object'
      || !value.properties || typeof value.properties !== 'object' || Array.isArray(value.properties)
      || !Array.isArray(value.required)
      || typeof value.additionalProperties !== 'boolean') {
    throw new Error(`AI registry ${fieldName} must be a bounded object schema.`);
  }
  const propertyNames = Object.keys(value.properties);
  if (propertyNames.length > 64
      || propertyNames.some((name) => !propertyPattern.test(name)
        || !value.properties[name] || typeof value.properties[name] !== 'object'
        || !validSchemaTypes.has(value.properties[name].type))
      || value.required.length > propertyNames.length
      || value.required.some((name) => !propertyNames.includes(name))
      || new Set(value.required).size !== value.required.length) {
    throw new Error(`AI registry ${fieldName} has invalid properties or required fields.`);
  }
  return structuredClone(value);
}

function normalizeTool(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.dryRun !== 'boolean') {
    throw new Error('AI registry tool entry is invalid.');
  }
  return {
    id: requireId(value.id, 'tool id'),
    label: requireString(value.label, 'tool label'),
    capability: requireCapability(value.capability),
    allowedClients: requireClients(value.allowedClients, 'tool allowedClients'),
    permission: requireReadOnlyPermission(value.permission, 'tool permission'),
    dryRun: value.dryRun,
    inputSchema: requireObjectSchema(value.inputSchema, 'tool inputSchema'),
    outputSchema: requireObjectSchema(value.outputSchema, 'tool outputSchema'),
  };
}

function normalizeSkill(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || !Array.isArray(value.toolIds) || !value.toolIds.length || value.toolIds.length > 16) {
    throw new Error('AI registry skill entry is invalid.');
  }
  const toolIds = value.toolIds.map((toolId) => requireId(toolId, 'skill tool id'));
  if (new Set(toolIds).size !== toolIds.length) {
    throw new Error('AI registry skill toolIds must be unique.');
  }
  return {
    id: requireId(value.id, 'skill id'),
    label: requireString(value.label, 'skill label'),
    toolIds,
    allowedClients: requireClients(value.allowedClients, 'skill allowedClients'),
    permission: requireReadOnlyPermission(value.permission, 'skill permission'),
  };
}

async function readRegistry(filePath) {
  const stats = await fs.stat(filePath);
  if (!stats.isFile() || stats.size > maxRegistryBytes) {
    throw new Error(`AI registry must be a file no larger than ${maxRegistryBytes} bytes.`);
  }
  const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
  if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.tools) || !Array.isArray(parsed.skills)
      || parsed.tools.length > 128 || parsed.skills.length > 64) {
    throw new Error('AI registry must use schemaVersion 1 with bounded tools and skills arrays.');
  }
  const tools = parsed.tools.map(normalizeTool);
  const skills = parsed.skills.map(normalizeSkill);
  if (new Set(tools.map((tool) => tool.id)).size !== tools.length
      || new Set(skills.map((skill) => skill.id)).size !== skills.length) {
    throw new Error('AI registry tool and skill IDs must be unique within their collections.');
  }
  const toolsById = new Map(tools.map((tool) => [tool.id, tool]));
  for (const skill of skills) {
    for (const toolId of skill.toolIds) {
      const tool = toolsById.get(toolId);
      if (!tool) {
        throw new Error(`AI registry skill ${skill.id} references unknown tool ${toolId}.`);
      }
      if (skill.allowedClients.some((client) => !tool.allowedClients.includes(client))) {
        throw new Error(`AI registry skill ${skill.id} widens the clients allowed by tool ${toolId}.`);
      }
    }
  }
  return { tools, skills };
}

export async function inspectAiRegistry(rootPath) {
  const resolvedRoot = path.resolve(rootPath || repoRoot);
  const workspacePath = path.join(resolvedRoot, 'ai', 'registry.json');
  let configPath = workspacePath;
  let configSource = 'workspace';
  try {
    await fs.access(workspacePath);
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') {
      throw error;
    }
    configPath = bundledRegistryPath;
    configSource = 'bundled';
  }
  const registry = await readRegistry(configPath);
  return {
    rootPath: resolvedRoot,
    configPath,
    configSource,
    toolCount: registry.tools.length,
    skillCount: registry.skills.length,
    ...registry,
  };
}

function matchesSchemaType(value, type) {
  if (type === 'array') return Array.isArray(value);
  if (type === 'integer') return Number.isSafeInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'object') return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  return typeof value === type;
}

export function validateAiRegistryValue(schema, value, fieldName) {
  if (!matchesSchemaType(value, schema.type)) {
    throw new Error(`${fieldName} must be an object.`);
  }
  for (const requiredName of schema.required) {
    if (!Object.hasOwn(value, requiredName)) {
      throw new Error(`${fieldName} is missing required field ${requiredName}.`);
    }
  }
  for (const [name, propertyValue] of Object.entries(value)) {
    const propertySchema = schema.properties[name];
    if (!propertySchema) {
      if (!schema.additionalProperties) {
        throw new Error(`${fieldName} contains unknown field ${name}.`);
      }
      continue;
    }
    if (!matchesSchemaType(propertyValue, propertySchema.type)) {
      throw new Error(`${fieldName}.${name} must be ${propertySchema.type}.`);
    }
  }
  return value;
}
