# Output formats and templates

Use this guide for format selection, destination practices, Data attribution, exports, and template fidelity; the focused authoring skill owns analysis, implementation, and verification in that format. The native Page starter includes these practices for an ordinary new report, so that path needs only the applicable sections here for a format conflict, selected template, conversion or recovery. Carry the selected destination, attribution, and template requirements into authoring-skill handoffs.

## Output format selection

Select the format before authoring. Apply the latest explicit user direction, in this order:

1. **Explicit format, destination, or conversion.**
2. **User-selected output template.** Its actual format wins over automatic defaults; using an artifact only as a reference does not select its format.
3. **Existing artifact being revised.** Preserve its format, identity, and location unless the user requests a change.
4. **Automatic defaults:**

| Request | Default |
| --- | --- |
| Inline or inline plus report selected by the [index](../skills/index/SKILL.md#output-and-presentation) | Use the installed Visualize workflow for inline charts and the Sources guide (optional unbundled reference: `../skills/visualize-data/docs/rendering/inline-sources-receipt.md`; load its workflow only if separately available) independently when evidence warrants inspection; simple lookups, calculations and pure artifact handoffs need no delivery skill. Create any selected report using the report default below. |
| Report or document | Private personal Pages report when supported and authorized; otherwise HTML / Site. |
| Dashboard | Interactive HTML / Site. |

Uploaded CSVs/workbooks supply data, not an output-format choice. An automatically chosen template must fit the selected format; only a user-selected template can override an automatic format default. Use [templates and prior work](templates-and-prior-work.md#templates-and-prior-work) for discovery. This release does not read saved Data settings or legacy preference files.

Disabled Page skills affect skill discovery, not authorized Page creation, editing or delivery. Before choosing a fallback, use available tool discovery and inspect the current creation contract; unloaded tools or missing skills do not establish unavailability.

Use HTML for the report default only if Page creation is unavailable, unsupported, unauthorized or fails after supported recovery; explain the concrete limitation. Respect tool restrictions, including any explicit-Page-request requirement. Offer supported connection setup while progressing; a declined connection permits fallback. If neither Pages nor HTML is supported, choose an available format and disclose the limitation. Failure to open or preview a saved Page does not justify fallback.

For an explicitly requested format/template that cannot be used, retain the analysis and ask only for the missing requirement or permission to substitute. Recover uncertain writes through readback before retrying or creating another artifact.

Apply the destination-specific guidance under [Spaces](#spaces) or [HTML/Sites](#htmlsites).

## Spaces

These practices apply to native Pages, presentations, spreadsheets, and their supporting Pages. For report composition, charts and source Pages, use the Page report starter (optional unbundled reference: `../output_formats/space_page/report.md`; load its workflow only if separately available).

### Destination and audience

For a new personal artifact, omit `space_id` and `parent_page_id`. Use another destination only when its identity, access, and audience are established for the task; a writable or remembered Space alone does not establish permission to use it. For the top level of a selected Space, pass its actual `space_id`; beneath a selected Page, pass that Page's `parent_page_id`. These IDs are not interchangeable.

Read the selected Space root and parent Page when accessible, applying guidance identified by the tools as scoped agent instructions. Nest source pages beneath their artifact. Automatic placement does not create a Space, move an existing Page, or widen sharing. Copied data and previews must fit the destination's audience; linking a restricted source does not authorize copying its contents.

### Creation metadata

Pass top-level `namespace: "data_reports"` when the creation schema supports it, including for template-based outputs, conversions, and exports. Tag the main artifact and **each** new source subpage; children do not inherit the namespace. Use this field for other native types only when supported.

Use a supported, authorized creation route that accepts attribution for the selected format and destination. A recovery-only tool does not authorize creation. If no such route is available, disclose the metadata limitation without changing the selected output. Visible text, frontmatter, file properties, and `set_block_metadata` do not substitute for native creation metadata.

During normal delivery readback, verify each new artifact's `metadata.namespace === "data_reports"` and destination through a supported reader such as `read_page`. Report missing, different, or unreadable attribution separately from whether the artifact was saved; do not recreate it to repair metadata or imply analytics-table ingestion was verified.

### Edits and recovery

Read current content and use the tool's observed sequence/hash guards before editing. Retain artifact identities and source relationships. For uncertain creation, keep the returned identity and original arguments, including namespace and idempotency key, and follow the tool's recovery contract. If writing fails, retain the reviewed analysis and draft for recovery and report what remains undelivered.

Edits and refreshes preserve existing attribution, including another product's namespace or no namespace. Tag newly created source pages and conversions without relabeling their originals.

## HTML/Sites

Use the delivery policy for the current host (optional unbundled reference: `../output_formats/html/docs/delivery.md#publication-and-final-delivery`; load its workflow only if separately available) to choose an inline dashboard preview, local preview, or hosted Site.

Data's Sites packager writes `artifact_metadata` into `dist/.openai/hosting.json` with `producer: "data-analytics"` and the actual `surface: "report"` or `"dashboard"`. Preserve it in the deployment archive. Sites attribution uses these fields; its schema does not accept the Spaces `namespace` field. A local HTML preview has no remote artifact-creation event.

## Opening and report handoff

Before finishing a standalone HTML report, dashboard or primary requested Page, request its rendered preview in the current chat's sidebar or panel through the advertised native opening action, such as `open_in_codex`. Use the returned Page ID or a verified URL serving the completed artifact; use an HTML file target only when the host explicitly supports rendered HTML there. Follow the HTML delivery policy (optional unbundled reference: `../output_formats/html/docs/delivery.md#publication-and-final-delivery`; load its workflow only if separately available) to choose the target. Retain the final artifact link. Opening the authorized result needs no extra confirmation. Honor explicit no-open, inline-only and different-surface requests.

A saved-file link, successful build, verifier check or mention of a preview does not request native opening. Keep invocation and visibility separate: a valid opening call proves the request; `queued` does not prove the artifact is visible. Confirm rendered content when native observation is available; otherwise report only the known status. A source editor is not a rendered preview. If no supported rendered-opening capability is available or it fails, preserve the artifact and its supported final link and explain the limitation. Do not create another artifact or change its destination to repair an opening failure.

Keep inline charts, calculators, widgets and Sources fragments in conversation; HTML used for inline content does not make it a standalone deliverable. Their temporary QA previews must not be marked as deliverables or opened as duplicate sidebar results. Open the finished artifact, not an intermediate build, source/debug output or testing wrapper.

Show the report during iteration when supported, and finish with the updated main report selected. After inspecting supporting material, return to the main report, reusing its tab and avoiding a redundant open when it is already visible. For multiple Pages, finish focused on the primary requested report. Do not close the delivered report during cleanup; respect an explicit request to close it or leave another view open.

For Pages, automatically open only the parent report Page by its returned ID in the current chat's sidebar or panel through the supported host Page-opening action. Do not open source or evidence subpages in the sidebar or panel during creation, validation, or handoff; keep them linked from the report. Verify subpages through readback or a background browser, and leave the parent report selected for the user. Skip redundant opens of an already visible parent. Inspect the result when supported; queued is not confirmed open. If opening is unavailable or fails, retain the saved Page and give its link with the practical limitation.

For a delivered Page report, return its link, a high-level summary and key clarifications or caveats. Keep charts in the Page and chart source subpages; add a chat chart only when explicitly requested. This overrides inline-plus-report and inline-chart defaults without reducing the Page's evidence requirements. When no Page is delivered, ordinary inline delivery applies.

- **Positive:** After checking the new funnels and their source pages, return to the updated report and leave it open for review.
- **Negative:** Close the report during cleanup and announce completion while the reader is left on a supporting page.

## Exports and output type conversion

Creation format and available export destinations are separate choices. Before preparing or rebuilding a Data app, resolve its export catalog (optional unbundled reference: `../output_formats/html/docs/exports.md#export-preferences`; load its workflow only if separately available). For a requested conversion, use the target format's authoring workflow with the current artifact and reviewed evidence; apply the destination and metadata guidance above to the new output.

For a Spaces report, export the saved Page (optional unbundled reference: `../skills/build-report/docs/spaces-report.md#export-or-share-a-page-report`; load its workflow only if separately available). For an existing Data app, preserve its saved state through convert-to-doc (optional unbundled reference: `../skills/convert-to-doc/SKILL.md`; load its workflow only if separately available), convert-to-slides (optional unbundled reference: `../skills/convert-to-slides/SKILL.md`; load its workflow only if separately available) or report-to-pdf (optional unbundled reference: `../skills/report-to-pdf/SKILL.md`; load its workflow only if separately available). A request for a new document, deck or PDF does not require an intermediate Data app.

### Preserve context in shorter exports

Keep the primary reading flow concise when shortening or exporting an analysis. Move supporting conclusions, material caveats, population and coverage definitions, methodology, freshness, and source details into an appendix within the delivered artifact instead of dropping them. Keep affected claims accurately labeled and use a compact footnote or appendix reference when omitting the qualification would mislead. Raw data files alone do not preserve interpreted findings.

Preserve the original detailed artifact when creating a condensed export. For an in-place revision, retain the detail in its appendix or an accessible linked supporting readout. Before delivery, check that material findings and qualifications from the original remain accessible in the export, including context that was collapsed in the source.

## Template handling

Interpret a choice using the request, question, candidate identity, and intended use. Selecting a presentation template is sufficient to choose a presentation without naming that format again. Carry the exact template skill/resource identity and actual format into authoring handoffs.

| Intended use | Result |
| --- | --- |
| Apply a template, including selection in a fuller-report offer | Create a new artifact in its format, design, and analytical structure. |
| Use as reference | Gather context or approach; preserve the requested output format. |
| Copy as a base | Create a distinct artifact retaining relevant structure and content; preserve its format unless conversion is requested. |
| Update | Edit the authorized existing target and scope. Clarify consequential ambiguity before overwriting. |
| No selection | Use the selected format and automatic defaults; discover suitable templates through [templates and prior work](templates-and-prior-work.md#templates-and-prior-work). |
| Start fresh / no template | Omit templates; references may still inform analysis. |

A template selection authorizes creating the requested result, not editing the original or widening its audience. Viewing or skipping an optional fuller-report offer does not accept it.

Read the template skill and retained source before authoring, including for automatically chosen templates. Use the selected format's authoring workflow directly; do not create an intermediate Page or HTML app merely to convert it. An unreadable source's thumbnail or title cannot establish template fidelity.

Selection timing belongs to [templates and prior work](templates-and-prior-work.md#templates-and-prior-work): apply a suitable default without waiting for approval. Competing templates or a missing preview never justify a proactive blocking picker.

Preserve the source's design, aspect ratio, layout and section/slide structure, including callouts, KPI cards, comparison tables and emphasized caveats where applicable. Explicit template styling takes precedence over general style and composition defaults. Replace example data and historical conclusions with current evidence; adapt unsupported sections and disclose material deviations.

For HTML/Site templates, retain the Data runtime's protected controls while adapting authored content and theme. Other formats use their own template/copy/edit contracts. Compare the rendered result with the retained source for format, recognizable styling and structure, evidence, and an unchanged original.
