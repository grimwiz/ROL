# Parse Issues

Record specific markdown conversion problems that should be checked against the PDF or reparsed before extraction. Track the overall page-range PDF gate and open extraction gaps in `pdf-review.md`.

## Seeded Issues From Initial Inspection

| Source | Issue | Action |
|---|---|---|
| Whole markdown file | Page numbers, decorative images, and page headers appear as standalone headings or image references. | Ignore as extraction content; use printed page numbers in source map for review. |
| Table of contents | The converted table is split across columns and includes noisy punctuation. | Use only for initial page routing; verify exact ranges during extraction. |
| Appendix B: Rules Summaries | Some bullets appear out of order, especially combat steps and magic summary material. | Check against PDF before using as canonical quick-reference source. |
| Chapter 5: police acronyms/slang table | The final rows appear malformed and duplicated in markdown. | Check PDF table before extracting. |
| Spell trees and some tables | Several tree/table layouts may be image-only or split by page artifacts. | Check PDF or image artifacts before extracting spell prerequisites and branching dependencies. |
| Chapter 3 damage/combat tables | Large tables may be split by images or page breaks. | Verify against PDF before marking any damage/combat section complete. |
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
`rules/03-character-creation.md` follows the surrounding prose and the apparent four-bracket order: Poor, Average, Wealthy, Rich. Check the PDF table before marking Chapter 1 reviewed-complete.

2026-05-20 - Chapter 2, Drive/Navigate difficulty bullets:
Problem:
The markdown appears to split or misplace one difficulty bullet around Drive and Navigate, placing heavy-traffic pursuit near Navigate.
Decision or next check:
`rules/04-skills.md` assigns light/heavy traffic pursuit to Drive and route/landmark problems to Navigate. Check the PDF before marking Chapter 2 reviewed-complete.

2026-05-20 - Chapter 2, Read Lips/Ride page break:
Problem:
The opening Read Lips paragraph appears split by a page break and partly inserted under the Ride section.
Decision or next check:
`rules/04-skills.md` reconstructs Read Lips from the surrounding lines: line of sight, one visible speaker gives only that side, and proficient users can communicate silently. Check the PDF before marking Chapter 2 reviewed-complete.

2026-05-20 - Chapter 4, Table 10 Signare:
Problem:
The Signare table columns are shifted and several dice-roll rows are malformed in the markdown.
Decision or next check:
`rules/09-magic.md` keeps the signare creation procedure but does not reproduce the malformed random table. Check the PDF if a random signare generator is needed later.
