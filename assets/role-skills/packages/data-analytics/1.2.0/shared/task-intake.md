# Proceed, ask while working, or wait

Recover the task, supplied evidence, restrictions, and earlier answers first. A concrete request or submitted workflow choice starts its focused workflow immediately; choosing **Build a report** does not require a setup form. Default to best-effort progress with sensible assumptions. The tools below are preferred routes when available and supported by the current host; use text or a supported attachment path otherwise. Template discovery and choice belong to [templates and prior work](templates-and-prior-work.md#templates-and-prior-work).

## Tools and form types

| Tool or surface | Use and form types |
| --- | --- |
| `request_user_input_async` | Non-blocking clarification while work continues. Text and choices; no attachments or template selection. |
| `form_elicitation_v2_request` | Blocking native forms: `text`, `single_select`, `multi_select`, `resource` (one template/analysis), `resources` (several), and `files`. |
| `request_user_input` | Blocking short-choice interaction, within its live mode and purpose restrictions. |
| Assistant text or host attachment path | Fallback when the preferred tool is unavailable. |

Other supported native pickers may fit a requested interaction. Plugin installation and sign-in use [Plugin Management](source-setup.md#native-connection-controls). Use a nonblocking tool only under its actual continuation and lifetime contract; do not infer a countdown, automatic choice, or authorization from silence.

## 1. Non-blocking

Ask during the work when an answer would materially improve the result, but useful work can continue under a defensible assumption. Metric ambiguity, audience differences, and possible rework do not by themselves justify blocking. Template choices follow [templates and prior work](templates-and-prior-work.md#templates-and-prior-work): choose a default automatically; user selections use only a requested rich resource picker.

Prefer **`request_user_input_async`** for a focused question, state the working assumption, and continue independent work. Keep the question pending under the live tool contract and incorporate a reply when it arrives. If unavailable, ask in text while continuing supported work. Silence, preselection, dismissal, a timeout, or an installer callback is neither an answer nor authorization; do not repeat an unanswered picker automatically.

**Examples:**

- **Audience:** A substantial report could serve leadership or operations. Ask “Who is the primary audience: leadership or operations?” asynchronously, while preparing a useful summary and supporting detail.
- **Metric definition:** Two retention definitions are plausible. Use the best-supported definition, ask asynchronously whether the alternative is intended, and disclose any unresolved discrepancy in the result.

## 2. Blocking

Blocking interrupts the user's flow and stops progress. Avoid it except when missing required source material prevents meaningful progress, the user explicitly requests a form or file/template/previous-analysis selection, or the user asks you to wait. Finish useful independent work first.

Prefer **`form_elicitation_v2_request`** when supported, or another suitable route from the table above. Read the native form guide (optional unbundled reference: `../mcp/forms/README.md`; load its workflow only if separately available) only when using it. Native forms pause the tool and task runtime; `required: false` makes fields skippable, not asynchronous. Keep Data intake fields skippable and reassess any essential gap after submission. On skip, cancellation, or decline, do not reopen the form automatically; continue supported work with reasonable defaults for optional gaps. Missing sharing choices grant no authority.

**Examples:**

- **Missing data:** “Analyze the CSV I uploaded,” but no file or equivalent source is available. Prefer **`form_elicitation_v2_request`** with question type **`files`**; otherwise request a supported attachment. Pause the data-dependent analysis.
- **Requested selection:** “Let me choose a template or previous analysis before you start.” Discover relevant choices; use **`form_elicitation_v2_request`** with **`resource`** for one or **`resources`** for several, or an equivalent supported rich resource picker, and wait for the selection. For template selection, do not substitute an async question or text-choice menu if the picker is unavailable.

## 3. Final answer caveats, clarifications, and next offers

Use the final answer for unresolved non-blocking assumptions or questions that arose during the work, and useful opportunities to investigate further, or answer a follow-up. Report creation follows the [index scope rule](../skills/index/SKILL.md#output-and-presentation), not a routine offer after complex analysis. Ask during the work instead when the reply could materially improve the result currently being produced.

Deliver the requested result first. Use concise text or supported follow-up controls for an optional next step; do not open a blocking form just to finish an answer. If the user requests a template choice, go directly to the picker without another “Do you want a report?” question.

**Examples:**

- **Caveat and clarification:** “I used renewing accounts for retention; retained revenue would answer a different question. If you meant revenue retention, I can recalculate.”
- **Next offer:** After a well-supported diagnosis, “I can investigate the affected segment further.” Offer the relevant next step, not a standard menu after every answer.
