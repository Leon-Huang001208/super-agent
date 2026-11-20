# Authoritative metrics and definitions

For work that depends on company-specific data meaning or source selection, resolve applicable definitions before accepting a controlling source, choosing tables, writing SQL, or interpreting measurements. Use context explicitly selected by the user and applicable context skills first. If neither provides the needed definitions, check applicable [first-party domains](#default-first-party-discovery); if that check finds no applicable domain, [discover business context live](#business-context) from original sources for this task. A verified metric card, dashboard, or table does not replace that domain check. Reuse completed discovery across focused skills when its scope still applies.

### Common fallbacks

Use relevant available capabilities and a few targeted lookups, not an inventory of every provider. The first-party check applies even without a provider plugin; other sources apply when selected for the task or needed for a concrete evidence gap, subject to available access.

| Context source | Where to look |
| --- | --- |
| First-party data context | Check declared locations, local runtime directories, and relevant connected storage using [default first-party discovery](#default-first-party-discovery). Read applicable domain entry instructions and definitions. |
| Snowflake semantic views | When an authorized Snowflake integration exposes semantic-view discovery or metadata, search the relevant database/schema for views covering the question and read their metric definitions, dimensions, and relationships. Use the available provider guidance and tools; generic SQL access alone does not establish semantic-view discovery or Cortex Analyst support. |
| Databricks Genie or other connected semantic services | Look for relevant spaces or models through supported discovery tools, then use their definitions and source guidance. Preserve the selected connection and distinguish generated SQL from executed results. |
| Governed metric catalogs, BI models, and source documents | Search the relevant catalog, model, or team documentation for maintained definitions and governing queries or dashboards. Follow links to original evidence rather than relying on search snippets or secondary mentions. |

Read and reconcile the selected document or domain entry instructions and relevant references through authorized file or connector tools; use connected context services through their supported capabilities and provider guidance. Establish authority from ownership, scope, applicable date, and source rules, not provider identity or whichever result appears first. Preserve definitions, population, grain, filters, joins, period, and freshness; retain material conflicts. A definition or generated query alone does not establish a measurement: use an authorized governed data source for the result.

When no applicable maintained context is found, or relevant business context is missing, gather context from original sources using [source discovery](source-selection.md#find-the-authoritative-source) and [business context guidance](#business-context), and keep assumptions visible. An unreadable or irrelevant supplied context reference is not an unset one: preserve it, disclose the gap and any alternative used, and do not silently switch domains or datasets. Failed or unavailable discovery remains unresolved, not proof of absence. Continue independently supported work and disclose limitations that could change the answer.

Honor explicit source-only and supplied-data-only tasks without external discovery. Conceptual work without company-specific definitions and preference-only, packaging-only, or presentation-only work need no metric-context search. Existing context and search results remain task-scoped; persistent definition or domain changes go to the selected provider's authorized authoring or maintenance workflow only when requested. If that workflow is unavailable, provide a concise proposed correction and the concrete owner or next step without claiming a persistent update.

### Default first-party discovery

Check declared or provider-default domain locations first, including `<host-config>/athena/runtime` for first-party Data Context/Athena (`$CODEX_HOME/athena/runtime`, or `~/.codex/athena/runtime` when `CODEX_HOME` is unset, in Codex). Within an Athena runtime root, the existing local layout has domain entries at `local/<domain-id>/runtime/README.md`. If none establishes an applicable domain and local files are available, look for other `<host-config>/*/runtime` roots. Inspect relevant `README.md` or `AGENTS.md` entries within these roots, including nested domain/runtime folders. Read only applicable domain entries and references; do not recursively scan the host configuration directory.

### Business context

For missing business context that could affect the analysis, use documents and decisions for goals, owners, and constraints; messaging or meeting records for operational or customer developments; and release, experiment, rollout, or incident records for changes. Match the requested period and distinguish plans, implemented changes, and observed outcomes.
