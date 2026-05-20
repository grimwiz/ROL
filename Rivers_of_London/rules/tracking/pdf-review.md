# PDF Review Gate

Last updated: 2026-05-20.

This file tracks the printed-rulebook check. The markdown source and raw LLM seed are useful drafting inputs, but they are not sufficient to mark work complete. Each source range must be compared against the PDF before any destination fed by that range can be marked `reviewed-complete`.

Use printed page numbers from the rulebook, not PDF viewer page indexes. The current PDF source is `private/rulebook-source/cha3200_-_rivers_of_london_1.4.pdf`; keep this tracker using printed page ranges even if the private source path changes later.

## Status Values

- `pdf-pending` - extraction may exist, but the printed pages have not been checked against the PDF.
- `pdf-checked` - the printed page range was compared against the PDF and no unresolved gaps remain.
- `gap-found` - the PDF check found missing, wrong, or under-specified extracted content.
- `needs-reparse` - the PDF contains table, tree, map, handout, or layout material that needs manual extraction or a better parse before drafting can be finished.
- `scope-decision-needed` - the page range may be useful, but inclusion or exclusion has not been decided.
- `excluded` - the page range is intentionally out of scope for this corpus.

## Hard Completion Gate

A source area or destination file is not complete while any feeding source row is `pdf-pending`, `gap-found`, `needs-reparse`, or `scope-decision-needed`.

Only mark a row `pdf-checked` when:

- The destination file has been compared with the printed PDF pages for that source range.
- Tables, lists, spell trees, examples that define rules, and page-break-sensitive paragraphs have been checked directly against the PDF.
- Every missing or incorrect item found during the PDF pass has either been fixed or recorded as an intentional omission.
- Any intentional omission is recorded in `source-map.md`, `subjects.md`, or this file.
- No linked issue remains open in `parse-issues.md`.

## Top-Level PDF Review

| Source area | Printed pages | Destination | Draft status | PDF status | Reviewer/date | Open gaps or checks |
|---|---:|---|---|---|---|---|
| Front matter, credits, legal text, playtesters | front matter | none | excluded | excluded | 2026-05-20 initial scope | Not play or scenario content. |
| Foreword and introductory fiction | 6-9 approx. | none | excluded | excluded | 2026-05-20 initial scope | Fiction and commentary are out of scope. |
| Introduction and overview | 10-16 | `rules/00-system-overview.md`, `scenario/00-table-frame.md` | partial draft | pdf-pending | - | Rules overview drafted; scenario frame still pending. Check glossary, table-role material, and any rule terms not repeated later. |
| The Domestic | 17-42 | none | excluded | excluded | 2026-05-20 user scope | Solo game material excluded unless a later gap search proves a core rule appears nowhere else. |
| Chapter 1: Creating Characters | 43-78 | `rules/01-character-model.md`, `rules/03-character-creation.md` | drafted | pdf-pending | - | Check all character creation steps, occupation tables, advantages, starting resources, weapons, and Living Standards table. |
| Chapter 2: Skills | 79-102 | `rules/04-skills.md` | drafted | pdf-pending | - | Check every skill entry, specialisation, difficulty bullet, pushed-roll note, Drive/Navigate ordering, and Read Lips/Ride split. |
| Chapter 3: Basic Rules | 103-160 | `rules/02-core-resolution.md`, `rules/05-advancement.md`, `rules/06-combat.md`, `rules/07-damage-and-healing.md`, `rules/08-chases.md` | partial draft | pdf-pending | - | Core resolution drafted. Advancement, combat, damage/healing, chases, vehicle rules, and all tables still need drafting and PDF checks. |
| Chapter 4: Newtonian Magic | 161-194 | `rules/09-magic.md`, `rules/10-spells.md` | partial draft | pdf-pending | - | Magic procedure drafted. Check signare table, spell trees, spell prerequisites, spell effects, and HTD details against PDF. |
| Chapter 5: Working Together for Stranger London | 195-230 | `scenario/policing-and-investigations.md`, `scenario/gm-procedures.md` | not drafted | pdf-pending | - | Need extraction and PDF check for police process, powers, resources, acronyms, GM process, and malformed acronym/slang table. |
| Chapter 6: A Rogues' Gallery | 231-258 | `scenario/npcs-and-beings.md`, `rules/11-demi-monde.md` | not drafted | pdf-pending | - | Need rules and scenario-useful summaries only; avoid reproducing long NPC prose. |
| Chapter 7: Welcome to London | 259-284 | `scenario/folly-and-london.md`, `scenario/case-seeds.md` | not drafted | pdf-pending | - | Need Folly, organisations, London, rivers, pubs, nazareths, case seeds, and any map-dependent references checked. |
| Chapter 8: The Bookshop | 285-308 | `scenario/bookshop-reference.md` or none | not drafted | scope-decision-needed | - | Decide whether reusable reference is needed. Do not draft a replacement adventure by default. |
| Chapter 9: Additional Rules | 309-342 | `rules/12-advanced-options.md`, `scenario/case-design.md` | not drafted | pdf-pending | - | Need optional PC rules, advanced combat/damage options, spells/enchantments, organisations, and case design. |
| Appendix A: Ready-to-Play Investigators | 343-349 | `rules/pregens.md` or none | not drafted | scope-decision-needed | - | Decide whether mechanical templates are useful; avoid copying backstories. |
| Appendix B: Rules Summaries | 350-360 | `rules/quick-reference.md` | not drafted | needs-reparse | - | Markdown ordering/table issues. Use as a checklist after primary chapters, then verify directly against PDF. |
| Appendix C: Bibliography | 361-362 | none | excluded | excluded | 2026-05-20 initial scope | Bibliography is out of scope. |
| Appendix D: Maps and Handouts | 363-369 | scenario assets or none | not drafted | scope-decision-needed | - | Decide whether to inventory or cite maps/handouts; do not copy images by default. |
| Index, sheets, contributor bios, back matter | 370-end | none | mostly excluded | scope-decision-needed | - | Index may support gap searches. Character sheets may support app field mapping, but not prose extraction. |

## Gap Register

| Gap | Affected output | Source | Status | Next action |
|---|---|---|---|---|
| Scenario-facing introduction and table frame not yet extracted. | `scenario/00-table-frame.md` | Introduction 10-16 | open | Draft and PDF-check after rules overview is stable. |
| Living Standards table order may be wrong in markdown. | `rules/03-character-creation.md` | Chapter 1, pages 43-78 | open | Compare table directly with PDF before Chapter 1 can be complete. |
| Drive/Navigate difficulty bullets may be split or displaced. | `rules/04-skills.md` | Chapter 2, pages 79-102 | open | Compare skill entries directly with PDF. |
| Read Lips/Ride page break may have displaced text. | `rules/04-skills.md` | Chapter 2, pages 79-102 | open | Compare entries directly with PDF. |
| Advancement, combat, damage/healing, chases, and vehicle rules are not drafted. | `rules/05-advancement.md` through `rules/08-chases.md` | Chapter 3, pages 103-160 | open | Draft from source, then PDF-check all tables and step sequences. |
| Spell catalog, spell prerequisites, and spell trees are not drafted. | `rules/10-spells.md` | Chapter 4, pages 161-194 | open | Extract spell list from PDF-checked source; verify tree/table layout. |
| Signare random table is malformed in markdown. | `rules/09-magic.md` or later tool appendix | Chapter 4, pages 161-194 | open | Decide whether to include a random signare generator; if included, transcribe/check against PDF. |
| Police acronyms/slang table is malformed in markdown. | `scenario/policing-and-investigations.md` | Chapter 5, pages 195-230 | open | Check table directly against PDF during scenario extraction. |
| Appendix B quick-reference cannot be trusted as parsed markdown. | `rules/quick-reference.md` | Appendix B, pages 350-360 | open | Reparse or manually verify against PDF after primary rules are drafted. |
