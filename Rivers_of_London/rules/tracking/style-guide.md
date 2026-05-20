# Extraction Style Guide

## Audience

Write for experienced tabletop roleplayers who need a complete reference, not a tutorial. Assume they understand GM/player roles, dice notation, scenes, NPCs, combat rounds, and skill checks.

## Copyright Posture

- Rewrite explanations in original, compact wording.
- Preserve mechanical facts: names, numbers, thresholds, skill names, spell names, prerequisites, table values, and procedural order.
- Do not copy long examples, fiction, jokes, boxed conversational advice, or flavour text.
- Use source examples only when they define a rule edge case; then rewrite them as terse rule notes.
- Do not reproduce illustrations, maps, handouts, or character prose unless a later task explicitly requires an asset inventory.

## Voice

- Use reference prose: direct, neutral, and terse.
- Prefer bullets, tables, formulas, and short definitions.
- Avoid conversational markers such as "you should", "we", "let's", "remember", and "have fun".
- Avoid teaching digressions. If a note is useful only for new roleplayers, omit it.

## Rules Completeness

Do not follow the rulebook's original teaching sequence by default. Present prerequisites before dependent mechanics, group related procedures together, and move repeated reminders into a single canonical rule note.

Every extracted rule section must preserve:

- Required rolls and who rolls them.
- Difficulty levels, thresholds, success levels, and fumble ranges.
- When Luck may and may not be spent.
- Prerequisites, limits, exceptions, and optional status.
- Interactions between subsystems, such as combat modifiers carrying into damage or magic using ranged attack procedures.
- Any rule that would disadvantage a player who learned from the extracted files instead of the full rulebook.

## Scenario Material

Put material in `scenario/` when it helps run or write a case:

- Folly roles, places, records, procedures, and constraints.
- Police process, ranks, powers, resources, and terminology.
- London locations and supernatural context.
- Organisations, NPC-useful summaries, case seeds, and GM procedures.

Do not include general prose that only establishes mood unless it changes scenario decisions.

## Tables

- Keep tables for dense mechanical data.
- Rewrite descriptive cells where possible.
- Preserve exact numbers, costs, dice modifiers, and prerequisites.
- Mark `parse-issues.md` if the markdown table looks split, reordered, or image-derived.

## Tracking Discipline

Before extracting:

- Build or refresh the raw source seed with `npm run extract:source` if the working source may be stale.
- Check `source-map.md` for destination and current status.
- Check `pdf-review.md` for the required PDF gate status and open gaps.
- Check `parse-issues.md` for known conversion concerns.
- Use the prompt sequence in `prompts/` when asking an LLM to inventory, outline, draft, or review extracted files.

After extracting:

- Update `source-map.md` status and notes.
- Update `pdf-review.md` when a printed page range has been checked, a gap is found, or a gap is closed.
- Update `subjects.md` if a topic moved or a new subject appears.
- Add a dated note to `review-log.md`.
- Add unresolved source doubts to `parse-issues.md`.

## Definition of Done

A file is ready for review when it is mechanically complete for its scope, visibly paraphrased, free of tutorial tone, and linked back to reviewed source sections in the tracking files.

A file is only complete when every source range feeding it is `pdf-checked` or explicitly `excluded` in `pdf-review.md`, every discovered gap has been fixed or intentionally omitted, and no relevant `parse-issues.md` entry remains open.
