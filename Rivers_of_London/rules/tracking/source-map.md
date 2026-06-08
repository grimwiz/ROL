# Source Map

Last seeded: 2026-05-20. Last updated: 2026-06-02.

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
| Introduction and overview - base rules frame | 10-16 | `00-system-overview.md` | reviewed-complete | Dice basics, glossary, investigator/GM roles, and system frame checked for the basic rules corpus. |
| Introduction and overview - scenario table frame | 10-16 | `scenario/getting-started.md` | reviewed-complete | Authored 2026-06-08 and PDF-gated against printed p.10-16: what the game is at the table, session setup (what you need, group size, session length), the who-reads-what spoiler split (players: Ch 1-5 + parts of 7; GM-only: Ch 6 & 8), investigator types (officer/consultant, apprentice/hedge wizard), and setting tone (London 2016, Folly Expansion, British class system). Mechanical frame stays in `00-system-overview.md`; table boundaries/safety advice lives in `scenario/gm-procedures.md` (Ch 5), not the intro. |
| The Domestic | 17-42 | none | excluded | Solo game material is explicitly out of scope. Do not mine it for extracted rules unless a later pass identifies a rule missing everywhere else. |
| Chapter 1: Creating Characters | 43-78 | `01-character-model.md`, `03-character-creation.md` | reviewed-complete | Character model and base creation procedure checked, including occupations, advantages, starting skills, starting magic, affluence, contacts, equipment, and weapons. |
| Chapter 2: Skills | 79-102 | `04-skills.md` | reviewed-complete | Skill values, specialisations, common skills, expert skills, combat skills, opposition/difficulty notes, and pushing guidance checked against the PDF. |
| Chapter 3: Basic Rules | 103-160 | `02-core-resolution.md`, `05-advancement.md`, `06-combat.md`, `07-damage-and-healing.md`, `08-chases.md` | reviewed-complete | Core resolution, Luck, opposed rolls, Trying Your Luck, impairment, advancement, combat, damage/healing, chases, and vehicle rules checked against the PDF. |
| Chapter 4: Newtonian Magic | 161-194 | `09-magic.md`, `10-spells.md` | reviewed-complete | Vestigia, signare, magic points, spellcasting, boosting, technology, sensing spells, HTD, Chapter 4 spell catalog, prerequisites, boosts, and spell-tree dependencies checked against the PDF. |
| Chapter 5: Working Together for Stranger London | 195-230 | `scenario/policing-and-investigations.md`, `scenario/gm-procedures.md` | reviewed-complete | Police structure, investigation procedure, evidence, resources, police powers, oversight, and acronyms in `scenario/policing-and-investigations.md` from p.195-217. GM role, tone, published-case running, agency, group size, pacing, missing clues, props/tech, unexpected actions, player issues, and boundaries in `scenario/gm-procedures.md` from p.218-230. PDF-checked 2026-05-23 (see `pdf-review.md`). |
| Chapter 6: A Rogues' Gallery - base demi-monde rules | 231-258 | `11-demi-monde.md` | reviewed-complete | Demi-monde mechanics checked in `11-demi-monde.md`; optional lower-fae/Quiet Person PC rules moved to advanced source. |
| Chapter 6: A Rogues' Gallery - scenario NPC summaries | 231-258 | `scenario/npcs-and-beings.md` | reviewed-complete | Paraphrased GM-facing index (roles + pointers); no profile prose reproduced. Stat blocks live in `globaldata/npcs/*.json`; being mechanics in `11-demi-monde.md` (and mirrored in `../../rules-advanced/11-demi-monde.md`). PDF-checked (index-only, 2026-06-02): no general mechanics missing. |
| Chapter 7: Welcome to London | 259-284 | `scenario/folly-and-london.md`, `scenario/case-seeds.md` | reviewed-complete | Folly history/Society/organisations, the building tour, police facilities, London Falcon gazetteer, and the rivers/genii locorum in `scenario/folly-and-london.md`; the 12 chapter case hooks in `scenario/case-seeds.md`. Paraphrased GM reference; novel footnote citations and plot-outcome detail trimmed. PDF-gated 2026-06-08 against printed p.259-284 (all 12 seeds verified; bracket numbers cross-checked, Skygarden corrected to (18)). See `pdf-review.md`. |
| Chapter 8: The Bookshop | 285-308 | `../canonical/cases/bookshop/` | reviewed-complete | Built-in sandbox case extracted as canonical case data: player brief, GM run sheet, cast, clues, locations, handouts, and schematic maps. PDF-checked 2026-05-23. It is for app testing and scenario preparation, not an app-facing rules reference. |
| Chapter 9: Additional Rules | 309-342 | `../rules-advanced-source/12-advanced-options.md`, `scenario/case-design.md` | reviewed-complete | Optional rules drafted in `../rules-advanced-source/12-advanced-options.md`: advanced creation, disadvantages, lower-fae and Quiet Person PC rules, troupe play, investigator organisations, new skills, higher/custom spells, enchantments, demon traps, rose jars, non-Newtonian ability design, optional combat, alternative damage, and detailed poisons. The file is kept outside app-facing `rules/` so wildcard rule loading cannot include it accidentally. Case-writing guidance in `scenario/case-design.md`. PDF-checked 2026-05-23 (see `pdf-review.md`). |
| Appendix A: Ready-to-Play Investigators | 343-349 | `globaldata/npcs/{nafeesa-jones,morgan-omans,jordan-schneider,eli-venturini,jules-garland,mina-patel}.json` | reviewed-complete | All six pre-gens extracted 2026-06-08 as unallocated global NPC sheets (`scope: []`) so a GM can assign one to a player to pick up and play. Stat blocks reproduced verbatim from printed p.343-349; backstories paraphrased (not copied). Verified by seeding into a scratch DB. Portraits to be restyled from the Appendix A page crops via `scripts/regenerate-npc-portraits.js` (follow-up sub-step). |
| Appendix B: Rules Summaries | 350-360 | none; checklist for `00`-`11` | reviewed-complete | Checked directly against the PDF as a base-rule completeness checklist. No standalone quick-reference output is required for this checkpoint. |
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

Use `npm run extract:source` to generate `private/extracted-source/rulebook-relevant.md` and its manifest. The raw seed is gitignored and may be sent to an LLM as preparatory source material. Final paraphrased base rules files belong as numbered Markdown files in `Rivers_of_London/rules/`; scenario files belong in `Rivers_of_London/rules/scenario/`. Advanced/optional source summaries that may later mutate base rules belong outside the app-facing rules folder, currently in `Rivers_of_London/rules-advanced-source/`.
