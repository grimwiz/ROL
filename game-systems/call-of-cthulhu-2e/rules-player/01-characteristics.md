# Characteristics and Derived Attributes

<!-- Source: rulebook p9-11 (Characteristic Rolls, Other Characteristics, Damage Bonus Table). Status: reviewed-complete (PDF-gated 2026-06-16; rolls + Damage Bonus Table verified vs p-054/056, removed unsourced EDU-aging rule). -->

This file defines the recurring numbers and sheet terms used by the rest of the rules. The character-creation procedure that applies them is in `03-character-creation.md`.

## Core Characteristics

Investigators have nine characteristics. The first eight rate physical and mental ability; Sanity is derived (see below).

| Abbrev. | Characteristic | Roll | Main use |
|---|---|---|---|
| STR | Strength | `3D6` | Lifting and gripping; melee damage bonus. |
| CON | Constitution | `3D6` | Health, endurance; resists poison and disease. Not lowered by injury. |
| SIZ | Size | `2D6+6` | Combined height and weight; affects HP and damage bonus. |
| INT | Intelligence | `2D6+6` | Reasoning and perception; sets the Idea roll. |
| POW | Power | `3D6` | Will and magical aptitude; sets Luck, Magic Points, and starting Sanity. |
| DEX | Dexterity | `3D6` | Speed and agility; higher DEX acts first in combat. |
| APP | Appearance | `3D6` | Physical and social attractiveness. |
| EDU | Education | `3D6+3` | Years of effective study; sets the Know roll. |
| SAN | Sanity | derived | Mental stability (see `07-sanity.md`). |

Human characteristics range roughly 3-18 on these rolls; SIZ, INT, and EDU skew higher. NPCs from less-educated backgrounds may roll EDU on `2D6` or `1D6`.

## Derived Attributes

| Attribute | Formula | Notes |
|---|---|---|
| Idea roll | INT × 5 | `D100` target to deduce or recognise. |
| Luck roll | POW × 5 | `D100` target for chance and circumstance. |
| Know roll | EDU × 5 | `D100` target to recall general knowledge. |
| Magic Points (MP) | = POW | Spent to cast spells; regenerate at ¼ POW per 6 hours. At `0` MP the character falls unconscious. |
| Sanity (SAN) | = POW × 5 | Starting value. Maximum SAN is `99 − Cthulhu Mythos %`. |
| Hit Points (HP) | (SIZ + CON) ÷ 2 | Round as the Keeper prefers; at `0` HP the character dies. |
| Damage Bonus | from STR + SIZ | See the Damage Bonus Table below. |
| Move | `8` | Metres per combat round on foot; humans move 8. |

## Damage Bonus Table

Index STR + SIZ. The result is added (as dice) to every melee blow and natural-weapon attack. Half the damage bonus is added to thrown-object damage (a `+2D6` bonus adds `+2D3` when throwing).

| STR + SIZ | Damage Bonus |
|---|---|
| 02 to 12 | −1D6 |
| 13 to 16 | −1D4 |
| 17 to 24 | none |
| 25 to 32 | +1D4 |
| 33 to 40 | +1D6 |
| 41 to 56 | +2D6 |
| 57 to 72 | +3D6 |
| 73 to 88 | +4D6 |
| 89 to 104 | +5D6 |
| 105 to 120 | +6D6 |
| 121 to 136 | +7D6 |
| 137 to 152 | +8D6 |
| 153 to 168 | +9D6 |
| 169 to 184 | +10D6 |
| each +16 (or fraction) | +1D6 more |

## Characteristic Roll Multipliers

Characteristics are tested on `D100` by multiplying by 5 (the standard "×5 roll"). Harder versions use a smaller multiplier:

| Multiplier | Use |
|---|---|
| ×5 | Standard difficulty (Idea, Luck, Know, and similar). |
| ×3 | Difficult task. |
| ×1 | Very difficult task; raw characteristic as a percentage. |

Direct contests of one characteristic against another (most often STR vs STR, or magic points vs magic points) use the Resistance Table in `02-core-resolution.md`.

## Magic-Related Ratings

- All characters begin with Magic Points equal to POW.
- POW also sets starting Sanity (POW × 5) and is the stat resisted by, and spent on, many spells.
- Casting and learning spells, the Cthulhu Mythos skill, and tomes are covered in `08-magic-and-mythos.md`. Sanity is covered in `07-sanity.md`.
