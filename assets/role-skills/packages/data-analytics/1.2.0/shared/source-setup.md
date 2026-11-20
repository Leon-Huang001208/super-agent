# Source setup and access recovery

Read this when a concrete source gap warrants an integration offer, the user chooses **Connect my data**, or required access is pending, unavailable, or failing. Routine work with sufficient sources uses the [initial dependency check](source-selection.md#initial-dependency-check) without loading this guide. Source authority and supported-evidence decisions stay in the [shared instructions](source-selection.md#find-the-authoritative-source).

## Native connection controls

Use Plugin Management `suggest_plugins` for provider selection, installation, and sign-in. Collect exact eligible IDs or supported marketplace references, then pass the selected set in one `plugin_ids` array. Do not put a provider questionnaire in front of **Connect my data** or recreate connection cards in Visualize. Analysis intake may still ask which existing dataset or file is intended under [task intake](task-intake.md).

The host owns grouped cards and their connection states. Do not fabricate server-authored `onboarding_plugin_suggestions` or `onboarding_starter_tasks` widgets, flow identifiers, experiment arms, or connection states. A suggestion, completed installation, and verified source access are distinct; none grants permission to send, share, publish, or change a source.

Onboarding owns its ten-option ranking and browse-or-ask guidance (optional unbundled reference: `../skills/onboarding/SKILL.md#connect-my-data`; load its workflow only if separately available). Ordinary workflows use the limit below. Do not immediately follow unresolved connection cards with workflow intake. Apply [task intake](task-intake.md) to independent work and waiting; the source-specific state and recovery rules below remain authoritative.

## Discover and offer useful integrations

A suitable authorized capability satisfies the need without installing a more canonical plugin. Built-in web research, local authoring, and Sites need no extra integration when already available. Discover integrations for the gaps identified in the [initial check](source-selection.md#initial-dependency-check), or after the user chooses onboarding's connection action.

When an integration is missing, read and follow the **Plugin Management skill** (`$plugin-management`) when available for general discovery, eligibility, and connection handling. Data's explicit policy below takes precedence over that skill's generic recommendations about how many plugins to suggest: offer up to six relevant integrations together for ordinary tasks, or the separately defined set for onboarding's **Connect my data** (optional unbundled reference: `../skills/onboarding/SKILL.md#connect-my-data`; load its workflow only if separately available). If that skill is unavailable, use the exposed tools; if the tools are also unavailable, use the older-client fallback below.

### Efficient Data category resolution

- **Prefer the local manifest.** Reuse known candidates or read this plugin's .codex-plugin/plugin.json (optional unbundled reference: `../.codex-plugin/plugin.json`; load its workflow only if separately available), using `extensions["com.openai"].dependencies` and each entry's `categories` for relevant provider hints. This reflects the loaded build; a server lookup may resolve a different published release. The manifest does not establish current eligibility or source access.
- **Search by the needed category or capability first.** Translate the skill's usage categories into concise queries such as `Meeting Notes`, `Documents`, or `Data Warehouse`, with `limit: 10`. Use provider names when the user or source context identifies a particular system, or to refine a gap. Search distinct needs in parallel and combine the useful results into one offer. The current tool has no `usageCategory` filter: these are text queries, multiple terms match alternatives, and category labels are not guaranteed indexed terms. Include suitable workspace and curated providers beyond the manifest.
- **Refine only a gap.** Workspace matches can precede canonical global providers. If a named provider is missing from a full result page, make a focused query or increase the limit within the exposed maximum (currently 50). Refine empty or noisy results with provider/capability synonyms. Choose an actual reader of the required source, not a demo or workflow that merely mentions it. An empty search does not prove unavailability.
- **Check eligibility and history.** Apply Plugin Management's eligibility rules and exclude installed or pending plugins. Before selecting the set, use returned `suggestion_history` and current-task choices to [judge whether to re-prompt](#use-plugin-history-when-re-prompting). Do not stop at the first eligible match when several sources could materially help.
- **Offer up to six together.** For Data workflows, make one combined installation offer containing up to **six eligible plugin IDs** whenever multiple integrations are applicable or plausibly useful. Collect their exact IDs or accepted marketplace references before calling `suggest_plugins`, then put the selected set in a single `plugin_ids` array. Include required sources and useful optional context together, with a concrete role for each integration. If more than six qualify, select the six most useful for the current task. One call per turn limits the number of calls, not the number of IDs in that call; do not turn a valid batch into serial single-plugin prompts. Honor higher-priority instructions and any lower limit in the active tool schema or enforced by the service. If search-returned IDs are required, search the selected dependency names first.

Use `get_plugin_dependencies` only when the local manifest is unavailable or server-side dependency metadata would help. It reads the server's effective release, not local files; even a `name@marketplace` reference can resolve the globally listed plugin by name. When returned, `plugin_dependencies` maps `category_ids` to `plugin_id`; legacy `dependencies` and `unresolved_apps` describe app mappings. Empty legacy mappings do not establish that named dependencies are absent, and null `is_installed` means unknown.

Example calls use `plugin_management` as the namespace; use the actual exposed names and exact references from current context or discovery. Run these for missing or materially useful optional sources, including the bounded check after onboarding's connection choice:

```javascript
// For business context that could span documents and meeting records:
await Promise.all([
  plugin_management.search_plugins({ query: "Meeting Notes", limit: 10 }),
  plugin_management.search_plugins({ query: "Documents", limit: 10 }),
]);
// After eligibility checks, one offer for relevant sources, including optional context:
// Resolve these variables to exact accepted references; include up to six eligible IDs.
// Use a smaller set if the active tool imposes a lower limit.
plugin_management.suggest_plugins({
  plugin_ids: [documentsPluginId, meetingNotesPluginId, knowledgePluginId],
});
```

For one missing provider, search it directly, for example `search_plugins({query: "Snowflake", limit: 10})`. An eligible exact recommendation can avoid another lookup when the schema accepts it. Explain what the proposed set unlocks in one sentence and continue independently supported work while the user chooses what to install. Check the result for rejected or unresolved candidates; submission is not installation.

For example: "Connect Drive for source documents, and optionally Notion for decision records and ChatGPT Meetings for discussion context; choose the sources you use." Use this kind of combined offer when the task and workspace make those sources plausible, without claiming they contain the needed evidence before reading them.

Ask which existing source holds the evidence only when the answer determines the analysis. For onboarding's **Connect my data**, let the native multi-plugin connection UI collect the provider choice instead of asking a preliminary source question. Multiple suitable warehouse providers can be offered as alternatives; do not imply the user needs to connect all of them. Do not choose by manifest order or require every alternative warehouse. Follow the provider's instructions and use a known accessible scope. Ask for the smallest catalog, database, or schema scope only when the connector requires it and context or discovery cannot resolve it.

### Use plugin history when re-prompting

Use returned `suggestion_history` and the current conversation to avoid repetitive offers. Counts and timestamps show prior offers; only an explicit refusal or `last_outcome: "dismissed"` confirms a decline. Use judgment based on priority, recent offers, and what has changed: be conservative with optional enrichment, while missing P0 evidence, such as warehouse access needed for the requested metrics, may justify asking again. Honor explicit "don't ask again" and source exclusions, and avoid repeatedly asking within the same request.

When re-prompting, briefly acknowledge the prior offer or confirmed decline and explain its importance now: "I suggested warehouse access earlier; this question needs live metrics, so connecting it would let me verify the answer." Ground that acknowledgment in the available history and continue supported work.

### Wait for required connector setup

Suggestions do not establish installation or connection. After offering a plugin for required source access, treat setup as pending until a tool result or user response establishes otherwise. An immediately returning suggestion tool, elapsed time, or no response does not mean installation was declined or failed. If an existing authorized connector already supports the needed operation and scope, use it; otherwise pause work that depends on the missing access.

Do not switch to computer use, browser UI, browser-provided tools, or scraping to read that source while installation or connection is pending. For example, after offering Google Drive for a complete file listing, wait for connector access instead of opening Drive in a browser. A declined or failed installation does not itself authorize that fallback either; use browser or computer access as an alternative to the connector only when the user explicitly chooses that route.

Follow [task intake](task-intake.md) for independent work and waiting while required access is pending. Do not busy-poll installation or abandon the source requirement to keep working. Apply this waiting behavior to both new suggestions and legacy installation requests.

Track each integration separately within a combined offer. Resume the work a confirmed connection enables without waiting for optional integrations in the same set. Declining optional context does not block an answer supported by the available evidence; required source access still follows the waiting policy above.

When setup completes or the user returns, refresh tool discovery and verify the needed source with a small relevant read-only operation before resuming dependent work. Scope success claims to the operation and source actually checked, including material limits or pagination. An empty result means no data was visible in that scope; it does not by itself establish a connection failure. A successful table listing verifies metadata access, not permission to query the required tables or availability of the needed metrics. Resume the same task without restarting intake; do not assume installation automatically wakes a completed task.

## Older clients and unresolved access

If a higher-priority tool instruction requires a smaller set despite a larger array schema, honor it and describe the conflict accurately. Do not claim that the app technically supports only one installation because instructions restrict suggestions or allow only one call per turn. Report an enforced batch limit only when the active schema or a tool response establishes it. Do not bypass per-turn call limits with repeated offers.

When the new suggestion surface is unavailable, use `list_available_plugins_to_install` or client-provided recommendations and `request_plugin_install` if exposed. Follow their actual schemas and restrictions: older tools may require a specifically requested provider and an unsuccessful tool search before listing or installation. Do not use that restricted path for unsolicited optional enrichment. Use only exact compatible returned IDs. These requests can block on elicitation; `user_confirmed` does not imply `completed` or verified source access. Use whichever discovery capabilities are available and continue independently supported work when the client permits it.

If no viable match is found, discovery is unavailable, or setup fails, explain: "I couldn't find or connect a suitable integration through the available tools. Check the Plugins tab for a [category/provider] integration. If none is available, ask your workspace admin to enable one or grant access to your existing source." For a known failed provider, point to its plugin page. Installation cannot bypass an admin restriction.

Continue grounded work and offer the smallest useful authoritative export or upload when it can satisfy the request.

## When no usable source remains

Keep the selected task and earlier answers. If required setup is [pending](#wait-for-required-connector-setup), do independent work, then yield for the connection; tool return or silence is not a decline. If the user skipped setup (optional unbundled reference: `../skills/onboarding/SKILL.md#skip-or-finish-setup`; load its workflow only if separately available), ask only for the smallest useful export, without reopening setup or the first-task chooser.

Otherwise, once the task is clear and access is insufficient, offer the applicable choices together:
- **Connect a data app:** use the connection or older-client route above, verify access with the first necessary read, then resume the task. Missing discovery tools need not remove the Plugins-tab route. Omit this choice when connection is pending, declined, disallowed, or unsupported; do not re-offer a declined connection unless asked.
- **Upload data:** ask for the smallest useful file, source link, query result, schema, screenshot, or definition, then wait if the work depends on it.
- **Use sample data:** explain that synthetic data can demonstrate the workflow, not answer the real-data question. Only an explicit choice starts the selected sample (optional unbundled reference: `../skills/onboarding/SKILL.md#continue-with-sample-data`; load its workflow only if separately available); no second confirmation.

Do not show a generic project, table, or file picker. Ask about source identity or catalog scope only when context and bounded discovery cannot resolve a consequential gap.
