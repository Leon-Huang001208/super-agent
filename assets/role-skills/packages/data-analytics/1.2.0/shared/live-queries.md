# Live queries on Sites

The Data template owns charts, loading/error states, Refresh and query observation. The Sites plugin owns connector discovery, declarations, visitor consent, runtime bindings and deployment. A small server adapter translates one source into the shared result contract.

For local artifacts or another hosting platform, follow destination and data mode selection (optional unbundled reference: `../output_formats/html/README.md#choose-how-to-publish`; load its workflow only if separately available); missing Sites does not block those supported paths.

## Check compatibility before building

Read the **loaded** Sites skill and its relevant references and follow their current instructions for connected plugins. Check Sites eligibility for the source connector and follow the publication choices (optional unbundled reference: `../output_formats/html/README.md#choose-how-to-publish`; load its workflow only if separately available) for the returned status. Reuse verified query bindings prepared during local authoring. Before publishing a connected Site, confirm connector discovery, manifest declarations, request-scoped invocation and the required action policy. Check capabilities, not a feature name, version number or fixed reference filename. If the loaded instructions or runtime do not support viewer-authorized connector access, report the missing capability; do not copy an old dashboard's bindings, release IDs or preview authority into a new build.

Verify these integration requirements against the loaded Sites contract before authoring:

- Resolve the catalog plugin ID, connector membership and current Sites publishing eligibility separately. Obtain the exact `connectorId`, canonical `actionName` and input schema from authoritative tool metadata exposed by the supported discovery surface. Preserve them unchanged in the server adapter; validate fixed arguments against that schema. A display name or callable chat-tool name is not the contract. Do not remove a guessed plugin prefix or split on underscores.
- For a single-connector plugin, match its catalog ID from `search_plugins` to the allowed Sites entry and the connector used for the source read. When the catalog lists the action in `tool_names`, use that exact name with the corresponding native tool’s input schema. If multiple connectors or actions could match, require connector-specific metadata.
- Check that the available tools actually expose that metadata. Plugin search and eligibility alone do not supply action schemas. `getContext()` reads the visitor's existing catalog cache and can return `tools: null`; it neither fills a cold cache nor proves current authorization. You may ask the user to choose a data mode once connector eligibility is confirmed, but if discovery is incomplete, report the missing metadata before building a live binding. Do not invent a discovery tool or treat fixture constants as provider discovery.
- Preserve the Site manifest and declare `plugins: [{ id, connector_ids }]` plus `connectors: [{ id, action_selection_mode }]`. `read_only` is the default; `all` requests connector-wide read/write access. Custom action allowlists are unsupported.
- Direct Workers use the current request's `context.props.CONNECTORS`. Vinext uses Sites' request-context helper. The Data Worker is a direct Worker; do not import Vinext helpers into it.
- Write-classified operations require the platform's write policy and visitor consent. The alpha guide defaults writes to an explicit visitor click. A SELECT-only query can still use a write-classified submission action. Honor an explicit user request for automatic SELECT-only analytics where the runtime policy permits it, preserving the real classification and consent. That instruction overrides the authoring default, never platform authorization. Do not apply it to business mutations.
- Preview reads use the agent's connection. They do not prove hosted viewer access. Completion events available to an agent do not imply published-Site subscriptions.

Keep live rows out of published assets, D1, R2 and browser persistence. Follow the main live-refresh contract for loading, access errors and reconnect navigation. Keep the existing Schedule refresh menu and dialog. Follow the live-data branch of `skills/schedule-refresh-jobs/SKILL.md`; a scheduled job cannot reuse a visitor's browser binding or populate a shared result snapshot.

## Two adapter shapes

A fast source can keep the existing default async function: return a completed `{ generatedAt, updates }` response or the Sites failure envelope.

For an asynchronous source, export one self-contained object from `src/content/server/refresh.mjs`:

```js
export default {
  async start({ queryId, context }) {
    // Validate queryId; submit fixed server-owned source arguments once.
    // Return completed rows immediately if the source already finished.
    return { status: "pending", continuation: jobId };
  },
  async check({ queryId, continuation, context }) {
    // Use THIS request's connection to check that exact job.
    // Translate the provider's status and validate ownership/result identity.
    if (!completed) return { status: "pending", continuation, pollAfterMs: 2000 };
    const executedAt = new Date().toISOString();
    return { generatedAt: executedAt,
      updates: [{ queryId, rows, executedAt }] };
  },
};
```

This is an interface sketch, not executable provider code. Discover the actual actions. Keep query IDs, SQL, targets and arguments server-owned; check that results belong to the submitted job. Return exactly the requested query, at most 10,000 object rows and the declared columns. Submission success is not completed data. Preserve provider failure status, request ID and retry delay; never turn a failure into pending or an empty result.

The adapter's continuation is a bounded string containing only a job reference, never credentials, invocation bindings, raw rows or sensitive query text. Configure a fresh 32-byte random `DATA_APP_CONTINUATION_SECRET` using Sites `update_environment_variables` with `is_secret: true` before testing; never put it in source, browser code or logs. Follow the environment tool's returned instructions. Regional Sites expose this setting through `await env.SECRET_DATA_APP_CONTINUATION_SECRET.get()`; other Sites use the direct value. The runtime reads it on every request and never falls back when a regional binding is present but unavailable. The publisher fingerprints the adapter automatically. The runtime signs the job reference for the authenticated viewer, Site origin, query ID and adapter revision. Tokens expire after 15 minutes without extension. A token identifies work; every check still uses the current request's authorization.

## Waiting without wasted delay

The browser submits once, then checks serially. Charts sharing a query share its in-flight work. Separate queries retain their independent card states and existing concurrency limit.

The fallback cadence starts at one second and gradually backs off to five seconds. Request duration counts toward that interval, with a 250 ms minimum pause; there is no extra fixed three-second sleep after a slow call. An adapter's `pollAfterMs` sets its preferred start-to-start cadence. `retryAfterMs` is a minimum delay **after** the response and is never shortened. Use the provider's documented limits; do not assume faster polling makes the underlying query faster.

Only an explicit pending result advances observation. Errors, malformed responses, departure, deadline or exhausted checks stop it. An uncertain submission is never replayed automatically. Do not nest provider polling waits inside the browser loop. Use completion signals only when the loaded Sites contract explicitly supports them.

## Measure and verify

DevTools Performance entries named `data-app:refresh` report request count, request time, polling wait and total time. Refresh responses include `Server-Timing: adapter;dur=...`. Neither includes query text, rows, tokens or viewer identity. These measurements do not separate warehouse execution from connector overhead. Use source-provided execution timestamps when available and label result-confirmation time honestly.

After a fresh build, verify hosted automatic visit and normal Refresh on the same deployment, native per-card skeletons, fresh completed execution, and a differently authorized viewer. Compare timings before claiming a speedup. Record the loaded Data/Sites versions and any delivery or authorization blocker. A local fixture or repaired old Site is not an instructions-only fresh-build pass.
