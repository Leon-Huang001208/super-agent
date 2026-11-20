---
name: engineering-delivery
description: Use when reviewing a change, preparing a handoff, or performing an explicitly authorized release.
---

# Engineering Delivery

### Review and handoff

Follow [review and evidence](references/review-ship.md) to map the diff to tests, risks, and rollback evidence. Local review and preparation do not authorize remote operations.

### Publish only with current-task authorization

Use [managed delivery](references/iteration-delivery.md) only when the user authorized this task’s remote operation. Follow the project rules for publication and CI. If the authorized route is PR-only or unspecified, do not call a controller that attempts a direct push. Resolve the remote default branch, verify the integrated result, and run cleanup only when its own requirements and authorization are satisfied.
