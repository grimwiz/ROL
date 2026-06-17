# Core Resolution

<!-- Source: rulebook p14-17 (How Skills Work, Automatic Actions, Simple Percentile Rolls, Resistance Table, Costs of Failure). Status: reviewed-complete (PDF-gated 2026-06-16; fixed 2e impale = double-roll, removed non-2e general special-success). -->

## When to Roll

The Keeper calls for a roll when an action's outcome is uncertain and matters. Routine actions a competent character would simply accomplish need no roll.

## Making a Roll

Roll `D100` and compare to the relevant skill or characteristic-based target. A result equal to or less than the target succeeds; a result above it fails.

- Skills are tested against their current percentage directly.
- Characteristics are tested by multiplying by 5 (`×5`), or `×3`/`×1` for harder tasks (see `01-characteristics.md`).

## Automatic Actions

- An action a character could perform reliably under no pressure succeeds without a roll.
- An action beyond any possibility — a target of `0` or less, or opposition off the Resistance Table — automatically fails; no roll is allowed.

## Impales

The one mechanic keyed to **one-fifth** of the target is the combat **impale**: a hit roll equal to or less than one-fifth of the attack skill (drop fractions), available to firearms and to impaling melee weapons. An impale rolls the weapon's normal damage **twice** and adds the results — see `05-combat.md`. (Ordinary skill rolls in this edition have no separate "special success" tier; a roll either succeeds or fails.)

## The Resistance Table

Use the Resistance Table when one characteristic directly opposes another — most often STR vs STR, magic points vs magic points, or CON vs a poison's potency. The acting value is **active**; the value resisting it is **passive**.

Find the active value across the top and the passive value down the side. The cell is the percentage chance for the active side to succeed; roll equal to or less than it on `D100`. The printed chance follows `chance% = 50 + 5 × (active − passive)`. A dash means automatic: where the active value far exceeds the passive, the action succeeds without a roll; where the passive far exceeds the active, the action is impossible.

| P\A | 01 | 02 | 03 | 04 | 05 | 06 | 07 | 08 | 09 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 01 | 50 | 55 | 60 | 65 | 70 | 75 | 80 | 85 | 90 | 95 | — | — | — | — | — | — | — | — | — | — | — |
| 02 | 45 | 50 | 55 | 60 | 65 | 70 | 75 | 80 | 85 | 90 | 95 | — | — | — | — | — | — | — | — | — | — |
| 03 | 40 | 45 | 50 | 55 | 60 | 65 | 70 | 75 | 80 | 85 | 90 | 95 | — | — | — | — | — | — | — | — | — |
| 04 | 35 | 40 | 45 | 50 | 55 | 60 | 65 | 70 | 75 | 80 | 85 | 90 | 95 | — | — | — | — | — | — | — | — |
| 05 | 30 | 35 | 40 | 45 | 50 | 55 | 60 | 65 | 70 | 75 | 80 | 85 | 90 | 95 | — | — | — | — | — | — | — |
| 06 | 25 | 30 | 35 | 40 | 45 | 50 | 55 | 60 | 65 | 70 | 75 | 80 | 85 | 90 | 95 | — | — | — | — | — | — |
| 07 | 20 | 25 | 30 | 35 | 40 | 45 | 50 | 55 | 60 | 65 | 70 | 75 | 80 | 85 | 90 | 95 | — | — | — | — | — |
| 08 | 15 | 20 | 25 | 30 | 35 | 40 | 45 | 50 | 55 | 60 | 65 | 70 | 75 | 80 | 85 | 90 | 95 | — | — | — | — |
| 09 | 10 | 15 | 20 | 25 | 30 | 35 | 40 | 45 | 50 | 55 | 60 | 65 | 70 | 75 | 80 | 85 | 90 | 95 | — | — | — |
| 10 | 05 | 10 | 15 | 20 | 25 | 30 | 35 | 40 | 45 | 50 | 55 | 60 | 65 | 70 | 75 | 80 | 85 | 90 | 95 | — | — |
| 11 | — | 05 | 10 | 15 | 20 | 25 | 30 | 35 | 40 | 45 | 50 | 55 | 60 | 65 | 70 | 75 | 80 | 85 | 90 | 95 | — |
| 12 | — | — | 05 | 10 | 15 | 20 | 25 | 30 | 35 | 40 | 45 | 50 | 55 | 60 | 65 | 70 | 75 | 80 | 85 | 90 | 95 |
| 13 | — | — | — | 05 | 10 | 15 | 20 | 25 | 30 | 35 | 40 | 45 | 50 | 55 | 60 | 65 | 70 | 75 | 80 | 85 | 90 |
| 14 | — | — | — | — | 05 | 10 | 15 | 20 | 25 | 30 | 35 | 40 | 45 | 50 | 55 | 60 | 65 | 70 | 75 | 80 | 85 |
| 15 | — | — | — | — | — | 05 | 10 | 15 | 20 | 25 | 30 | 35 | 40 | 45 | 50 | 55 | 60 | 65 | 70 | 75 | 80 |
| 16 | — | — | — | — | — | — | 05 | 10 | 15 | 20 | 25 | 30 | 35 | 40 | 45 | 50 | 55 | 60 | 65 | 70 | 75 |
| 17 | — | — | — | — | — | — | — | 05 | 10 | 15 | 20 | 25 | 30 | 35 | 40 | 45 | 50 | 55 | 60 | 65 | 70 |
| 18 | — | — | — | — | — | — | — | — | 05 | 10 | 15 | 20 | 25 | 30 | 35 | 40 | 45 | 50 | 55 | 60 | 65 |
| 19 | — | — | — | — | — | — | — | — | — | 05 | 10 | 15 | 20 | 25 | 30 | 35 | 40 | 45 | 50 | 55 | 60 |
| 20 | — | — | — | — | — | — | — | — | — | — | 05 | 10 | 15 | 20 | 25 | 30 | 35 | 40 | 45 | 50 | 55 |
| 21 | — | — | — | — | — | — | — | — | — | — | — | 05 | 10 | 15 | 20 | 25 | 30 | 35 | 40 | 45 | 50 |

For values beyond 21 (some monsters and deities), extend the formula `50 + 5 × (active − passive)`, treating chances of `95+` as automatic and `05` or less as impossible.

## Resistance Table in Play

| Contest | Active | Passive |
|---|---|---|
| Grapple / overpower | attacker's STR | target's STR |
| Most offensive spells | caster's magic points | target's magic points |
| Resist poison or disease | victim's CON | poison/disease potency |
| Dispel or dismiss a being | caster's magic points | being's POW or magic points |

## Costs of Failure

A failed roll should change the situation: cost time, raise risk, alert an enemy, damage equipment, or close off an approach. The Keeper narrates the consequence.

Repeated attempts at the same task are allowed only when circumstances change or more time and effort are spent; otherwise a single failure stands.

Hazards that test characteristics directly — falling, drowning, and poison — are in `06-damage-and-healing.md`. Sanity rolls are in `07-sanity.md`.
