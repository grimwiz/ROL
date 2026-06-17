# Character Model

<!-- Advanced corpus: derived from rules/01-character-model.md. Advanced mutations marked with (Advanced option) labels and <!-- Advanced: --> comments. -->

This file defines the recurring numbers and sheet terms used by the rest of the rules.

## Core Characteristics

Investigators have five percentile characteristics.

| Abbrev. | Characteristic | Main use |
|---|---|---|
| STR | Strength | Physical power, lifting, gripping, melee damage rolls. |
| CON | Constitution | Health, endurance, resistance to poison, disease, injury, and some spell effects. |
| DEX | Dexterity | Speed, agility, fine manipulation, combat order, ranged and spell damage rolls. |
| INT | Intelligence | Learning, recall, analysis, puzzle-solving, general knowledge. |
| POW | Power | Will, magical aptitude, resistance to magic, base magic points. |

Starting investigators distribute 280 points among STR, CON, DEX, INT, and POW.

- Starting values must be from 30 to 80.
- Starting values are assigned in blocks of 10.
- 50 is average human capability.
- Some advantages require STR, CON, DEX, INT, or POW 60+.

<!-- Advanced: Free Characteristic Allocation | supplement -->
*Advanced option (Free Characteristic Allocation, GM permission required):* the 280 points may instead be assigned in any values, not just blocks of 10. The standard 30 to 80 range still applies; the GM may widen it to 20 to 90 for more exceptional investigators. When this option is used, round half characteristic values down. See `03-character-creation.md`.

## Full and Half Values

Each characteristic and most skills have:

- Full value: the listed percentile rating.
- Half value: full value divided by 2.

Half values are the target for Hard difficulty rolls. A shorthand such as `60/30` means full value 60 and half value 30.

## Characteristic Scale

Use these values as rough interpretation anchors.

| Rating | Meaning |
|---:|---|
| 0 | Absent or nonfunctional; for CON, dead. |
| 10 | Extremely poor human capability. |
| 30 | Weak or underdeveloped. |
| 50 | Average human capability. |
| 90 | Exceptional human capability. |
| 99 | Human maximum for most characteristics. |
| 100+ | Beyond normal human limits. |

POW can exceed 100 for rare humans and demi-monde beings.

## Luck

Starting Luck for an investigator is:

```text
2D10 + 50
```

Luck changes during play. It is used for Luck rolls and can be spent under the Luck rules.

Most human NPCs do not need Luck. Important NPCs, genii locorum, fae, and beings granted a genius loci's favour may have Luck.

## Movement Rate

Movement Rate (`MOV`) measures how far a character can move when time and distance matter.

- Starting investigators default to `MOV 8`.
- In one combat round, a character can move up to five times MOV in metres/yards.
- `MOV 8` therefore permits up to 40 metres/yards in one combat round.

<!-- Advanced: Age and MOV | supplement -->
### Age and MOV (Advanced option)

Use this optional table if age should have a mechanical effect. It is intended for mundane human characters; magically affected characters may be exempt. Apply the adjustment after calculating the investigator's normal MOV.

| Age | MOV adjustment |
| --- | ---: |
| 40s | `-1` |
| 50s | `-2` |
| 60s | `-3` |
| 70s | `-4` |
| 80s | `-5` |

## Skills

Skills are percentile ratings used for trained, learned, or practised actions.

| Category | Base value | Notes |
|---|---:|---|
| Common skills | 30% | Broad actions everyone can attempt. |
| Combat skills | 30% | Fighting and Firearms. |
| Expert skills | 00% | Specialist knowledge; normally unavailable unless selected or otherwise granted. |

During standard character creation, selected skills are boosted to 60%.

Skill capability bands:

| Skill value | Capability |
|---:|---|
| Below 50% | Amateur or basic training. |
| 50%-69% | Professional competence. |
| 70%-89% | Expert competence. |
| 90%+ | Master-level competence. |

## Common Skills

- Athletics
- Drive
- Navigate
- Observation
- Read Person
- Research
- Sense Vestigia
- Social
- Stealth

## Combat Skills

- Fighting
- Firearms

Combat skills cannot be pushed.

## Expert Skills

- Accounting
- Animal Handling
- Appraise
- Art/Craft, with specialisations
- Computer Use
- Demolitions
- Disguise
- Diving
- History
- Languages, with specialisations
- Law
- Locksmith
- Magic
- Mechanical Repair
- Medicine
- Occult
- Pilot Aircraft
- Pilot Boat
- Read Lips
- Ride
- Science, with specialisations
- Sleight of Hand
- Survival
- Tech
- Track

Some named expert skills are handled as specialisations of broader skills:

| Listed subject | Use |
|---|---|
| Acting, Fine Art, Forgery, Photography | Art/Craft |
| Archaeology, Astronomy, Biology, Botany, Chemistry, Cryptography, Engineering, Forensics, Geology, Mathematics, Meteorology, Pharmacy, Physics, Zoology | Science |

## Specialisations

Art/Craft, Languages, and Science require a specialisation rather than a generic rating.

An alternate specialisation may be allowed when there is meaningful overlap. The GM may increase the difficulty or apply a penalty die.

## Languages

An investigator's own language is free at the higher of:

- INT
- 60%

If raised bilingually, an investigator may receive a second language for free:

- Equal to the first language if equally fluent.
- Half INT or 30%, whichever is higher, if less fluent.

More than two starting languages normally requires selecting Languages as one of the investigator's skill choices.

## Magic-Related Ratings

The Magical advantage controls access to the Magic skill during standard character creation.

An investigator with the Magical advantage and Magic skill starts with:

- Magic skill at 60%.
- Sense Vestigia at 60% for free.
- Three spells: one mastered and two unmastered.
- A signare.
- Magic points equal to one-fifth POW, plus 1 for the mastered spell.

Maximum magic points later increase by 1 each time the character masters another spell.

## Damage Conditions

Damage in a fight is cumulative until the fight ends.

| Damage state | Trigger | Core effect |
|---|---|---|
| Hurt | Total damage reaches 1 | Pain or minor injury; no mechanical penalty. |
| Bloodied | Total damage reaches 2 | Character is impaired. |
| Down | Total damage reaches 3+ | Character is incapacitated and impaired. |
| Mortal Wound | 4 damage from one blow | Character is down and needs medical aid to survive. |
| Fatal Blow | 5+ damage from one attack | Investigator dies unless 30 Luck is spent immediately to reduce it to a Mortal Wound. |

Only investigators can spend Luck to avoid certain death.

Full wound, healing, impairment, and damage roll rules belong in `07-damage-and-healing.md`.
