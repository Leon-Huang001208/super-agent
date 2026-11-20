# Templates and prior work

Use this before choosing a template or retrieving prior work. Reuse current-task discovery; a revision with a settled format does not reopen template selection.

Search other chats only when requested or when the user refers to earlier work that needs retrieval. Metric meaning belongs to [metric definitions](metric-definitions.md); source authority belongs to [source selection](source-selection.md).

## Templates and prior work

For new reports and dashboards, make a short template-discovery pass before committing to a layout, even when the data is already supplied. Inspect relevant installed templates first; search prior work when it can improve the approach. An inline analysis needs no template search; retrieve prior work when it can materially inform the answer. Skip template discovery when the user requests starting fresh or a template is already selected. For an existing artifact revision, keep that artifact as the starting point and look only for useful supporting references.

Use the topic, metrics, decision, and team context. Cap discovery at two focused queries per relevant source, three sources, and five promising artifacts to inspect; stop earlier when the approach is clear.

- **Templates:** Inspect enabled artifact-template skills, including personal/shared templates, or `list_artifact_templates` for a kind supported by its live schema. Read shortlist metadata first and the full retained source when applying a template. Template Creator is for authoring reusable templates, not consuming them.
- **Prior work:** Search relevant Sites, Pages/Spaces, documents, and supplied artifacts. Inspect a relevant excerpt before recommending a prior artifact's definitions, evidence, or approach. Using it as a reference does not make it the output template.
- **Fit:** Rank by task, audience, and selected format, not recency alone. Include general-purpose layouts in that format and strong topic/audience matches in other formats unless explicitly excluded. Verified user/teammate authorship or evidenced company popularity are secondary signals. There is no minimum shortlist size; a recent report is not automatically a suitable template.

For an automatic choice, use the strongest suitable template in the selected output format without confirmation. Mention the choice once, during progress or at delivery; update the user if it changes. Other-format candidates can be offered when the user requests a selection. Follow [output and template handling](output-and-template-handling.md): an explicitly selected template determines its output format; a reference does not. Preserve the exact template skill/resource identity, retained source, and actual format across handoffs.

Follow [task intake](task-intake.md) for proceeding, asking while working, and waiting. A suitable default needs no confirmation; when alternatives would materially improve the result, you may offer to show them. Actual template selection uses only a rich resource picker: `form_elicitation_v2_request` with `resource`/`resources`, or an equivalent supported rich picker—not `request_user_input_async`, plain choice questions, or a text menu. Open it only when the user asks to choose, accepts the offer to choose, or asks you to wait for their selection. If unavailable, explain the limitation and continue work independent of that selection rather than substituting another questionnaire.

Read [template previews](template-previews.md) only when preparing that picker; missing previews must not delay it. A picker request alone does not authorize creating a report; preserve whether it is a preview, a reference choice, or a selection for already-requested work.
