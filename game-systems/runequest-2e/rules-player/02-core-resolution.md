# Core Resolution

<!-- Source: rulebook ch.IV p19-20 (basic chance, critical, impale, fumble), ch.V p34 (Resistance Table, POW gain), appendix A p123 (experience rolls). Status: extracted-draft. -->

## Ability Rolls

Almost every action is an **ability** rated as a percentage. Roll `D100` and compare:

- **Roll ≤ the ability** → success.
- **01–05** always succeeds and **96–00** always fails, whatever the ability.
- The base chance for most attacks, parries, and skills is **5%**, before category modifiers (`01-characteristics.md`) and training.

Category modifiers adjust only the *base* chance, not every later point of training or experience.

## Success Bands

Beyond a plain success, a roll low enough relative to the ability is exceptional (these matter most in combat — see `06-combat.md`):

| Band | Threshold | Effect |
|---|---|---|
| **Critical** | roll ≤ **1/20** of the ability (round down; min 01) | A perfect result. In combat it **ignores armour** and other protection. |
| **Impale / special** | roll ≤ **1/5** of the ability | For a thrusting or missile weapon (not thrown axes/rocks): **impale** — see below. |
| **Success** | roll ≤ the ability | Normal effect. |
| **Fumble** | see below | A botch; roll on the Fumble Table (`06-combat.md`). |

- **Impale damage:** roll the weapon's damage and damage bonus normally, then **add the weapon's maximum possible damage**. (A spear doing `1D6+1`, max 7, that impales does `1D6+1` rolled **+ 7**, plus any rolled damage bonus.)
- **Fumble:** a weapon used at 5–20% ability fumbles on **96–00** (5%); every further +20% ability lowers the fumble range by 1% — but a roll of **00 always fumbles**. The Fumble Table gives the mishap.

## The Resistance Table

When a raw characteristic opposes another — STR vs STR (force), a spell's magic points vs the target's POW, a poison's potency vs CON — cross-index the **active** value (the attacker/agent) against the **passive** value (the resister):

```
chance to overcome (%) = 50 + 5 × (active − passive)
```

Equal values give **50%**; each point of advantage is **+5%**, each point of deficit **−5%**. Roll that number or less on `D100` to succeed. Chances clamp at the table's edges (95% high, 05% low); an overwhelming gap is automatic or impossible.

## Improving Abilities

### Experience checks

After an ability is used **successfully in earnest** during an adventure, it may be checked at the adventure's end:

```
target = (100 − current ability)  ± 3% per INT point above 12 / below 9
```

(Add 3% for each INT above 12, subtract 3% for each INT below 9, relative to the 9–12 band.) Roll the target or less on `D100`; success raises that ability by **+5%**. The lower the current ability and the higher the INT, the easier the gain. (**Defense** is the exception — it improves by *succeeding* when it saves the character, on an INT-or-less roll; see `01-characteristics.md`.)

### POW gain

To raise POW, the character must **overcome a foe's resistance with a spell** in real stress — a contest that had less than a 95% chance (a near-certain spell grants no gain). After the adventure, with a week's calm:

```
POW gain roll: (20 − current POW) × 5  → roll that or less on D100
```

On success, roll `D100` again for the amount gained: **01–10 → +3 POW**, **11–40 → +2 POW**, **41–00 → +1 POW**. POW can never exceed the species maximum. When POW rises above 18, the character may qualify for Rune Priest status (`10-rune-magic-and-cults.md`).

Paid **training** raises abilities and characteristics outside of play (`05-advancement.md`).
