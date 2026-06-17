# System Overview

<!-- Source: rulebook p5-7 (Introduction, Playing Aids, Dice). Status: reviewed-complete (PDF-gated 2026-06-16; Dice section verified vs p-052; fixed impale glossary/success-levels to 2e double-roll, removed non-2e general special-success tier). -->

## Game Frame

Call of Cthulhu is a 1920s horror-investigation RPG based on the Cthulhu Mythos of H. P. Lovecraft. Investigators uncover and oppose alien horrors whose very existence threatens human sanity.

- One participant is the Keeper (Keeper of Arcane Lore): prepares and runs scenarios, portrays NPCs and monsters, calls for rolls, and adjudicates outcomes impartially.
- Other participants play investigators: ordinary people — journalists, professors, doctors, private eyes, dilettantes, and similar — who probe the unknown.
- A scenario is a single adventure; a linked series of scenarios is a campaign.
- The default setting is the United States, circa 1920. The Keeper may shift the period; the Mythos magic and monsters are timeless, though particular books may be more or less available in other eras.
- Lethality is high. Players are advised not to over-invest in any single investigator. Survivors grow through experience, arcane knowledge, and increased Sanity.

## Core Terms

| Term | Meaning |
|---|---|
| Keeper | The game moderator; runs scenarios and adjudicates rules. |
| Investigator | A player-controlled character. |
| Characteristic | One of nine rated abilities: STR, CON, SIZ, INT, POW, DEX, APP, EDU, SAN. |
| Skill | A percentile rating for a trained or learned action. |
| Idea / Luck / Know roll | `D100` rolls against INT×5 / POW×5 / EDU×5 respectively. |
| Resistance Table | Cross-index for opposing one characteristic against another (e.g. STR vs STR). |
| Sanity (SAN) | A characteristic tracking mental stability; lost to horror and the Mythos. |
| Magic Points (MP) | Expendable pool equal to POW; powers spells. |
| Cthulhu Mythos | The skill measuring forbidden knowledge; caps maximum SAN. |
| Impale | A combat critical: a hit roll ≤ 1/5 of the attack skill that doubles an impaling weapon's damage roll (see `05-combat.md`). |
| Damage Bonus | A dice modifier to melee/thrown damage derived from STR + SIZ. |
| Hit Points (HP) | Physical health; the average of SIZ and CON. |

## Dice

Required dice: twenty-sided (`D20`), eight-sided (`D8`), and six-sided (`D6`).

- `D100` (percentile): roll two `D20`s read as tens and ones, or one `D20` twice. `00` reads as `100`.
- `D10`: read a `D20` as `0`-`9` (treat the high set as the low set).
- Derived dice: a `D3` is a `D6` halved; a `D4` is a `D8` halved (`1`-`2`=1, `3`-`4`=2, `5`-`6`=3, `7`-`8`=4).

Notation: `NDx+Y` means roll `N` dice of `x` sides and add `Y`. A monster's `1D6+2D4` claw rolls all three dice and sums them.

## Basic Roll Logic

Most uncertain actions use percentile rolls. Lower is better.

1. State the investigator's goal.
2. The Keeper decides whether a roll is needed.
3. The Keeper sets the relevant skill or characteristic, plus any multiplier (Idea/Luck/Know) or Resistance Table contest.
4. Roll `D100` and compare to the target value.
5. Apply success level, damage, Sanity loss, or other subsystem rules.

Roll only when the outcome matters and failure changes the situation.

## Characteristic Rolls

When no specific skill applies, the Keeper may call for a characteristic roll on `D100`:

| Roll | Target | Use |
|---|---|---|
| Idea | INT×5 | Deduce, recognise, or "really" think of something. |
| Luck | POW×5 | Pure chance, coincidence, or favourable circumstance. |
| Know | EDU×5 | Recall a fact within the character's general education. |

For an especially hard task the Keeper may require ×3 or even ×1 instead of ×5.

## Success Levels

| Result | Meaning |
|---|---|
| Success | Roll ≤ the target value. |
| Failure | Roll above the target value. |

Ordinary skill and characteristic rolls have only success or failure — this edition has no universal "special success" tier. A few subsystems add an extra effect when the roll is ≤ 1/5 of the target (drop fractions): the combat **impale** (doubles an impaling weapon's damage roll, `05-combat.md`) and **psychoanalysis** (`07-sanity.md`).

Full resolution — the Resistance Table, opposed contests, and costs of failure — is in `02-core-resolution.md`. Sanity rolls are in `07-sanity.md`.

## Default Player Knowledge

- The setting is the 1920s; investigators are ordinary, mortal people.
- Mythos magic and monsters are real but hidden from normal society.
- Learning Mythos truths costs Sanity; the Cthulhu Mythos skill can never be raised by spending experience or character-creation points.
- The game supports investigative, social, and physical problem-solving; direct combat with the Mythos is usually a losing proposition.
