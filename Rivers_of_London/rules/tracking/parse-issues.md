# Parse Issues

Record specific markdown conversion problems that should be checked against the PDF or reparsed before extraction. Track the overall page-range PDF gate and open extraction gaps in `pdf-review.md`.

## Seeded Issues From Initial Inspection

| Source | Issue | Action |
|---|---|---|
| Whole markdown file | Page numbers, decorative images, and page headers appear as standalone headings or image references. | Ignore as extraction content; use printed page numbers in source map for review. |
| Table of contents | The converted table is split across columns and includes noisy punctuation. | Use only for initial page routing; verify exact ranges during extraction. |
| Appendix B: Rules Summaries | Some bullets appear out of order, especially combat steps and magic summary material. | RESOLVED FOR BASE RULES 2026-05-23: checked directly against PDF p.350-360 as a checklist for `00`-`11`; no standalone quick-reference output is required unless requested later. |
| Chapter 5: police acronyms/slang table | The final rows appear malformed and duplicated in markdown. | RESOLVED 2026-05-23: checked Table 12 directly against PDF p.214-216 and extracted a cleaned glossary into `scenario/policing-and-investigations.md`. |
| Spell trees and some tables | Several tree/table layouts may be image-only or split by page artifacts. | Chapter 4 spell list/trees were checked against rendered PDF pages on 2026-05-23. Keep this issue open for later tables/trees outside the Chapter 4 spell catalog. |
| Chapter 3 damage/combat tables | Large tables may be split by images or page breaks. | RESOLVED 2026-05-23: Chapter 3 tables and prose were checked against the PDF; `02`, `05`, `06`, `07`, and `08` are reviewed-complete for the basic rules corpus. |
| Chapter 7 maps and location references | Map numbers appear in headings and text; images are not directly useful as prose. | Extract only useful location facts; track any map-dependent uncertainty. |
| Character sheets and handouts after the index | OCR includes form labels and layout fragments. | Exclude unless a later app-specific task needs field mapping. |

## Raw Source Builder Notes

- `npm run extract:source` writes to `private/extracted-source/` and excludes *The Domestic* and Chapter 8 by default.
- The builder strips image references and isolated page/chapter marker lines, but it does not repair malformed tables.
- The raw seed is meant to be adequate for LLM inventory and drafting, not a substitute for PDF checks on damaged tables or layout-dependent material.

## New Issues

Add new entries here using:

```text
YYYY-MM-DD - Source/page:
Problem:
Decision or next check:
```

2026-05-20 - Chapter 1, Living Standards table:
Problem:
The markdown conversion appears to place the Wealthy heading before the Poor affluence text, likely due to page/image layout.
Decision or next check:
`03-character-creation.md` follows the surrounding prose and the apparent four-bracket order: Poor, Average, Wealthy, Rich. Check the PDF table before marking Chapter 1 reviewed-complete.
RESOLVED 2026-05-22: PDF printed p.58 confirms the table layout reads Poor, Average (left column), Wealthy, Rich (right column). Draft order and bracket details are correct. No fix needed.

2026-05-20 - Chapter 2, Drive/Navigate difficulty bullets:
Problem:
The markdown appears to split or misplace one difficulty bullet around Drive and Navigate, placing heavy-traffic pursuit near Navigate.
Decision or next check:
`04-skills.md` assigns light/heavy traffic pursuit to Drive and route/landmark problems to Navigate. Check the PDF before marking Chapter 2 reviewed-complete.
RESOLVED 2026-05-22: PDF printed p.83-84 confirms both traffic-pursuit bullets (light = Regular, heavy = Hard) belong to Drive; Navigate's bullets are own-city route (Regular) and no-landmark/unfamiliar-city (Hard). Draft is correct. No fix needed.

2026-05-20 - Chapter 2, Read Lips/Ride page break:
Problem:
The opening Read Lips paragraph appears split by a page break and partly inserted under the Ride section.
Decision or next check:
`04-skills.md` reconstructs Read Lips from the surrounding lines: line of sight, one visible speaker gives only that side, and proficient users can communicate silently. Check the PDF before marking Chapter 2 reviewed-complete.
RESOLVED 2026-05-22: PDF printed p.96-97 confirms the Read Lips reconstruction. Ride scope corrected: the draft had added "breaking in riding animals" and "controlling mounts", which are not in the source; rewritten as a paraphrase of the actual scope (care, tack, control at gallop / difficult ground).

2026-05-20 - Chapter 4, Table 10 Signare:
Problem:
The Signare table columns are shifted and several dice-roll rows are malformed in the markdown.
Decision or next check:
`09-magic.md` keeps the signare creation procedure but does not reproduce the malformed random table. Check the PDF if a random signare generator is needed later.
RESOLVED 2026-05-22: PDF printed p.164-169 checked. Table 10 is a 100-row 1D100 table over three columns (Sound / Smell / Other Sensation). The full table has been transcribed from the PDF into `09-magic.md` (needed for rules compatibility). The creation procedure was also corrected: three sensory categories; pick one per category or roll on all three and keep any two; trained practitioners carry over one element of the teacher's signare.

2026-05-21 - Chapter 3 combat and chase ordering:
Problem:
The markdown and Appendix B summaries contain displaced combat step ordering. Some response examples, chase Luck bullets, and vehicle combat bullets are interleaved with neighbouring sections.
Decision or next check:
`06-combat.md` and `08-chases.md` use the surrounding Chapter 3 prose as primary source and Appendix B only as a checklist. Verify the final procedure order against the PDF before marking Chapter 3 complete.
RESOLVED 2026-05-22: PDF printed p.126-128 and p.151-157 checked. The six-step combat sequence (Set Goal, Target Responds, Dice Rolls, Damage Roll, Narration, Next Turn) and the four responses (Do Nothing, Dodge/Dive for Cover, Fight Back, Flee, with correct use limits) match `06-combat.md`. The chase steps, burst-of-speed/obstacle rolls, the "first to two" win condition, the post-catch-up "two consecutive" continuation rule, and vehicular combat all match `08-chases.md`. No ordering errors found; codex's reconstruction is correct.

2026-05-21 - Chapter 3 tables:
Problem:
Firearms, cover protection, other damage, and vehicle tables appear usable in markdown but may contain conversion or ordering errors.
Decision or next check:
Check each table against the printed PDF before marking Chapter 3 complete.
RESOLVED 2026-05-22: PDF checked - Table 5 Firearms (p.132), Table 6 Cover Protection (p.138), Table 7 Other Forms of Damage (p.149), Table 8 Vehicles (p.159). All four tables match the drafts (`06-combat.md`, `07-damage-and-healing.md`, `08-chases.md`) exactly. No conversion or ordering errors.

2026-05-23 - Chapter 4 spell catalog and trees:
Problem:
The markdown source interleaves some adjacent spell text and loses the visual spell-tree structure on printed p.179, 181, and 185.
Decision or next check:
RESOLVED 2026-05-23: Rendered and checked the spell list plus Impello and Shield trees from the PDF. `10-spells.md` uses the PDF text for p.178-193 and corrects the markdown interleaves: Bumblebee text stays with Bumblebee, Grasping Hand damage stays with Grasping Hand, and Impello Vibrato collapse timing stays with Impello Vibrato rather than Light Bulb.

2026-05-23 - Chapter 9 optional rules:
Problem:
The markdown source interleaves several Chapter 9 sections and tables, including age/MOV ordering, organisation prompts, non-Newtonian ability text, alternative damage bullets, and the poison table.
Decision or next check:
RESOLVED 2026-05-23: Drafted `../rules-advanced-source/12-advanced-options.md` from PDF-checked printed p.309-335, including lower-fae/Quiet Person PC rules from p.318-321. Table 14 Optional Hit Locations and Table 15 Poisons were checked against the PDF. Case-writing guidance p.336-342 remains in `scenario/case-design.md`.

2026-05-23 - Basic rules corpus contamination:
Problem:
Optional lower-fae and Quiet Person player-investigator rules were drafted in app-facing `11-demi-monde.md`, which meant wildcard rule loading could treat them as basic rules.
Decision or next check:
RESOLVED 2026-05-23: moved those optional PC rules to `../rules-advanced-source/12-advanced-options.md`; `11-demi-monde.md` now keeps only base demi-monde mechanics and creature-facing rules.
