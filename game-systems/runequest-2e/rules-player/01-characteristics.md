# Characteristics and Derived Attributes

<!-- Source: rulebook ch.II p8-11 (characteristics, category modifiers, hit points, damage bonus) + appendix A p123 (consolidated tables). Status: extracted-draft. -->

The seven characteristics are the foundation of an adventurer. For a human, **roll `3D6`** for each (range 3–18). Other species use different ranges and dice (see `11-monsters.md`).

## The Seven Characteristics

| Abbrev. | Characteristic | Governs |
|---|---|---|
| STR | Strength | Damage done, armour worn, weapons usable. |
| CON | Constitution | Health; the main factor in Hit Points; resists poison and disease. |
| SIZ | Size | Mass; affects Hit Points and damage; large is easier to hit and to spot. |
| INT | Intelligence | Skill learning, spells memorised; never changes naturally. |
| POW | Power | Magic ability and magic points; the measure of the soul; fluctuates in play. |
| DEX | Dexterity | Speed and accuracy; strike rank; many skills. |
| CHA | Charisma | Leadership; cost of training; number of spells effectively carried. |

## Raising and Capping Characteristics

- **STR, CON, DEX** can be raised by training (see `05-advancement.md`); **POW** rises through magical success (`08-magic.md`).
- **STR** and **CON** each train only up to the highest of STR/CON/SIZ. Whichever of the three is already highest cannot be trained (only magic raises it).
- **SIZ** and **INT** never change except by magic/miraculous means.
- **CHA** rises and falls with the adventurer's deeds.
- A human's species maximum for a trainable characteristic is `21` (DEX, STR, CON to their cap).

## Category Modifiers

Each ability falls into a category; high or low characteristics give a percentage bonus or penalty to that category, summed to the adventurer's **natural ability** before training. A category total may be negative, zero, or positive. Values are added per the characteristic's value band.

| Category | Char. | 01-04 | 05-08 | 09-12 | 13-16 | 17-20 | each +4 |
|---|---|---:|---:|---:|---:|---:|---:|
| **Attack** | STR | −05% | — | — | +05% | +05% | — |
| | INT | −10% | −05% | — | +05% | +10% | +05% |
| | POW | −05% | — | — | +05% | +05% | — |
| | DEX | −10% | −05% | — | +05% | +10% | +05% |
| **Parry** | STR | −05% | — | — | +05% | +05% | — |
| | SIZ | +05% | — | — | −05% | −05% | — |
| | POW | −05% | — | — | +05% | +05% | — |
| | DEX | −10% | −05% | — | +05% | +10% | +05% |
| **Defense** | SIZ | +05% | — | — | −05% | −05% | — |
| | INT | −10% | −05% | — | +05% | +10% | +05% |
| | POW | −05% | — | — | +05% | +05% | — |
| | DEX | −10% | −05% | — | +05% | +10% | +05% |
| **Perception** | INT | −10% | −05% | — | +05% | +10% | +05% |
| | POW | −05% | — | — | +05% | +05% | — |
| **Stealth** | SIZ | +10% | +05% | — | −05% | −10% | −05% |
| | INT | −10% | −05% | — | +05% | +10% | +05% |
| | POW | +05% | — | — | −05% | −05% | — |
| | DEX | −10% | −05% | — | +05% | +10% | +05% |
| **Manipulation** | STR | −05% | — | — | +05% | +05% | — |
| | INT | −10% | −05% | — | +05% | +10% | +05% |
| | POW | −05% | — | — | +05% | +05% | — |
| | DEX | −10% | −05% | — | +05% | +10% | +05% |
| **Knowledge** | INT | −10% | −05% | — | +05% | +10% | +05% |
| | POW | −05% | — | — | +05% | +05% | — |
| **Oratory** | INT | −10% | −05% | — | +05% | +10% | +05% |
| | POW | −05% | — | — | +05% | +05% | — |
| | CHA | −10% | −05% | — | +05% | +10% | +05% |

**Defense** is unusual: it is purely a natural ability (no base, learned only through use), and it is **subtracted from an attacker's chance to hit**. It improves when it saves the character (roll INT or less on `D100`) — the one ability that improves by *succeeding* rather than by the usual experience check (`02-core-resolution.md`).

## Hit Points

Hit Points = **CON**, modified (in *points*, not percent) by SIZ and POW:

| Char. | 01-04 | 05-08 | 09-12 | 13-16 | 17-20 | each +4 |
|---|---:|---:|---:|---:|---:|---:|
| SIZ | −2 | −1 | — | +1 | +2 | +1 |
| POW | −1 | — | — | +1 | +1 | — |

A human can never have fewer than **3** Hit Points when undamaged. At **2 or 1** HP the character is unconscious; at **0 or less** the character is dead. (Example: CON 12, SIZ 17, POW 18 → 15 HP.) Damage by hit location is in `07-damage-and-healing.md`.

## Damage Bonus

From the **average of STR and SIZ** (round a `½` result up), added to melee and thrown damage:

| avg(STR, SIZ) | Damage bonus |
|---|---|
| 01-06 | −1D4 |
| 07-12 | none |
| 13-16 | +1D4 |
| 17-20 | +1D6 |
| each +8 | +1D6 more |

## Magic Points

An adventurer's **magic points equal his current POW**. They are spent to cast spells and to resist hostile magic, and recover with rest; successful casting can permanently raise POW (`08-magic.md`). POW also feeds the Resistance Table (`02-core-resolution.md`).
