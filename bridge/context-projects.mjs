import { isDeepStrictEqual } from 'node:util';
import { ROLE_KEYS } from './role-labels.mjs';

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const key = /^[a-z][a-z0-9-]{0,47}$/;
const opaque = /^[A-Za-z0-9_-]{1,256}$/;
const alias = /^[\p{L}\p{N}_-]{1,64}$/u;
const adapterKeys = new Set(['native-docs', 'rwb-docs']);
const actions = new Set(['read_only', 'pull_request', 'merge']);
const projectFields = new Set(['key', 'aliases', 'companyId', 'projectId', 'ownerId',
  'adapterKey', 'allowedRoles', 'maximumAction', 'workspaceCwd', 'projectWorkspaceId']);
const fail = code => { throw Object.assign(new Error(code), {code}); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));

// Catalog inputs come from deployment-owned JSON, not a user message or a callback-bearing profile.
function jsonClone(value, code) {
  let count = 0;
  const visit = (entry, depth) => {
    if (++count > 20_000 || depth > 32) fail(code);
    if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') return;
    if (typeof entry === 'number' && Number.isFinite(entry)) return;
    if (!Array.isArray(entry) && !object(entry)) fail(code);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(entry))) {
      if (descriptor.get || descriptor.set) fail(code);
    }
    if (Array.isArray(entry)) {
      for (const child of entry) visit(child, depth + 1);
    } else {
      for (const child of Object.values(entry)) visit(child, depth + 1);
    }
  };
  visit(value, 0);
  return structuredClone(value);
}

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function emit(log, event) {
  try {
    const pending = log(Object.freeze(event));
    if (pending && typeof pending.then === 'function') {
      // This synchronous policy cannot grant scope before its audit finishes.
      // Report LOG_FAILED now; contain a later rejection without exposing logger details.
      Promise.resolve(pending).catch(() => undefined);
      fail('CONTEXT_PROJECT_LOG_FAILED');
    }
  }
  catch { fail('CONTEXT_PROJECT_LOG_FAILED'); }
}

function guarded(log, operation, fallback = 'CONTEXT_PROJECT_OPERATION_FAILED') {
  try { return operation(); }
  catch (error) {
    const code = /^CONTEXT_PROJECT_[A-Z_]+$/.test(error?.code ?? '') ? error.code : fallback;
    if (code !== 'CONTEXT_PROJECT_LOG_FAILED') emit(log, {code});
    fail(code);
  }
}

function normalizeAlias(value, code) {
  if (typeof value !== 'string' || value.length > 256) fail(code);
  const normalized = value.normalize('NFKC').trim().toLowerCase();
  if (!alias.test(normalized)) fail(code);
  return normalized;
}

/**
 * Pure deployment catalog with synchronous audit logging. It reads no Native state
 * and grants no execution rights.
 * Callers must authenticate an input and reread its Native task before resolving its scope.
 */
export function createProjectCatalog({registry, authority, log} = {}) {
  if (typeof log !== 'function') fail('CONTEXT_PROJECT_CONFIG_INVALID');
  return guarded(log, () => {
    const input = jsonClone(registry, 'CONTEXT_PROJECT_CONFIG_INVALID');
    const trusted = jsonClone(authority, 'CONTEXT_PROJECT_AUTHORITY_DENIED');
    if (!object(trusted) || !uuid.test(trusted.companyId ?? '') || !opaque.test(trusted.ownerId ?? '') ||
        !object(trusted.agentIds) || !Object.keys(trusted.agentIds).length ||
        Object.keys(trusted.agentIds).some(role => !ROLE_KEYS.includes(role)) ||
        Object.values(trusted.agentIds).some(id => !uuid.test(id ?? '')) ||
        new Set(Object.values(trusted.agentIds)).size !== Object.keys(trusted.agentIds).length) {
      fail('CONTEXT_PROJECT_AUTHORITY_DENIED');
    }
    if (!object(input) || input.schemaVersion !== 1 || !key.test(input.defaultProjectKey ?? '') ||
        !Array.isArray(input.projects) || !input.projects.length || input.projects.length > 128) {
      fail('CONTEXT_PROJECT_CONFIG_INVALID');
    }

    const byKey = new Map(), byId = new Map(), byAlias = new Map();
    const projects = input.projects.map(raw => {
      if (!object(raw) || Object.keys(raw).some(name => !projectFields.has(name)) ||
          !key.test(raw.key ?? '') || !uuid.test(raw.projectId ?? '')) fail('CONTEXT_PROJECT_CONFIG_INVALID');
      if (raw.companyId !== trusted.companyId || raw.ownerId !== trusted.ownerId) {
        fail('CONTEXT_PROJECT_AUTHORITY_DENIED');
      }
      if (byKey.has(raw.key) || byId.has(raw.projectId)) fail('CONTEXT_PROJECT_DUPLICATE');
      if (!adapterKeys.has(raw.adapterKey) || !actions.has(raw.maximumAction)) {
        fail('CONTEXT_PROJECT_ACTION_DENIED');
      }
      if (!Array.isArray(raw.allowedRoles) || !raw.allowedRoles.length ||
          new Set(raw.allowedRoles).size !== raw.allowedRoles.length ||
          raw.allowedRoles.some(role => !ROLE_KEYS.includes(role) || !Object.hasOwn(trusted.agentIds, role))) {
        fail('CONTEXT_PROJECT_ROLE_DENIED');
      }
      const workspaceCwd = `/paperclip/instances/default/projects/${trusted.companyId}/${raw.projectId}/_default`;
      if (raw.workspaceCwd !== workspaceCwd) fail('CONTEXT_PROJECT_WORKSPACE_DENIED');
      if (raw.projectWorkspaceId !== undefined &&
          (typeof raw.projectWorkspaceId !== 'string' || !uuid.test(raw.projectWorkspaceId))) {
        fail('CONTEXT_PROJECT_WORKSPACE_DENIED');
      }
      const suppliedAliases = raw.aliases === undefined ? [] : raw.aliases;
      if (!Array.isArray(suppliedAliases) || suppliedAliases.length > 32) fail('CONTEXT_PROJECT_CONFIG_INVALID');
      const aliases = [...new Set(suppliedAliases.map(value => normalizeAlias(value, 'CONTEXT_PROJECT_CONFIG_INVALID')))];
      const project = freeze({key:raw.key,aliases,companyId:trusted.companyId,projectId:raw.projectId,
        ownerId:trusted.ownerId,adapterKey:raw.adapterKey,allowedRoles:[...raw.allowedRoles],
        maximumAction:raw.maximumAction,workspaceCwd,
        ...(raw.projectWorkspaceId !== undefined && {projectWorkspaceId:raw.projectWorkspaceId})});
      for (const name of new Set([raw.key, ...aliases])) {
        if (byAlias.has(name)) fail('CONTEXT_PROJECT_ALIAS_CONFLICT');
        byAlias.set(name, project);
      }
      byKey.set(project.key, project);
      byId.set(project.projectId, project);
      return project;
    });
    if (!byKey.has(input.defaultProjectKey)) fail('CONTEXT_PROJECT_CONFIG_INVALID');
    const result = value => freeze(structuredClone(value));
    const assertCaller = value => {
      if (!object(value) || value.companyId !== trusted.companyId || value.ownerId !== trusted.ownerId) {
        fail('CONTEXT_PROJECT_CALLER_DENIED');
      }
    };
    const lookup = options => {
      assertCaller(options);
      let named, identified;
      if (options.projectKeyOrAlias !== undefined) {
        named = byAlias.get(normalizeAlias(options.projectKeyOrAlias, 'CONTEXT_PROJECT_SELECTOR_INVALID'));
        if (!named) fail('CONTEXT_PROJECT_UNKNOWN');
      }
      if (options.projectId !== undefined) {
        if (!uuid.test(options.projectId ?? '')) fail('CONTEXT_PROJECT_SELECTOR_INVALID');
        identified = byId.get(options.projectId);
        if (!identified) fail('CONTEXT_PROJECT_UNKNOWN');
      }
      if (named && identified && named.projectId !== identified.projectId) fail('CONTEXT_PROJECT_SELECTOR_CONFLICT');
      return named ?? identified ?? byKey.get(input.defaultProjectKey);
    };
    const resolve = options => guarded(log, () => {
      const project = lookup(options);
      emit(log, {code:'CONTEXT_PROJECT_RESOLVED',projectKey:project.key,projectId:project.projectId});
      return result(project);
    });

    const catalog = {
      list: () => guarded(log, () => {
        emit(log, {code:'CONTEXT_PROJECT_LISTED',projectCount:projects.length});
        return result(projects);
      }),
      resolve,
      forNativeTask: (task, actor) => guarded(log, () => {
        if (!object(actor) || actor.ownerId !== trusted.ownerId) fail('CONTEXT_PROJECT_CALLER_DENIED');
        if (!object(task) || !uuid.test(task.id ?? '') || !uuid.test(task.projectId ?? '') || task.companyId !== trusted.companyId ||
            task.responsibleUserId !== trusted.ownerId) fail('CONTEXT_PROJECT_NATIVE_SCOPE_DENIED');
        const project = lookup({companyId:task.companyId,ownerId:actor.ownerId,projectId:task.projectId});
        if (project.projectWorkspaceId !== undefined && task.projectWorkspaceId !== project.projectWorkspaceId) {
          fail('CONTEXT_PROJECT_NATIVE_WORKSPACE_DENIED');
        }
        emit(log, {code:'CONTEXT_PROJECT_NATIVE_RESOLVED',taskId:task.id,
          projectKey:project.key,projectId:project.projectId,
          ...(project.projectWorkspaceId !== undefined && {projectWorkspaceId:project.projectWorkspaceId})});
        return result(project);
      }),
      roleBinding: (roleRecord, selectedProject) => guarded(log, () => {
        const project = object(selectedProject) && byId.get(selectedProject.projectId);
        if (!project || !isDeepStrictEqual(project, selectedProject)) fail('CONTEXT_PROJECT_BINDING_DENIED');
        const record = jsonClone(roleRecord, 'CONTEXT_PROJECT_ROLE_RECORD_INVALID');
        const profile = record?.profile, manifest = record?.manifest;
        const originalProject = object(profile) && byId.get(profile.projectId);
        if (!object(record) || !object(profile) || !object(manifest) || !originalProject ||
            profile.projectKey !== originalProject.key || !ROLE_KEYS.includes(profile.role) ||
            trusted.agentIds[profile.role] !== profile.agentId || manifest.schemaVersion !== 1 ||
            manifest.project !== profile.projectKey || manifest.role !== profile.role ||
            !Array.isArray(manifest.files) || !manifest.files.length ||
            (profile.companyId !== undefined && profile.companyId !== trusted.companyId)) {
          fail('CONTEXT_PROJECT_ROLE_RECORD_INVALID');
        }
        if (!project.allowedRoles.includes(profile.role)) fail('CONTEXT_PROJECT_ROLE_DENIED');
        record.profile.projectId = project.projectId;
        record.profile.projectKey = project.key;
        record.manifest.project = project.key;
        emit(log, {code:'CONTEXT_PROJECT_ROLE_BOUND',projectKey:project.key,
          projectId:project.projectId,role:profile.role,agentId:profile.agentId});
        return freeze(record);
      }),
    };
    emit(log, {code:'CONTEXT_PROJECT_CATALOG_READY',projectCount:projects.length});
    return Object.freeze(catalog);
  }, 'CONTEXT_PROJECT_CONFIG_INVALID');
}
