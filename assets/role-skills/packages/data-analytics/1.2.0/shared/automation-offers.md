# Suggest Automations

`suggest_automation` is a user-visible launcher; its click starts the separate hidden automation-creation flow. It is not a general next-step CTA.

Only the primary analytical skill may originate it, after the answer and any required report or dashboard handoff are complete, when fresh inputs, source and metric definitions, analysis steps, and intended output are stable enough to repeat and the runtime surfaces `suggest_automation`.

When eligible, add one short, concrete sentence saying what would repeat, then emit exactly one runtime-provided `suggest_automation` invocation with visible label `Make this repeatable`. In Work Mode, the expected live reference is `genui{"suggest_automation":{"label":"Make this repeatable"}}`; emit it without Markdown backticks and use the host-provided syntax if it differs. Keep the label generic: do not put cadence, metric or source names, delivery destinations, or setup detail in it. Do not ask cadence or delivery questions, call automation-creation tools, or create the automation in the same turn. If the runtime does not surface `suggest_automation`, omit the suggestion entirely instead of replacing it with a prose CTA.

Report/dashboard refresh is a narrow exception. After successfully delivering a report or publishing a dashboard to Sites with a source that can be read again without another upload, follow the selected skill's exact final-question rule instead of emitting `suggest_automation`.

Do not suggest it for one-off or exploratory work, bounded quick answers, templates or mockups, incomplete or blocked workflows, unstable sources or definitions, an already-automated workflow, or a workflow that already received a suggestion.
