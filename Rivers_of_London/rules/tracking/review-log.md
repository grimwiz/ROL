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
- Drafted `00-system-overview.md` from the introduction/glossary material, organised as prerequisites rather than source order.
- Drafted `01-character-model.md` to define characteristics, full/half values, Luck, MOV, skill categories, magic-related sheet values, and damage condition vocabulary.
- Drafted `02-core-resolution.md` covering roll triggers, difficulty, success levels, fumbles, pushing, group rolls, bonus/penalty dice, human limits, Luck, Trying Your Luck, opposed rolls, and impairment effects on rolls.
- Drafted `03-character-creation.md` covering base creation order, occupation requirements, advantages, starting skills, starting practitioner package, backstory, affluence, trusted contacts, starting equipment, weapons, and compact occupation reference tables.
- Recorded a Chapter 1 markdown conversion issue around the Living Standards table heading order for later PDF review.
- Drafted `04-skills.md` covering skill categories, specialisations, all common skills, all expert skills, combat skills, skill-specific difficulty guidance, special cases, and pushed-roll guidance.
- Recorded Chapter 2 markdown ordering issues around Drive/Navigate and Read Lips/Ride for later PDF review.
- Normalised remaining rule destination references in the tracking docs to the numbered logical outline.
- Drafted `09-magic.md` covering vestigia, signare, Newtonian spell structure, spell learning/mastery limits, magic points, casting procedure, mastered/unmastered modifiers, pushed spellcasting, exceptional circumstances, combat spellcasting, boosting, detecting spells, technology sanding, and HTD.
- Corrected the Sense Vestigia weak-vestigia summary in `04-skills.md` to include Regular success detecting the main element.
- Recorded the malformed Signare table as a Chapter 4 PDF-check item.
- Added `tracking/pdf-review.md` as a hard PDF gate and gap register: no source area or destination file can be marked `reviewed-complete` while PDF checks or extraction gaps remain open.

## 2026-05-21

- Drafted `05-advancement.md` covering the investigator development phase, development point awards and spending, skill increases, new skills, spell learning/mastery limits, advantage costs, backstory review, employment/affluence review, and downtime training.
- Drafted `06-combat.md` covering combat rounds, turn order, NPC handling, actions, movement, the six-step combat procedure, responses, opposed and unopposed combat rolls, combat manoeuvres, outnumbering, armour, ranged modifiers, cover, aiming, reloading, multiple shots, shooting into melee, thrown weapons, combat bonus/penalty overflow, fumbles, and firearm malfunctions.
- Drafted `07-damage-and-healing.md` covering damage rolls, spell damage, damage conditions, fatal blows, post-fight recovery, mortal wounds, first aid, medical aid, mortal-wound consequences, impairment recovery, other forms of damage, asphyxiation/drowning, and poison.
- Drafted `08-chases.md` covering foot chases, chase turn structure, burst of speed, negotiating obstacles, Luck and pushing, fleeing, pursuing, multiple NPCs, ranged attacks during chases, vehicle chases, vehicular combat, vehicle damage, control rolls, firearms against vehicles, repairs, and the vehicle table.
- Left Chapter 3 as `extracted-draft`: the markdown source has ordering/interleaving issues in combat, Appendix B is explicitly untrusted as canonical, and the PDF gate remains open.
