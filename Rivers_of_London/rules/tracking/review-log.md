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

## 2026-05-22

PDF gate pass. Installed `poppler-utils`/`pypdf`; extracted every PDF page to text at `private/extracted-source/pdf-text/full-layout.txt`. Calibrated the page mapping: `PDF index = printed page + 1`.

Verification standard applied: locked content (numbers, skill/spell/table names, table values, defined game terms, reproduced tables) must match the PDF exactly; editorial prose must be paraphrased and is expected to diverge from the source wording.

Gap Register and parse-issues items checked against the PDF:

- Living Standards table (Ch1, p.58): draft order and bracket details correct; no fix. Gap closed.
- Drive/Navigate difficulty bullets (Ch2, p.83-84): draft correct; no fix. Gap closed.
- Read Lips/Ride (Ch2, p.96-97): Read Lips correct. Fixed `04-skills.md` Ride scope - removed unsupported "breaking in animals"/"controlling mounts" and re-paraphrased to the actual scope. Gap closed.
- Signare (Ch4, p.164-169): transcribed the full 100-row Table 10 (Sound/Smell/Other Sensation) into `09-magic.md` for rules compatibility, and tightened the signare creation procedure (three categories; choose one each or roll all three and keep two). Gap closed.
- Chapter 3 combat/chase ordering (p.126-128, 151-157): six-step sequence, four responses, chase mechanics, "first to two" win, "two consecutive" continuation, and vehicular combat all match the drafts. No ordering errors. Issue closed.
- Chapter 3 tables (Tables 5/6/7/8, p.132/138/149/159): all four match the drafts exactly. No conversion errors. Issue closed.

Additional PDF checks confirmed accurate with no fix needed:

- `01-character-model.md`: 280-point characteristic buy, 30-80 range, blocks of 10, advantage prereqs, Luck 2D10+50, MOV 8, skill base values, language rules.
- `02-core-resolution.md`: success levels (Critical 01, Hard <=half, Regular <=full, Fumble 100, impaired fumble 90+), Regular/Hard difficulty, 70 opposition threshold.
- `05-advancement.md`: development phase stages, 1 DP/session, skill-increase tiers (+10/+5/+1 to 80/90/99), new-skill and spell limits, advantage costs (5/10), training cap.
- `06-combat.md`: combat manoeuvres (STR-50 auto-fail, outcomes), armour values, outnumbered.
- `07-damage-and-healing.md`: damage conditions, post-fight recovery, mortal-wound recovery (choose two), first aid (INT, 1h->2h), medical aid modifiers, other-damage/asphyxiation/poison tables.

Net result: codex's drafts reconstructed Chapters 1-4 accurately from the damaged markdown. Only one factual error was found and fixed (Ride scope); `09-magic.md` gained Table 10 plus a sharper signare procedure.

Still pending: full prose pass of `00-system-overview.md`, the remainder of `03-character-creation.md` and `04-skills.md` skill entries, magic spellcasting/HTD detail in `09-magic.md`, and Chapters 5-9 / Appendices (feed not-yet-drafted files).

## 2026-05-23

- Drafted `10-spells.md` from Chapter 4 printed p.178-193.
- Rendered and checked the visual spell list and spell trees on printed p.179, 181, and 185. Captured order, base cost, prerequisites, mastered prerequisites, boostability, and Society of the Rose tags.
- Corrected known markdown conversion issues while drafting: Bumblebee's mechanical description was separated from its heading, Grasping Hand had Bumblebee text interleaved in the raw markdown, and Impello Vibrato's collapse timing appeared under Light Bulb in the raw markdown.
- Updated tracking files to close the Chapter 4 spell catalog/tree gap. Chapter 4 remains only partly PDF-checked overall because `09-magic.md` still needs a final prose pass for vestigia, magic points, casting modifiers, and HTD.
- Drafted `11-demi-monde.md` from Chapter 6 and Chapter 9 rules material, covering glamour, demi-monde Luck, thematic power, cold iron, genii locorum, ghosts, vampires, playable lower fae, Quiet People, affinities, and non-Newtonian fighting/sword abilities.
- PDF-checked the mechanically dense demi-monde ranges: printed p.234-235 for Mystic Art of Fighting and Wizard's Sword, p.243-256 for demi-monde powers/cold iron/beings/vampires, and p.318-321 for lower-fae and Quiet Person investigator rules.
- Drafted `../rules-advanced-source/12-advanced-options.md` from Chapter 9 optional rules, covering advanced character creation, disadvantages, troupe play, investigator organisations, new skills, combined skills, higher/custom spells, enchantments, demon traps, rose jars, non-Newtonian NPC abilities, optional combat, alternative damage, Luck to resist incapacitation, and detailed poisons.
- PDF-checked Chapter 9 rules ranges p.309-317 and p.321-335. Corrected markdown ordering/table damage around age/MOV, organisation prompts, alternative damage, and poison examples. Case-writing guidance on p.336-342 was left for `scenario/case-design.md` and drafted later in this pass.
- Parked the app-content migration handoff until extraction is complete. Added a design note that advanced options may need to mutate copied base-rule files into a derived `rules-advanced/` corpus rather than being appended as a separate extended section.
- Moved `12-advanced-options.md` out of app-facing `Rivers_of_London/rules/` into `Rivers_of_London/rules-advanced-source/` so wildcard rule loading cannot include optional advanced material accidentally.
- Drafted `scenario/case-design.md` from Chapter 9 case-writing guidance, covering source adaptation, antagonist design, hooks, investigative scenes, active antagonists, clues/notes, conclusions, folklore/location research, and campaign structure. Checked the draft against printed p.336-342; p.342 is a divider page with no extractable text.
- Drafted `scenario/policing-and-investigations.md` from Chapter 5 printed p.195-217, covering Met structure, Folly placement, ranks, equipment, investigation stages, crime scenes, evidence, incident rooms, ABC/Six Ws/TIE, police resources, magical-vs-mundane reporting, police powers, PEACE interviews, oversight, and glossary. Checked malformed Table 12 directly against PDF p.214-216 and closed the parse issue.
- Drafted `scenario/gm-procedures.md` from Chapter 5 printed p.218-230, covering GM role, tone, spirit of place, running published cases, player agency, Nightingale as a resource rather than solution, group size, flashbacks, accuracy vs play, pacing, missing clues, props/tech, unexpected player actions, player issues, and boundaries. This completes the Chapter 5 draft pass and PDF check.
- Completed the final basic-rules PDF gate for app-facing `00`-`11`: intro rules frame, Chapter 1 occupations/advantages/equipment/weapons, Chapter 2 full skill catalogue, Chapter 3 Luck/opposed/combat fumbles/firearm malfunctions/wounds/chases/vehicles, Chapter 4 vestigia/magic points/casting modifiers/HTD, and Appendix B as a checklist.
- Moved optional lower-fae and Quiet Person player-investigator rules out of app-facing `11-demi-monde.md` and into `../rules-advanced-source/12-advanced-options.md`, keeping `11-demi-monde.md` to base demi-monde mechanics and creature-facing rules.
- Marked the basic rules corpus `00-system-overview.md` through `11-demi-monde.md` as `reviewed-complete`. Remaining extraction work is scenario/lore/Bookshop/appendix support, not a blocker for advanced-rule mutation planning.
- Drafted a canonical built-in Bookshop sandbox under `../canonical/cases/bookshop/` from PDF-checked Chapter 8 source. The live case is intentionally paraphrased into player brief, GM run sheet, cast, clues, locations, handouts, and schematic maps rather than reproducing long adventure prose.
- Added startup/reset plumbing for the Bookshop as a normal session marked by `system_key = bookshop`; the live copy is seeded into `data/sessions/the-bookshop/` and can be reset from the canonical archive.
- Added canonical Bookshop NPC allocation: Warwick Anderson, Saffron Jackson, PC Karnam Singh, Ernie, and the Spirit of Books and Reading are imported from JSON-backed NPC sheets whose `scope` includes The Bookshop. Reset ensures the cast is allocated without creating per-case sheet copies.
- Linked existing global NPC sheets referenced by the Bookshop case: DCI Thomas Nightingale, DC Peter Grant, and Toby carry the same Bookshop `scope` and are allocated alongside the local case cast.
