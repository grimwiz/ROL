# Review Log

Use this as the chronological audit trail for extraction passes.

## 2026-05-20

- Created the extraction scaffold and moved it to `Rivers_of_London/rules/`.
- Seeded the top-level source map from the converted markdown table of contents.
- Chose initial defaults: dedicated extraction folder, tracking scaffold first, functional paraphrase style.
- Left existing `Rivers_of_London/globaldata/` and app-facing files unchanged.
- Marked Appendix B and selected tables as requiring PDF checks because initial markdown inspection showed ordering and table extraction problems.
- Added a gitignored raw-source staging workflow and LLM prompt sequence.
- Recorded that final extracted files should use logical prerequisite order rather than the rulebook's teaching order.
- Added `source-inventory.md` and `logical-outline.md` to define the raw seed quality, final file set, and drafting order.
- Drafted `rules/00-system-overview.md` from the introduction/glossary material, organised as prerequisites rather than source order.
- Drafted `rules/01-character-model.md` to define characteristics, full/half values, Luck, MOV, skill categories, magic-related sheet values, and damage condition vocabulary.
- Drafted `rules/02-core-resolution.md` covering roll triggers, difficulty, success levels, fumbles, pushing, group rolls, bonus/penalty dice, human limits, Luck, Trying Your Luck, opposed rolls, and impairment effects on rolls.
- Drafted `rules/03-character-creation.md` covering base creation order, occupation requirements, advantages, starting skills, starting practitioner package, backstory, affluence, trusted contacts, starting equipment, weapons, and compact occupation reference tables.
- Recorded a Chapter 1 markdown conversion issue around the Living Standards table heading order for later PDF review.
- Drafted `rules/04-skills.md` covering skill categories, specialisations, all common skills, all expert skills, combat skills, skill-specific difficulty guidance, special cases, and pushed-roll guidance.
- Recorded Chapter 2 markdown ordering issues around Drive/Navigate and Read Lips/Ride for later PDF review.
- Normalised remaining rule destination references in the tracking docs to the numbered logical outline.
- Drafted `rules/09-magic.md` covering vestigia, signare, Newtonian spell structure, spell learning/mastery limits, magic points, casting procedure, mastered/unmastered modifiers, pushed spellcasting, exceptional circumstances, combat spellcasting, boosting, detecting spells, technology sanding, and HTD.
- Corrected the Sense Vestigia weak-vestigia summary in `rules/04-skills.md` to include Regular success detecting the main element.
- Recorded the malformed Signare table as a Chapter 4 PDF-check item.
- Added `tracking/pdf-review.md` as a hard PDF gate and gap register: no source area or destination file can be marked `reviewed-complete` while PDF checks or extraction gaps remain open.
