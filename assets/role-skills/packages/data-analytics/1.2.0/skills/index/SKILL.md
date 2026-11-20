---
name: index
description: "Answer product and business questions with data and route data-related work to the right focused workflow. Use for requests involving data, metrics, trends, comparisons, drivers, KPIs, analysis, dashboards, reports, charts, tables, SQL, notebooks, spreadsheets, market sizing, data quality, reusable data context, data definitions, or working preferences, whether or not Data is at-mentioned. Dashboards can use uploaded spreadsheets, CSVs, or TSVs as source data without making the deliverable a spreadsheet. Do not use Data for general writing, editing, coding, or explanations that require none of these workflows."
---

# Data and shared instructions

> Role-package adaptation: `design-kpis` and the linked shared guidance are packaged here. Other focused workflows, native Data app runtimes, Pages starters and forms helpers listed below are optional and are explicitly marked when absent. Do not treat those paths as installed capabilities. For a KPI task, complete the KPI framework using the requested output and the current Paperclip task's artifact contract; an unavailable optional report, export or picker workflow does not require creating a Data app or delaying the KPI work. If the user requests one of those separate workflows, discover its actual availability and report any concrete missing capability before using it. Current task authorization and tool availability still govern every action.

For concrete work, use the focused skill that matches the request. Skills can be invoked directly; they do not need to come through this index.

From this index, select the focused skills below and read their `SKILL.md` files together with the currently applicable shared guides directly in one parallel batch. Follow the links without walking through intermediate guides to rediscover that same reading set. Defer references whose triggers do not yet apply.

**Read each required file or section once per task.** Reuse complete instructions already in context across skill handoffs; another link or “read before use” instruction does not require another read. Recover only missing or truncated text, or changed instructions, without repeating complete files.

For instruction reads, set a generous output budget on **both the file-read command and its enclosing tool call**. With `functions.exec`, start the batch with `// @exec: {"max_output_tokens": 64000}` and set each `tools.exec_command` read to `max_output_tokens: 20000`; increase these or split into disjoint batches if needed. Budget at least 1.5× the combined size of the selected files, including focused skills and external guides. A large per-command limit alone does not prevent the enclosing batch from truncating its output. Return each path and the raw `result.output`, rather than serializing the full tool-result envelope. Read required files in full on the first pass; request an anchored section only when that is the applicable guidance.

## Short paths

- **“What can Data do?” or examples only:** answer here, then stop. Data can explain a metric change, design KPIs, compare retention, size an opportunity, or build a source-backed report or dashboard. Give relevant examples without starting one or checking connectors. Ordinary writing, formatting or code repair needs no Data workflow.
- **Get started, choose a first task, or tour a named homepage example:** use onboarding (optional unbundled reference: `../onboarding/SKILL.md`; load its workflow only if separately available) and its short welcome or tour path. Resume a concrete request interrupted by installation without requiring setup.
- **Existing definitions or business framing only:** use the metric definitions reference below and [inline delivery](#inline-delivery) for retrieved evidence, then return a focused, cited answer; a simple definition lookup does not need a Sources widget. Persist a definition or domain change only when explicitly requested, through its authorized maintenance workflow.

## Focused skills

Choose the analytical skill by the question and the delivery skill by the output; a report, chart or export does not replace the analysis. For example, explaining declining retention in an HTML report uses metric-diagnostics + build-report; a weekly KPI workbook uses kpi-reporting + the spreadsheet authoring skill. Load the smallest applicable set. Converting an existing artifact does not restart analysis: use its conversion workflow to preserve content and state. A new document or deck can use its native authoring path.

For a request to continue, recalculate, or revise an existing analysis, resume the applicable analytical and delivery skills and perform the requested work. Preserve the existing artifact and output choice. Use answers-follow-up only for optional next-task suggestions; a selected suggestion is a concrete request to execute through the relevant workflow.

| Skill | Use for | Approx. tokens |
|---|---|---:|
| product-business-analysis (optional unbundled reference: `../product-business-analysis/SKILL.md`; load its workflow only if separately available) | Business decisions, product or experiment analysis | 3.5k |
| metric-diagnostics (optional unbundled reference: `../metric-diagnostics/SKILL.md`; load its workflow only if separately available) | Explain a metric change or its drivers | 3.5k |
| kpi-reporting (optional unbundled reference: `../kpi-reporting/SKILL.md`; load its workflow only if separately available) | KPI summaries, recurring business reviews | 4k |
| [design-kpis](../design-kpis/SKILL.md) | Define success metrics and guardrails | 3k |
| market-sizing (optional unbundled reference: `../market-sizing/SKILL.md`; load its workflow only if separately available) | Size markets or opportunities | 2.5k |
| analyze-data-quality (optional unbundled reference: `../analyze-data-quality/SKILL.md`; load its workflow only if separately available) | Profile data and diagnose quality problems | 3.5k |
| validate-data (optional unbundled reference: `../validate-data/SKILL.md`; load its workflow only if separately available) | Audit calculations, claims or an existing analysis | 3k |
| answers-follow-up (optional unbundled reference: `../answers-follow-up/SKILL.md`; load its workflow only if separately available) | Offer optional next-task suggestions | 1k |
| build-report (optional unbundled reference: `../build-report/SKILL.md`; load its workflow only if separately available) | Narrative reports and documents | 6.5k |
| build-dashboard (optional unbundled reference: `../build-dashboard/SKILL.md`; load its workflow only if separately available) | Monitoring or exploratory dashboards | 5k |
| visualize-data (optional unbundled reference: `../visualize-data/SKILL.md`; load its workflow only if separately available) | Chart selection and implementation for reports, dashboards, notebooks and other durable artifacts | 5k |
| jupyter-notebooks (optional unbundled reference: `../jupyter-notebooks/SKILL.md`; load its workflow only if separately available) | Requested notebooks or computational artifacts | 4k |
| convert-to-doc (optional unbundled reference: `../convert-to-doc/SKILL.md`; load its workflow only if separately available) | Convert an existing Data app to a document | 2k |
| convert-to-slides (optional unbundled reference: `../convert-to-slides/SKILL.md`; load its workflow only if separately available) | Convert an existing Data app to slides | 2k |
| report-to-pdf (optional unbundled reference: `../report-to-pdf/SKILL.md`; load its workflow only if separately available) | Export a report to PDF | 1.5k |
| share-artifact-summary (optional unbundled reference: `../share-artifact-summary/SKILL.md`; load its workflow only if separately available) | Requested sharing of an existing artifact | 2k |
| publish-artifact-to-sites (optional unbundled reference: `../publish-artifact-to-sites/SKILL.md`; load its workflow only if separately available) | Publish or update an artifact on Sites | 5k |
| schedule-refresh-jobs (optional unbundled reference: `../schedule-refresh-jobs/SKILL.md`; load its workflow only if separately available) | Requested recurring artifact refresh | 2k |
| onboarding (optional unbundled reference: `../onboarding/SKILL.md`; load its workflow only if separately available) | Get started or tour a homepage example | 4.5k |
| customize-data-plugin (optional unbundled reference: `../customize-data-plugin/SKILL.md`; load its workflow only if separately available) | Maintain reusable Data context or definitions | 4.5k |

For inline visualizations, read and follow the installed Visualize skill for the current host (`visualize:visualize` on Desktop, or the available system Visualize skill in Work Mode). Data supplies reviewed evidence and answer composition; Visualize owns chart authoring and native delivery. The Data `visualize-data` skill remains guidance for durable artifacts.

## Output and presentation

For substantive analytical writing, use [Data writing](../../shared/data-writing.md) alongside the selected workflow for a clear summary and appropriately qualified evidence.

Choose the presentation alongside the analytical workflow, before a source helper or calculation can choose it for you. Apply explicit format requests, user-selected templates and existing artifact revisions first under [output formats and templates](../../shared/output-and-template-handling.md#output-format-selection). The source format is not the output format; an uploaded workbook can supply an inline answer, report or dashboard.

When missing source evidence blocks the requested findings, request it inline before creating an artifact. Create a placeholder or outline only when specifically requested.

| Request and scope | Presentation and instructions to load |
| --- | --- |
| Explicitly inline-only or chat-only; text-only or table-only without a requested artifact | Respect that choice and follow [inline delivery](#inline-delivery), without creating a report or dashboard. |
| A requested report, document or other narrative artifact | Use build-report (optional unbundled reference: `../build-report/SKILL.md`; load its workflow only if separately available) (~6.5k tokens) and the selected format's authoring path. |
| A requested dashboard for monitoring or exploration | Use build-dashboard (optional unbundled reference: `../build-dashboard/SKILL.md`; load its workflow only if separately available) (~5k tokens). |
| No explicit format, and three or more distinct analytical questions need answers | Deliver an inline summary plus a report: load [inline delivery](#inline-delivery) and build-report (optional unbundled reference: `../build-report/SKILL.md`; load its workflow only if separately available) together. |
| Other questions and analyses | Answer inline using [inline delivery](#inline-delivery). |

Count independent questions requiring distinct findings, not metrics, source files, calculation steps, headings or chart series within one question. Comparing two plans across several measures can remain one question. Reviewing adoption, diagnosing reliability and deciding pricing are three. Apply the same rule if the requested scope expands during the task; do not manufacture extra questions to cross the threshold. An explicit output choice continues to take precedence. A dashboard is created when requested, not inferred from a large number of questions.

For the combined path, give a useful inline summary and link the completed report containing the fuller answers, evidence and useful charts. A delivered Page uses the [Page handoff](../../shared/output-and-template-handling.md#opening-and-report-handoff), with no chat chart unless explicitly requested; otherwise usually include one chart when it clarifies the main finding. Reuse the same reviewed calculations and qualifications across both surfaces. Begin the report when the first coherent evidence is available and continue the remaining analysis there; do not stop at offering or promising it. No packaging question is needed for this scope rule. Do not routinely offer an additional report after smaller analyses.

For a new report, use the native Page report starter (optional unbundled reference: `../../output_formats/space_page/report.md`; load its workflow only if separately available) to create a private report and linked evidence pages. Use HTML/Sites when Pages is unavailable or unauthorized. Dashboards use the interactive HTML/Sites workflow. Follow [output formats and templates](../../shared/output-and-template-handling.md#output-format-selection) for explicit formats, selected templates, existing artifacts and recovery.

Inline is a presentation class, not a depth limit. Complete the requested analysis. **Use Visualize for an inline chart when the user asks for a chart or when quantitative analysis compares periods, groups or options, or explains a trend, distribution or relationship.** For a single-value lookup, standalone calculation or conceptual explanation, answer directly unless a chart is requested. Honor explicit text-only, table-only and no-chart requests. The Page placement rule above still applies.

Warehouse results and other substantial source-backed findings use the inline guide’s Sources widget when inspecting definitions, filters, queries or limitations materially helps build trust, including when no chart helps. Simple lookups use concise citations without rendering a widget. Follow the chosen delivery instructions as part of composing the answer; a source preview does not replace an analytical chart. Source helpers supply evidence and do not change the selected presentation.

For actions on an existing artifact, use share-artifact-summary (optional unbundled reference: `../share-artifact-summary/SKILL.md`; load its workflow only if separately available) for requested sharing, [output conversion](../../shared/output-and-template-handling.md#exports-and-output-type-conversion) for exports, and schedule-refresh-jobs (optional unbundled reference: `../schedule-refresh-jobs/SKILL.md`; load its workflow only if separately available) for a recurring refresh. Preserve the artifact's identity and selected destination. A generic share request does not identify a recipient or grant publication rights.

## Inline delivery

Lead with the finding, explain its implication, and state limitations that change the conclusion. Reuse reviewed evidence from the analytical workflow. Render inline charts with the standard chart component for the chosen family from the installed Visualize library and follow its current host contract; do not scaffold a Data app for an inline answer. Emit the actual native visualization reference in the final response, one per chart. A source preview, downloadable HTML file, table or promised handoff does not replace an available inline chart.

Embed only the reviewed values needed for the visual, preserving units, series identities, missing values and source qualifications. Keep interpretation beside the chart. Use Markdown for ordinary tables; reserve interactive tables for requested sorting, filtering or exploration. Never invent history, observations, provenance or confidence scores.

When definitions, filters, queries, lineage or limitations materially help assess substantial source-backed findings, render one combined Sources widget below the answer using inline-sources-receipt.md (optional unbundled reference: `../visualize-data/docs/rendering/inline-sources-receipt.md`; load its workflow only if separately available). Its existing `render-inline-sources.mjs` helper prepares the evidence receipt; follow the installed Visualize skill for supported delivery. Positively identified Work Mode uses its native provenance surface. Simple lookups or a few transparent supplied values need only useful source links or labels.

If Visualize is unavailable, give the reviewed figures and finding in prose or a compact table. If Visualize is present but native delivery fails, state the observed limitation and follow the supported fallback guidance (optional unbundled reference: `../visualize-data/docs/rendering/native-inline-visualizations.md`; load its workflow only if separately available), preserving any existing interactive output. Apply [chart preservation](../../shared/shared-skill-instructions.md#preserve-charts-during-verification) during checks.

## App component reference

For dashboards and HTML/Sites reports, use the existing app runtime and follow reference lookup (optional unbundled reference: `../../output_formats/html/docs/app-components.md#resolve-the-component-reference`; load its workflow only if separately available). Start from the preparer's returned `documentation.entryPoint` and read only the topics needed for the authored content. Inline charts and native Pages use their host's visualization workflow.

## What the reader sees

Keep stakeholder-facing inline answers and visible report or dashboard copy focused on the answer, evidence, implications, and caveats that change interpretation or action.

Do not include analysis process, methodology choices, source selection, query strategy, validation steps, chart-choice rationale, implementation details, rejected alternatives, or internal confidence scoring in visible titles, descriptions, captions, annotations, summaries, or prose. Keep that detail in source metadata, the source inspector, source notes, or supporting artifacts. Include methodology only when the user asks for it, the selected template requires it, or it materially changes interpretation or action.

For inline answers, state material metric-scope differences and partial-period limitations beside the chart. For dashboard or report artifacts, follow the focused build skill's presentation rules instead of duplicating qualifications across surfaces. Never reinterpret unrelated provider, retrieval, or classification scores as confidence in a metric or analytical conclusion, whether in source evidence flow or final prose.

Before finalizing, scrub invented numeric or qualitative answer-confidence ratings and remove anything that does not answer a user question, support a finding, or change interpretation or action. Preserve natural uncertainty, genuinely evidenced relevant statistical uncertainty, including confidence intervals, and material caveats. The inline Sources receipt reports provenance and recorded qualifications, not an answer-confidence level. If the user explicitly asks how well a finding is supported, explain the concrete source and result checks and the most consequential limit in native prose; never invent a probability or rate an unsupported causal claim.

Keep SQL and reproducible checks in the receipt, source details, query link, notebook or supporting evidence, not the visible answer or reader-facing narrative, unless SQL or methodology was requested. This also applies to context-skill preferences to show SQL. Use descriptive [source links](../../shared/shared-skill-instructions.md#links-in-the-conversation), or a plain source label when no useful link is available. Never expose credentials, hidden reasoning, direct personal contact or payment identifiers, or unverified calculations.

## Shared instructions: table of contents

This is the complete map for shared guidance, not a bundle to load. Priority tells you **when to use a reference**. At every priority, apply guidance already in context and read only what is missing. For capability help, onboarding, a named tour or a definitions-only request, start with the short path above.

Size hints estimate full-file tokens as UTF-8 bytes / 4, rounded up to the next 500; they are planning estimates, not tokenizer counts or instructions to load whole conditional guides. Allow the headroom above. When an inline chart is called for, apply [inline delivery](#inline-delivery) and read the installed Visualize skill directly with the analytical workflow. For a new Page report, read its Page guide (optional unbundled reference: `../../output_formats/space_page/report.md`; load its workflow only if separately available). Dashboards and HTML/Sites reports use the existing Data app runtime and its resolved component reference. For a warranted Sources widget, include its delivery reference (optional unbundled reference: `../visualize-data/docs/rendering/inline-sources-receipt.md`; load its workflow only if separately available).

- **Critical:** Required before substantive work in every Data workflow, including a directly invoked skill.
- **Important:** Required for the kind of work named in the row. If that need is clear up front, read it with the focused skill; otherwise, read it before the first step it governs.
- **As needed:** Use only when the specific situation in the row arises. Defer the read until then; once it applies, follow the reference’s requirements.

| Priority | Shared reference | Approx. tokens | When it applies |
|---|---|---:|---|
| Critical | [Shared Data instructions](../../shared/shared-skill-instructions.md) | 2k | Start concrete work: common rules, task preferences, accessible presentation and links. |
| Important | [Source selection and dependency resolution](../../shared/source-selection.md) | 2k | Establish source restrictions and authority before a helper or query; check availability and use bounded discovery. |
| Important | [Metric definitions and business context](../../shared/metric-definitions.md) | 1.5k | Resolve company-specific meaning before accepting a controlling source, choosing tables or interpreting measurements. |
| Important | [Task intake](../../shared/task-intake.md) | 1.5k | Proceed with an assumption, ask asynchronously, or handle one of the narrow blocking cases. |
| Important | [Templates and prior work](../../shared/templates-and-prior-work.md) | 1k | Find relevant templates or prior work for a substantial analysis, report or dashboard. |
| Important | [Analysis quality](../../shared/analysis-quality.md) | 3k | Check analytical claims, comparability, denominators and conclusions as evidence changes. |
| Important | [Dashboard quality](../../shared/dashboard-quality.md) | 2k | Check a dashboard’s hierarchy, behavior and rendered result. |
| Important | [Output formats and templates](../../shared/output-and-template-handling.md) | 3k | Create, revise, convert or recover a durable artifact in the selected destination. |
| Important | Data app contract (optional unbundled reference: `../../output_formats/html/docs/app-components.md`; load its workflow only if separately available) | 16.5k | Read or change a Data app: dashboards and HTML/Sites reports. Read the relevant section. |
| As needed | [Source setup and access recovery](../../shared/source-setup.md) | 4k | A concrete access gap, useful integration, pending connection, or no usable source. |
| As needed | [Table usage metadata](../../shared/table-usage.md) | 1.5k | Include available usage evidence for a warehouse table in a Data app or inline Sources receipt. |
| As needed | [Template previews](../../shared/template-previews.md) | 2.5k | Prepare a requested template picker, including local rendering fallbacks; missing previews need not delay it. |
| As needed | [Automation offers](../../shared/automation-offers.md) | 0.5k | Offer to repeat an eligible completed analysis; report or dashboard refresh has its own rule. |
