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
| Introduction and overview - base rules frame | 10-16 | `00-system-overview.md` | reviewed-complete | pdf-checked | 2026-05-23 | Rules overview, dice use, glossary terms, and player/GM role framing checked for the base corpus. |
| Introduction and overview - scenario table frame | 10-16 | `scenario/00-table-frame.md` | not drafted | pdf-pending | - | Scenario-facing tone/table-role material still pending outside the basic rules corpus. |
| The Domestic | 17-42 | none | excluded | excluded | 2026-05-20 user scope | Solo game material excluded unless a later gap search proves a core rule appears nowhere else. |
| Chapter 1: Creating Characters | 43-78 | `01-character-model.md`, `03-character-creation.md` | reviewed-complete | pdf-checked | 2026-05-23 | Checked characteristic buy, Luck/MOV, Living Standards, affluence, occupations, full advantage list, starting skill rules, contacts, equipment, weapons, languages, and starting magic. |
| Chapter 2: Skills | 79-102 | `04-skills.md` | reviewed-complete | pdf-checked | 2026-05-23 | Checked full skill catalogue, base values, specialisations, difficulty bullets, pushed-roll notes, and page-break-sensitive Read Lips/Ride material. |
| Chapter 3: Basic Rules | 103-160 | `02-core-resolution.md`, `05-advancement.md`, `06-combat.md`, `07-damage-and-healing.md`, `08-chases.md` | reviewed-complete | pdf-checked | 2026-05-23 | Checked core resolution, Luck, opposed rolls, advancement, combat sequence/responses, manoeuvres, outnumbering, fumbles, firearm malfunctions, damage/healing, other damage, chases, and vehicle rules. |
| Chapter 4: Newtonian Magic | 161-194 | `09-magic.md`, `10-spells.md` | reviewed-complete | pdf-checked | 2026-05-23 | Checked vestigia, signare creation and Table 10, magic points, casting modifiers, pushing, combat casting, boosting, technology sanding, HTD, spell catalogue, and spell tree images. |
| Chapter 5: Working Together for Stranger London | 195-230 | `scenario/policing-and-investigations.md`, `scenario/gm-procedures.md` | drafted | pdf-checked | 2026-05-23 | Checked and drafted: policing structure, investigation flow, evidence, resources, police powers, oversight, and Table 12 acronyms p.195-217 in `scenario/policing-and-investigations.md`; GM process, tone, published-case running, pacing, props/tech, player issues, and boundaries p.218-230 in `scenario/gm-procedures.md`. |
| Chapter 6: A Rogues' Gallery - base demi-monde rules | 231-258 | `11-demi-monde.md` | reviewed-complete | pdf-checked | 2026-05-23 | Checked non-Newtonian fighting/sword rules p.234-235 and demi-monde mechanics p.243-256. Optional lower-fae/Quiet Person PC rules are held in advanced source. |
| Chapter 6: A Rogues' Gallery - scenario NPC summaries | 231-258 | `scenario/npcs-and-beings.md` | not drafted | pdf-pending | - | Scenario-facing NPC summaries still pending. Avoid reproducing long character prose. |
| Chapter 7: Welcome to London | 259-284 | `scenario/folly-and-london.md`, `scenario/case-seeds.md` | not drafted | pdf-pending | - | Need Folly, organisations, London, rivers, pubs, nazareths, case seeds, and any map-dependent references checked. |
| Chapter 8: The Bookshop | 285-308 | `../canonical/cases/bookshop/` | drafted | pdf-checked | 2026-05-23 | Built-in sandbox case drafted from PDF-checked Chapter 8 source: player brief, GM run sheet, cast, clues, locations, handouts, and schematic maps. Content is paraphrased and resettable; no long adventure prose is copied into app-facing rules. |
| Chapter 9: Additional Rules | 309-342 | `../rules-advanced-source/12-advanced-options.md`, `scenario/case-design.md` | drafted | pdf-checked | 2026-05-23 | Checked and drafted optional rules p.309-335, including lower-fae/Quiet Person PC rules p.318-321, in `../rules-advanced-source/12-advanced-options.md`; case-writing guidance p.336-342 in `scenario/case-design.md`. Printed p.342 is a chapter-divider page with no extractable rules text. |
| Appendix A: Ready-to-Play Investigators | 343-349 | `pregens.md` or none | not drafted | scope-decision-needed | - | Decide whether mechanical templates are useful; avoid copying backstories. |
| Appendix B: Rules Summaries | 350-360 | none; checklist for `00`-`11` | checklist-only | pdf-checked | 2026-05-23 | Checked directly against PDF as a base-rule completeness checklist. No standalone quick-reference file is required for this checkpoint. |
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
| Advancement, combat, damage/healing, chases, and vehicle rules require PDF verification. | `05-advancement.md` through `08-chases.md` | Chapter 3, pages 103-160 | closed 2026-05-23 | Full basic-rule prose pass completed for `02`, `05`, `06`, `07`, and `08`, including Luck/opposed-roll prose, combat manoeuvres/outnumbering/fumbles, firearm malfunctions, wounds, mortal wounds, healing, chases, and vehicles. |
| Spell catalog, spell prerequisites, and spell trees are not drafted. | `10-spells.md` | Chapter 4, pages 178-193 | closed 2026-05-23 | Drafted `10-spells.md` from PDF-checked spell text. Verified the spell list and dependency-tree images directly against printed p.179, 181, and 185; repaired markdown interleaving around Bumblebee/Grasping Hand and Impello Vibrato/Light Bulb. |
| Signare random table is malformed in markdown. | `09-magic.md` | Chapter 4, pages 161-194 | closed 2026-05-22 | PDF-checked printed p.164-169 (Table 10). Full 100-row 1D100 table (Sound / Smell / Other Sensation) transcribed into `09-magic.md` as the table is needed for rules compatibility. Creation procedure also corrected: three sensory categories; choose one each or roll all three and keep any two. |
| Police acronyms/slang table is malformed in markdown. | `scenario/policing-and-investigations.md` | Chapter 5, pages 195-230 | closed 2026-05-23 | Checked Table 12 directly against PDF p.214-216 and extracted a cleaned glossary. The raw markdown duplicated the final MIA note across table cells. |
| Appendix B quick-reference cannot be trusted as parsed markdown. | none; checklist for `00`-`11` | Appendix B, pages 350-360 | closed 2026-05-23 | Checked directly against PDF as a base-rule checklist. No standalone quick-reference output is needed unless requested later. |
