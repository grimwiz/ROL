# Source Map

Last seeded: 2026-05-20. Last updated: 2026-05-23.

The final extracted corpus should be ordered by conceptual dependency, not by the rulebook's paragraph order. The source map tracks coverage; it does not define final reading order.

Status values:

- `unreviewed` - not yet checked against extraction goals.
- `parsed-ok` - markdown appears usable, but content has not been rewritten.
- `needs-pdf-check` - markdown, table, order, or OCR quality is doubtful.
- `extracted-draft` - paraphrased content exists but has not had completion review.
- `reviewed-complete` - extracted content has passed source coverage, style review, and the PDF gate in `pdf-review.md`.
- `excluded` - intentionally omitted from the extracted corpus.

## Top-Level Coverage

| Source area | Printed pages | Destination | Status | Notes |
|---|---:|---|---|---|
| Front matter, credits, legal text, handout credits, playtesters | front matter | none | excluded | Not play or scenario content. Keep attribution awareness only. |
| Foreword and introductory fiction | 6-9 approx. | none | excluded | Fiction and authorial commentary are not part of the compact corpus. |
| Introduction and overview | 10-16 | `00-system-overview.md`, `scenario/00-table-frame.md` | extracted-draft | Dice basics, glossary, table roles, and system frame drafted in `00-system-overview.md`; scenario framing still pending. |
| The Domestic | 17-42 | none | excluded | Solo game material is explicitly out of scope. Do not mine it for extracted rules unless a later pass identifies a rule missing everywhere else. |
| Chapter 1: Creating Characters | 43-78 | `01-character-model.md`, `03-character-creation.md` | extracted-draft | Character model and base creation procedure drafted, including occupations, advantages, starting skills, starting magic, affluence, contacts, equipment, and weapons. Needs completion review against PDF before `reviewed-complete`. |
| Chapter 2: Skills | 79-102 | `04-skills.md` | extracted-draft | Skill values, specialisations, common skills, expert skills, combat skills, opposition/difficulty notes, and pushing guidance drafted. Needs PDF check for two markdown ordering issues before completion. |
| Chapter 3: Basic Rules | 103-160 | `02-core-resolution.md`, `05-advancement.md`, `06-combat.md`, `07-damage-and-healing.md`, `08-chases.md` | extracted-draft | Core resolution, Luck, opposed rolls, Trying Your Luck, impairment, advancement, combat, damage/healing, chases, and vehicle rules drafted. Needs PDF check before completion. |
| Chapter 4: Newtonian Magic | 161-194 | `09-magic.md`, `10-spells.md` | extracted-draft | Vestigia, signare, magic points, spellcasting, boosting, technology, sensing spells, and HTD drafted in `09-magic.md`; Chapter 4 spell catalog, prerequisites, boosts, and spell-tree dependencies drafted in `10-spells.md`. |
| Chapter 5: Working Together for Stranger London | 195-230 | `scenario/policing-and-investigations.md`, `scenario/gm-procedures.md` | unreviewed | Police structure, investigations, police powers, resources, GM advice, tone, pacing, tech, player issues. |
| Chapter 6: A Rogues' Gallery | 231-258 | `scenario/npcs-and-beings.md`, `11-demi-monde.md` | extracted-draft | Demi-monde mechanics drafted in `11-demi-monde.md`; scenario-facing NPC summaries and stat-block routing remain pending. Avoid reproducing long character prose. |
| Chapter 7: Welcome to London | 259-284 | `scenario/folly-and-london.md`, `scenario/case-seeds.md` | unreviewed | Folly induction, Society history, organisations, building, London orientation, rivers, pubs, nazareths, case seeds. |
| Chapter 8: The Bookshop | 285-308 | `scenario/bookshop-reference.md` | unreviewed | GM-only scenario material. Extract only if useful as reusable scenario reference; do not create a replacement adventure text by default. |
| Chapter 9: Additional Rules | 309-342 | `12-advanced-options.md`, `scenario/case-design.md` | extracted-draft | Optional rules drafted in `12-advanced-options.md`: advanced creation, disadvantages, troupe play, investigator organisations, new skills, higher/custom spells, enchantments, demon traps, rose jars, non-Newtonian ability design, optional combat, alternative damage, and detailed poisons. Lower-fae and Quiet Person PC rules are in `11-demi-monde.md`. Case-writing guidance remains pending for `scenario/case-design.md`. |
| Appendix A: Ready-to-Play Investigators | 343-349 | `pregens.md` or none | unreviewed | Mechanics may be useful as examples/templates; avoid copying backstories. |
| Appendix B: Rules Summaries | 350-360 | `quick-reference.md` | needs-pdf-check | Useful completeness checklist, but initial markdown inspection shows ordering and table issues. |
| Appendix C: Bibliography | 361-362 | none | excluded | Not needed for compact play corpus. |
| Appendix D: Maps and Handouts | 363-369 | scenario assets or none | unreviewed | Do not copy images by default. Use only as source pointers if needed for scenario reference. |
| Index, character sheets, contributor bios, back matter | 370-end | none | excluded | Index can help find subjects; sheets may inform app fields but are not extracted prose. |

## Completion Rule

A section can only be marked `reviewed-complete` when:

- Its destination file contains every rule or scenario fact needed from that source area.
- Any omitted examples, flavour, fiction, or advice are noted as intentionally out of scope.
- The corresponding row in `pdf-review.md` is `pdf-checked` or `excluded`.
- Any uncertain markdown conversion has been checked against the PDF, fixed, and closed in `parse-issues.md`.
- No linked gap remains open in `pdf-review.md`.
- The result follows `style-guide.md`.

## Source Staging

Use `npm run extract:source` to generate `private/extracted-source/rulebook-relevant.md` and its manifest. The raw seed is gitignored and may be sent to an LLM as preparatory source material. Final paraphrased rules files must still be written as numbered Markdown files in `Rivers_of_London/rules/`; scenario files belong in `Rivers_of_London/rules/scenario/`.
