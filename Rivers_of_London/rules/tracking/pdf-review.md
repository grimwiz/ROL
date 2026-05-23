# PDF Review Gate

Last updated: 2026-05-23.

This file tracks the printed-rulebook check. The markdown source and raw LLM seed are useful drafting inputs, but they are not sufficient to mark work complete. Each source range must be compared against the PDF before any destination fed by that range can be marked `reviewed-complete`.

Use printed page numbers from the rulebook, not PDF viewer page indexes. The current PDF source is `private/rulebook-source/cha3200_-_rivers_of_london_1.4.pdf`; keep this tracker using printed page ranges even if the private source path changes later.

## Page Calibration (2026-05-22)

- The PDF has 402 leaves. `PDF page index = printed page number + 1` (uniform; verified across 371 numbered pages).
- Chapter-divider art pages (printed 42, 78, 102, 160, 194, 230, 258, 284, 308, 342) carry no extractable text and need image rendering only if checked.
- A `pdftotext -layout` extraction of every page is staged at `private/extracted-source/pdf-text/full-layout.txt` (split on form-feed; index N = PDF page N). This is the working comparison source for PDF checks; visual-only material (spell trees, maps, image tables) still needs `pdftoppm` rendering.

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
| Introduction and overview | 10-16 | `00-system-overview.md`, `scenario/00-table-frame.md` | partial draft | pdf-pending | - | Rules overview drafted; scenario frame still pending. Check glossary, table-role material, and any rule terms not repeated later. |
| The Domestic | 17-42 | none | excluded | excluded | 2026-05-20 user scope | Solo game material excluded unless a later gap search proves a core rule appears nowhere else. |
| Chapter 1: Creating Characters | 43-78 | `01-character-model.md`, `03-character-creation.md` | drafted | partly pdf-checked | 2026-05-22 | Checked: characteristic buy, Luck/MOV, Living Standards table, affluence, skill base values, languages. Still to check: occupation tables, full advantage list, starting equipment/weapons detail. |
| Chapter 2: Skills | 79-102 | `04-skills.md` | drafted | partly pdf-checked | 2026-05-22 | Checked: Drive, Navigate, Read Lips, Ride (Ride scope fixed). Still to check: remaining skill entries, specialisations, and difficulty bullets. |
| Chapter 3: Basic Rules | 103-160 | `02-core-resolution.md`, `05-advancement.md`, `06-combat.md`, `07-damage-and-healing.md`, `08-chases.md` | drafted | mostly pdf-checked | 2026-05-22 | Checked and accurate: core success levels/difficulty, full advancement, six-step combat + responses, manoeuvres, armour, Tables 5/6/7/8, damage conditions, wounds/healing, mortal wounds, first/medical aid, chases, vehicular combat. Still to check: combat fumbles/malfunctions detail, Luck/opposed-roll prose in `02`. |
| Chapter 4: Newtonian Magic | 161-194 | `09-magic.md`, `10-spells.md` | drafted | partly pdf-checked | 2026-05-23 | Checked: signare creation + Table 10; spell catalog p.178-193; spell list/tree images p.179, 181, 185. Still to check before completion: vestigia detail, magic points, casting modifiers, and HTD prose in `09-magic.md`. |
| Chapter 5: Working Together for Stranger London | 195-230 | `scenario/policing-and-investigations.md`, `scenario/gm-procedures.md` | not drafted | pdf-pending | - | Need extraction and PDF check for police process, powers, resources, acronyms, GM process, and malformed acronym/slang table. |
| Chapter 6: A Rogues' Gallery | 231-258 | `scenario/npcs-and-beings.md`, `11-demi-monde.md` | partial draft | partly pdf-checked | 2026-05-23 | Checked and drafted: non-Newtonian fighting/sword rules p.234-235; demi-monde rules p.243-256. Scenario-facing NPC summaries still pending. |
| Chapter 7: Welcome to London | 259-284 | `scenario/folly-and-london.md`, `scenario/case-seeds.md` | not drafted | pdf-pending | - | Need Folly, organisations, London, rivers, pubs, nazareths, case seeds, and any map-dependent references checked. |
| Chapter 8: The Bookshop | 285-308 | `scenario/bookshop-reference.md` or none | not drafted | scope-decision-needed | - | Decide whether reusable reference is needed. Do not draft a replacement adventure by default. |
| Chapter 9: Additional Rules | 309-342 | `12-advanced-options.md`, `scenario/case-design.md` | partial draft | partly pdf-checked | 2026-05-23 | Checked and drafted: optional rules p.309-317 and p.321-335 in `12-advanced-options.md`; lower-fae/Quiet Person rules p.318-321 in `11-demi-monde.md`. Still pending: case-writing guidance p.336-342 for `scenario/case-design.md`. |
| Appendix A: Ready-to-Play Investigators | 343-349 | `pregens.md` or none | not drafted | scope-decision-needed | - | Decide whether mechanical templates are useful; avoid copying backstories. |
| Appendix B: Rules Summaries | 350-360 | `quick-reference.md` | not drafted | needs-reparse | - | Markdown ordering/table issues. Use as a checklist after primary chapters, then verify directly against PDF. |
| Appendix C: Bibliography | 361-362 | none | excluded | excluded | 2026-05-20 initial scope | Bibliography is out of scope. |
| Appendix D: Maps and Handouts | 363-369 | scenario assets or none | not drafted | scope-decision-needed | - | Decide whether to inventory or cite maps/handouts; do not copy images by default. |
| Index, sheets, contributor bios, back matter | 370-end | none | mostly excluded | scope-decision-needed | - | Index may support gap searches. Character sheets may support app field mapping, but not prose extraction. |

## Gap Register

| Gap | Affected output | Source | Status | Next action |
|---|---|---|---|---|
| Scenario-facing introduction and table frame not yet extracted. | `scenario/00-table-frame.md` | Introduction 10-16 | open | Draft and PDF-check after rules overview is stable. |
| Living Standards table order may be wrong in markdown. | `03-character-creation.md` | Chapter 1, pages 43-78 | closed 2026-05-22 | PDF-checked printed p.58 (Table 2). Draft order Poor/Average/Wealthy/Rich and all bracket details are correct; no fix needed. |
| Drive/Navigate difficulty bullets may be split or displaced. | `04-skills.md` | Chapter 2, pages 79-102 | closed 2026-05-22 | PDF-checked printed p.83-84. Draft correctly assigns light/heavy traffic pursuit to Drive and route/landmark difficulty to Navigate; no fix needed. |
| Read Lips/Ride page break may have displaced text. | `04-skills.md` | Chapter 2, pages 79-102 | closed 2026-05-22 | PDF-checked printed p.96-97. Read Lips correct. Ride scope corrected: removed unsupported "breaking in animals" wording, paraphrased to match the source. |
| Advancement, combat, damage/healing, chases, and vehicle rules require PDF verification. | `05-advancement.md` through `08-chases.md` | Chapter 3, pages 103-160 | mostly closed 2026-05-22 | PDF-checked and confirmed accurate: full advancement/development phase (p.120-122); six-step combat sequence and four responses (p.126-128); Tables 5, 6, 7, 8 (p.132/138/149/159); chase mechanics, continuation, and vehicular combat (p.151-158). Locked values all match. Still pending: full prose pass of wounds/mortal-wounds/healing and combat manoeuvres/outnumbering/fumbles in `06`/`07`, and `02-core-resolution.md` (own row). |
| Spell catalog, spell prerequisites, and spell trees are not drafted. | `10-spells.md` | Chapter 4, pages 178-193 | closed 2026-05-23 | Drafted `10-spells.md` from PDF-checked spell text. Verified the spell list and dependency-tree images directly against printed p.179, 181, and 185; repaired markdown interleaving around Bumblebee/Grasping Hand and Impello Vibrato/Light Bulb. |
| Signare random table is malformed in markdown. | `09-magic.md` | Chapter 4, pages 161-194 | closed 2026-05-22 | PDF-checked printed p.164-169 (Table 10). Full 100-row 1D100 table (Sound / Smell / Other Sensation) transcribed into `09-magic.md` as the table is needed for rules compatibility. Creation procedure also corrected: three sensory categories; choose one each or roll all three and keep any two. |
| Police acronyms/slang table is malformed in markdown. | `scenario/policing-and-investigations.md` | Chapter 5, pages 195-230 | open | Check table directly against PDF during scenario extraction. |
| Appendix B quick-reference cannot be trusted as parsed markdown. | `quick-reference.md` | Appendix B, pages 350-360 | open | Reparse or manually verify against PDF after primary rules are drafted. |
