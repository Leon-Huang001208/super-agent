# Shared Data instructions

Keep the user’s task, source restrictions, selected context, requested output and prior answers across handoffs. The [index](../skills/index/SKILL.md#shared-instructions-table-of-contents) maps shared guidance; directly invoked skills supply their own applicable links and need no index round trip. Read the selected workflow and currently applicable references in one parallel batch **before the action they govern**, with enough output capacity for each read and the enclosing batch. Defer later branches. A capability answer, welcome or named tour uses its own short path.

Reuse instructions already loaded for this task, including by another skill. Treat repeated links and “read before use” requirements as satisfied by complete text in context. Fetch only missing or truncated sections, or changed instructions; do not restart a reading bundle at a skill handoff. The index owns the file-read tool settings.

## Task preferences

Apply explicit task choices, selected templates, and relevant context skills before defaults. Choose balanced chart spacing unless specified. Existing Data Context and Working Preferences layouts remain usable: preserve names, owner, audience and metric meaning; style preferences neither redefine a governed measure nor authorize external actions. Keep newly learned semantics scoped to this task unless persistence is requested.

This release has no saved Data settings or settings tools. Do not read, write, migrate or delete old preference files. If asked to change a setting, explain that limit and apply the preference now. Use Customize Data Plugin (optional unbundled reference: `../skills/customize-data-plugin/SKILL.md`; load its workflow only if separately available) for explicitly requested reusable guidance. Presentation-only or packaging work needs no unrelated source discovery.

## Analysis records and companion artifacts

Keep exact queries, inputs, calculations and source references inspectable in working scripts or the selected output's source metadata. SQL, Python or a multi-step analysis does not by itself call for a notebook. Create, render or export additional notebooks, workbooks, decks or other companion deliverables only when the user requests them; use the notebook workflow for requested notebook work. Deliver the presentation selected by the index, including its charts, source details and any scope-triggered report, without packaging extra formats. An available export menu is not a request to generate exports.

## Links in the conversation

Match the final response to the task. For artifact creation, identify and link or preview the deliverable; add a takeaway when useful. For an analytical question, answer with the key evidence and implication, then link any companion report or dashboard. Delivered Page reports use the [Page handoff](output-and-template-handling.md#opening-and-report-handoff). A standalone answer needs enough explanation to be useful on its own. Omit contents inventories and unrequested implementation details; mention the format only when it helps the user choose or open the deliverable.

Preserve limits of the evidence that could change the user's interpretation or decision. Keep validation evidence and routine operational details, such as an unperformed mobile check, in the working record. Mention an operational issue when it affects access, use of the deliverable, or an explicitly requested capability; explain the practical consequence. Ask for missing input only when it changes what can be concluded or done.

- Useful: “Active-user rates rose from 40% to 45%, up 5 percentage points: a larger share of eligible users completed a task this week.” Follow with the linked weekly KPI report.
- Avoid: “Includes a chart, interpretation, and assumptions; verified at desktop and mobile sizes.”

Use descriptive clickable Markdown in progress, sources and handoff: `title (optional unbundled reference: `verified`; load its workflow only if separately available)`. For a desktop file use its absolute path, with angle brackets around a destination containing spaces or parentheses; for a cloud file or Page use the actual supported download or user-facing URL. Do not invent a destination, expose a remote path as a local file, or present a bare URL as the user’s link.

For HTML delivery use the verified live URL and selected view (optional unbundled reference: `../output_formats/html/docs/delivery.md#publication-and-final-delivery`; load its workflow only if separately available); a filesystem HTML link may open source, not a rendered preview. Respect file-only requests and label any permitted fallback. Native inline visualizations retain their own delivery syntax.

## Accessible colors and appearance

Keep marks, text, legends and tooltips legible against the actual host in light and dark mode, including charts on a Page or its source subpages. Respect requested colors and stable series meanings; supplement color with labels, shapes or line styles. Start from a complete supported theme and map each series to a valid color. Standard Page components supply the theme; ordinary authoring need not revalidate it. Inspect both supported modes when authoring custom appearance. A successful build or empty chart frame is not visual verification; record only checks actually performed.

## Chart surfaces and style

For inline charts and calculators, use Visualize directly. For a new Page chart use its supported chart component, retaining units, comparisons and inspectable sources. Data HTML reports and dashboards retain their shared React bindings. Use image export for Markdown and put exact values in labels or an adjacent table.

### Preserve charts during verification

For ordinary Page authoring, use the standard chart component and assume it renders after successful preparation and save. Check reviewed values and saved references, then deliver without browser polling, screenshots, hover exercises, theme checks or image generation. Component rendering belongs to release qualification. Use the procedure below for custom charts, an explicit visual-review request, or a concrete reported failure; it is not an extra completion gate for standard Page charts.

**Verification must not destroy working output.** Preserve the existing chart components, configuration, embed references, interactions, and layout while checking them. Preservation means retaining the delivered chart, not merely saving its configuration or a backup. A chart the user confirms works must remain intact unless they request a change or a specific defect is established.

- Inspect the actual delivery surface. Bring the chart into view and wait for visible plotted marks, a reviewed empty state, or an explicit chart error. Native Page embeds can take about a minute to initialize: allow up to **90 seconds total** there; allow up to **60 seconds** for an HTML report or other chart surface. Use supported readiness checks in bounded calls, continuing independent work while loading where possible. These are observation budgets, not mandatory sleeps. Record the surface and observed timing; do not repeatedly reload or restart the clock.
- Track **loading**, **rendered**, **explicit error**, and **verification timed out** separately. An isolated blank screenshot, incomplete accessibility snapshot, cross-origin iframe inspection limit, selector/tool timeout, or unrelated console warning does not identify a chart defect. Exceeding the observation budget means rendering is unverified and delivery was slow, not that the implementation is broken. A preview in another browser cannot overrule a working destination or the user's observation.
- A generic host notice such as "An error occurred inside the visualization" does not establish a defect in the chart implementation. Recheck the same artifact without reloading; distinguish a host/inspection problem from the chart's own error. For a Page, prefer the host's in-app viewer. If another browser reports only a generic visualization error, check the in-app viewer before authoring a fallback. If it renders there, finish verification; no image export or browser troubleshooting is needed. A successful standalone rendering is reason to preserve that implementation while investigating delivery.
- Before changing an implementation, record a specific reproducible configuration, data, reference, or component defect and repair it in place. Check each affected embed separately: a problem on the report does not establish a problem on its source Pages or other charts. Do not regenerate charts, rebuild the report, or switch formats to make a preview check pass.
- If inspection remains inconclusive or times out, retain the existing interactive embeds and record rendering as unverified. Record an explicit rendering error separately, with its cause unresolved until diagnosed. Check CDN loading, host/iframe startup, and the chart's own errors; preserve the component while applying a scoped repair, and report unresolved delivery limitations. For a confirmed unresolved Page failure, follow Visualize Data’s Page fallback procedure (optional unbundled reference: `../skills/visualize-data/docs/rendering/page-chart-fragment.md#custom-charts-and-fallbacks`; load its workflow only if separately available). On other surfaces, an optional static fallback remains separate from the original chart. Never remove a working or merely unverified chart to recover from a verification problem.

Use static SVG/images only for an actual rendering or delivery fallback, a specific chart whose required encoding cannot be rendered faithfully otherwise, an image-only destination such as a Markdown report, or an explicitly requested static/export figure. SVG marks inside a working interactive chart are not a static-file fallback. Preserve reviewed values, inspect the image and deliver it in the selected surface; a small dataset alone does not justify replacing the interactive chart with a static asset.
