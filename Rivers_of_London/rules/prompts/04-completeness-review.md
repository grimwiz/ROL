# Prompt: Completeness Review

Use after a draft file exists.

Task:

Compare the draft against the raw source sections and PDF pages that feed it.

Requirements:

- Find missing mechanics, thresholds, prerequisites, exceptions, cross-system interactions, and scenario-useful facts.
- Flag any wording that is still too close to the source.
- Flag any conversational/tutorial text that should be removed.
- Flag any unsupported additions or assumptions.
- Cross-check the relevant printed PDF pages directly, especially tables, lists, spell trees, examples that define rules, and page-break-sensitive paragraphs.
- Identify every remaining gap. Do not recommend `reviewed-complete` while any gap, `pdf-pending`, `gap-found`, `needs-reparse`, or `scope-decision-needed` item remains for the draft.

Output:

- Findings ordered by severity.
- Required edits.
- Optional improvements.
- PDF review result for each source range checked: `pdf-checked`, `gap-found`, `needs-reparse`, `scope-decision-needed`, or `excluded`.
- Recommended tracking updates for `source-map.md`, `subjects.md`, `review-log.md`, `pdf-review.md`, and `parse-issues.md`.
