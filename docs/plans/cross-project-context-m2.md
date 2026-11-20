# Cross-project context and memory M2 implementation plan

**Goal:** Reuse the owner Feishu entry and Paperclip Native resources to manage registered projects, continue work, and recall confirmed background in new tasks and new model sessions on Mac mini.

**Architecture:** Native remains authoritative for task state, owner input versions, operations and runs. Deployment-owned project bindings select workspace, role/material scope and action ceilings. Private, partitioned knowledge files preserve owner-confirmed versions and source receipts; role preparation queries only the authorized partition before ranking records.

**Tech stack:** Existing JavaScript/Node core, existing pinned ARM64 Docker image, existing Paperclip 2026.1023.0 services, existing Feishu SDK. No new package or service.

## Source status — 2026-11-20

The initial M2 source/runtime contract suite passed **515/515 in local Docker** (`desktop-linux`, `logs/m2-full-first.log` and `.receipt.json`), with no failures or skips. This first full run predates the configuration helper and is not the final combined-tree count. Setup, documentation gates, upstream portable-role/Managed-instruction integration and its exact-tree review remain separately evidenced. **Mini activation and real M2 business acceptance are NOT_RUN.** The task checkboxes below describe source implementation, not deployment or real model success. Current commands and boundaries live in [cross-project context](../cross-project-context.md).

## Authority and isolation

The user explicitly authorized this M2 implementation and real Mac mini acceptance on 2026-11-20. Development task is `sa-m2-context-20261120-macbook-source`; parent checkout stays clean. Mini preflight/activation remains in the already authorized original remote chat. Other RWB stage and resource-retirement tasks retain their own authority.

Old completed roots and call ledgers are immutable. Incomplete-task continuation uses the same Native root and accumulated budget. A genuinely new owner goal after a completed task becomes a clearly linked new root; UNKNOWN, original-result corrections and failed-work retries cannot use that route to evade the old budget. No model or formal task is needed for a status query or project selection.

## File responsibility and public contracts

| Unit | Owned files | Contract |
| --- | --- | --- |
| Project catalog | `bridge/context-projects.mjs`, `tests/context-projects.test.mjs` | Validate deployment bindings, resolve keys/aliases and Native project IDs, narrow existing role profiles, reject unknown or conflicting scopes |
| Confirmed memory | `bridge/project-knowledge-store.mjs`, `tests/project-knowledge-store.test.mjs` | Authorized append/correct, immutable versions and source replay receipts, project/role partition query before ranking |
| Feishu/Native context | `bridge/chief-context-commands.mjs`, `bridge/chief-context-native.mjs`, associated tests | Typed project/status/append/continue/memory actions and same-owner chat/task association using existing Native transactions/activity |
| Existing entry/runtime | `chief-feishu-intake.mjs`, `chief-feishu-native.mjs`, `chief-feishu-service.mjs`, `team-context.mjs`, `team-native-runtime.mjs`, `native-role-runtime.mjs`, `role-preparation.mjs` | Feature-gated integration; preserve M1 input and old command namespaces; derive project/workspace/material/knowledge from trusted bindings |
| Execution boundary | `role-material-snapshot.mjs` and existing role transport/gate code | Each task sees only its registered project/role material and permitted workspace; no cross-project HOME/session projection |
| Docs/configuration | This plan, `docs/cross-project-context.md`, architecture, acceptance, development map, documentation governance map, `scripts/context-configure.mjs` and tests | Default preview, explicit apply, original-operation reconciliation and scoped rollback; retain workspace/material history and real IDs in private configuration |

Project catalog API:

```js
createProjectCatalog({registry, authority, log});
// registry: {schemaVersion:1, defaultProjectKey, projects:[
// {key, aliases, companyId, projectId, ownerId, adapterKey,
//  allowedRoles, maximumAction, workspaceCwd, projectWorkspaceId?}
// ]}
// authority: {companyId, ownerId, agentIds}; all projects must match it.
// workspaceCwd must match /paperclip/instances/default/projects/<company>/<project>/_default.
// adapterKey: native-docs or rwb-docs; maximumAction: read_only or pull_request.
catalog.list();
catalog.resolve({projectKeyOrAlias, projectId, companyId, ownerId});
catalog.forNativeTask(task, {ownerId});
catalog.roleBinding(roleRecord, project);
```

`roleBinding` keeps existing Agent IDs and material file identities, deriving only the validated project ID/key and manifest project discriminator. It cannot add a role, tool, home, deployment right or adapter callback. Project/action metadata alone is not execution authority.

The deployment registry uses `context={schemaVersion:1,enabled:true,catalog,materials,legacyKnowledge}`. When configured, `projectWorkspaceId` must match the actual Native task and is carried by roots, children, flows, operations and permits. No global `team.projectId` rewrite is allowed. Keep the personal project's implicit default when it has no workspace row; use a dedicated non-primary canonical M2 workspace for RWB, preserving its old primary and callback.

Knowledge API:

```js
createProjectKnowledgeStore({root, log, authorizeOwner, now});
// scope = {companyId, ownerId, projectId, projectKey}
// source = {messageId, chatId, bodySha256, eventId?, createdAt}
// source is taken only from the authenticated Feishu/Native operation.
await store.remember({scope, id, kind, visibility, role, text,
  condition, source, operationId});
await store.correct({scope, id, visibility, role, text, condition,
  expectedVersion, source, operationId});
store.query({scope, role, query, limit});
store.history({scope, id, visibility, role});
```

Writes require the deployment-provided `authorizeOwner` callback; no default grant is permitted. Output records retain the existing `selectRoleKnowledge` fields (`id/version/project/visibility/role/kind/source/condition/text`) and add confirmation provenance, digest and predecessor reference. `remember` creates version 1, `correct` checks the expected version and appends. Replayed same-source/same-body operations return their original receipt; changed source bindings conflict. Unknown local commit results retain recovery evidence rather than blindly incrementing a version.

The store partitions by owner/company/project and by project-shared versus private-role visibility before file reads. A query reads only the caller's project-shared and its own private-role partitions, then selects current versions and ranks them. Old records are retained. Logs contain codes, IDs, versions and digests, never memory text or credentials. Memory records never grant tool rights or replace Native task state.

New tasks query current owner-confirmed knowledge at the fixed `context/knowledge` root without importing another task's conversation history. Legacy files are read-only authorized project/role projections under `context/legacy`, marked historical-reference; M2 never reads global legacy knowledge. Before appending a legacy candidate, its authorized identity history must contain no confirmed version, even if the current confirmed record did not enter the top-32 query. Role materials use per-run read-only snapshots; cross-project fallback requires explicitly generic content. Portable role Skills, host capabilities and Native editable instruction working copies retain their own contracts.

## Task 1 — Catalog contract first

- [x] Write failing tests for two distinct projects, normalized aliases, owner/company mismatch, duplicate aliases/IDs, workspace substitution, optional workspace ID, unknown project, unsupported adapter/action, nonregistered role and immutable returned values.
- [x] Implement the catalog without reading or changing Native state.
- [x] Run focused local Docker tests and keep parent checkout unchanged.

## Task 2 — Knowledge contract first

- [x] Write failing tests for source authorization, create/replay/conflict, version-correct/history, stale expected version, immutable results, private-role/project filtering before reading, malformed/symlink/unsafe files, bounded data and unknown lock preservation.
- [x] Implement private atomic partition updates, durable replay receipt and bounded queries using Node core only.
- [x] Run focused local Docker tests. Production authorization is supplied by Task 3; unit stubs are not real owner acceptance.

## Task 3 — Native context and commands

- [x] Preserve `/chief <new goal>` and add projects/project/status/add/pause/continue/followup/new plus memory commands and Chinese aliases. Persist current project and each project's selected task without adding another listener; old command namespaces retain their original authority.
- [x] Reuse fixed-app/tenant/owner/private-chat checks and original message IDs/body digests. Persist command receipt and task/input-version association with Native activity/transactions; read current task state from Native.
- [x] Continue only a known same-owner/project task. Pending inputs apply only after known run settlement; preserve older artifacts and six-call budget. Reconcile existing dispatch before new admission. Ended blocked replanning requires at least three remaining calls; UNKNOWN never gets a new operation.
- [x] Always use a fresh model session for M2 continuation, reconstructing authorized original inputs and artifacts; never forge provider/lease/session identity. Reuse an unfinished same-input plan without another planning model call.
- [x] Wire owner memory confirmation/correction/share to authenticated source operations and scoped reads. Preserve legacy confirmation level; history/query are read-only. Optional plan-first pauses once; ordinary goals and continue after supplements add no approval step.
- [x] Permit only explicit followup of a done goal to create a linked new root without parentId; old ledgers remain immutable, and failed/UNKNOWN/correction work cannot escape its budget.

## Task 4 — Registered project execution

- [x] Replace fixed-project assumptions through intake, root authority, child dispatch, workspace, role preparation, knowledge selection and final notification binding, without changing global defaults.
- [x] Reuse existing 11 logical role identities. Keep QA independence, material hashes, role-private/project-shared visibility, root budgets and model/account constraints.
- [x] Bind RWB management to its dedicated registered Native workspace; do not call its legacy `onAccepted` queue or take over stage/production/old primary.
- [x] Verify per-run mount/home/snapshot isolation in local Docker filesystem fixtures; actual Mini mounts remain part of Task 6.

## Task 5 — Source gates

Use the repository's already locked image:

```sh
docker --context desktop-linux run --pull=never --rm --network none --read-only --tmpfs /tmp:rw,size=64m \
  -v "$PWD:/workspace:ro" -v "$PWD/logs:/logs" -w /workspace \
  -e SUPER_AGENT_LOG_ROOT=/logs \
  node@sha256:a52166d89cfcc66ea62d10535ca712d161cece5d77ff4cfa758866b6b75ccb3f \
  node --test tests/context-projects.test.mjs tests/project-knowledge-store.test.mjs
```

- [x] Run relevant new/context/runtime tests and first full local Docker regression: 515/515 before the configuration helper.
- [ ] Run the final combined candidate including configuration, upstream integration and baseline-aware documentation checks; do not reuse 515 as its final count.
- [ ] Independent exact-tree JavaScript review must inspect trust boundaries and the changed public contracts.
- [ ] Use existing managed prepare/PR/required CI/independent-review/merge/enforce gates. No RWB merge or deployment is part of this source delivery.

## Task 6 — Real Mini acceptance

- [ ] Recheck the existing receiver, actual projects/Agent bindings, source fingerprint, active work and leases before feature activation. Keep the previous binding recoverable.
- [ ] Preview then explicitly apply the scoped configuration request using the same stable operation. Preserve old registry/manifests and all source history; reconcile partial results rather than recreating resources. Setup/activation is currently NOT_RUN.
- [ ] With actual owner Feishu inputs, prove both registered real projects, same-task multi-turn/status/wait-resume, and a legitimate linked new goal without touching old ledgers.
- [ ] After an actual owner confirmation, finish A; create new formal B and a fresh model session with no A history/preloaded answer. Read the confirmed decision from scoped sources and cite its version.
- [ ] Owner corrects the decision; new Task C/new session adopts version 2, with old evidence retained.
- [ ] Run project-B isolation and explicit-share positive cases, recording raw filter/broker/transport evidence rather than model self-refusal.
- [ ] Replay the real source event by original identity for dedupe evidence; reconcile uncertain acceptance/provider/send outcomes before any further action.
- [ ] Record root/task/run/session/input/source/knowledge/artifact/notification identities and remaining NOT_RUN separately. Source, activation, business acceptance and resource retirement are distinct receipts.
