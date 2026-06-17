# Combat

<!-- Source: rulebook p17-20 (Combat Skills, Fighting, The Impale, Using Melee Weapons, Melee/Firearms tables); Sourcebook p23 (automatic weapons). Status: reviewed-complete (PDF-gated 2026-06-16; melee & firearms tables verified vs p-064/065, knife cost confirmed $8). -->

Damage states, healing, poison, falling, and drowning are in `06-damage-and-healing.md`.

## Combat Frame

Attack skills split into **melee** (fencing, hand-to-hand, knives, clubs) and **firearms** (handgun, rifle, shotgun). A hit deals the weapon's damage; the attacker's Damage Bonus is added to melee and thrown damage (see `01-characteristics.md`).

## Combat Rounds and DEX Order

Combat runs in rounds. Within a round, characters act in descending DEX order: DEX 18 first, then 17, 16, and so on, until everyone has acted.

- **Ready firearms vs melee:** all aimed, ready firearms fire once (in DEX order) before any melee blow lands.
- After those first shots, melee attacks and any guns being drawn/shouldered resolve in DEX order.
- A gun firing **twice** in a round takes its second shot in this later part, at the user's DEX. A gun firing a **third** time fires at half the user's DEX in the later part.

## Actions: Attack, Parry, Dodge

- **Attack** at your own DEX rank: roll `D100` ≤ the weapon skill to hit.
- **Parry** (melee only): a successful Parry blocks a melee attack; the parrying weapon takes the damage instead of the character. Declare the intended target to parry at the start of the round; parrying can resolve at any point in the round, but a character knocked out or stunned before the parried blow loses that parry. Fist, kick, head butt, and knives cannot parry. Other melee weapons get **one parry and one attack** per round. A firearm may parry if it is not fired that round.
- **Dodge** (DEX×2 skill): evade a seen attack; a dodging character takes no other action that round.

Only melee attacks can be parried. Firearms cannot be parried (but can be dodged if seen coming).

## The Impale

A roll **≤ one-fifth of the attack skill** (drop fractions) is an impale, available to all firearms except shotguns and to melee weapons marked `*` on the table below.

1. **Double damage roll:** roll the weapon's normal damage twice and add the results (a `1D6` revolver impale does `2D6`). Damage bonus is still added once where applicable.
2. **Stuck weapon:** an impaling melee weapon lodges in the target. Next round the attacker may free it by rolling ≤ half the weapon skill.

## Melee Weapons Table

`*` = impaling weapon. Base Chance is the untrained skill; Hit Points is the damage the weapon withstands before breaking.

| Name | Damage | Base Chance | Hit Points | Cost |
|---|---|---|---:|---:|
| Fist/Punch | 1D3 | 50% | — | — |
| Head Butt | 1D4 | 10% | — | — |
| Kick | 1D6 | 25% | — | — |
| Grapple | special | 25% | — | — |
| Fencing Foil, sharpened* | 1D6 | 20% | 10 | $20 |
| Rapier or Heavy Epee, sharpened* | 1D6+1 | 10% | 15 | $30 |
| Civil War Sabre | 1D8+1 | 15% | 20 | $8 |
| Wood Axe | 1D8+2 | 20% | 15 | $2 |
| Hatchet | 1D6+1 | 20% | 12 | $2 |
| Fighting Knife (Bowie, dirk)* | 1D4+2 | 25% | 15 | $8 |
| Butcher Knife (commando knife)* | 1D6 | 25% | 12 | $3 |
| Small Knife (switchblade, etc.)* | 1D4 | 25% | 9 | $3 |
| Pocketknife* | 1D3 | 25% | 6 | $2 |
| Baseball Bat/Poker | 1D8 | 25% | 20 | $1.50 |
| Nightstick/Small Club | 1D6 | 25% | 15 | $2.25 |

A character with knife-fighting uses any knife at the same chance; a knife attacks **or** parries (not both) in a round. Fencing covers foil and rapier at the same skill, but Fencing Attack and Fencing Parry advance separately; both can impale.

## Grapple and Unarmed

Hand-to-hand attacks are four separate skills — Fist/Punch, Head Butt, Kick, Grapple — and only one may be used per round.

A grapple may only be parried by another successful grapple. On a successful, unparried grapple the attacker grabs the target and chooses one option:

- **Immobilize** — overcome the target's STR with your STR on the Resistance Table; success holds the target fast until you attempt another action.
- **Knock down** — succeeds automatically.
- **Damage / strangle** — a second successful grapple in the same round deals `1D6` + damage bonus, and `1D6` + bonus each later round it succeeds; or maintain a strangle and the target asphyxiates per the Drowning rules. A grappled victim escapes only by matching STR vs the attacker's STR on the Resistance Table.

## Firearms

Three skills: Handgun, Rifle, Shotgun (each covers all weapons of its type). All firearms except shotguns can impale.

- **Point-blank** (range ≤ the user's DEX in feet): chance to hit is doubled.
- **Extended range:** double the base range at half chance, triple at one-quarter, quadruple at one-eighth, and so on.
- **Revolvers:** 6 chambers, usually carried with 5 loaded. **Automatics** jam on an attack roll of 99-00 (clear with a Mechanical Repair roll, ≥1D6 rounds); ~7 rounds per clip. Loading two shells takes a full round.
- **Rifles:** bolt-action or automatic; automatics fire twice/round and jam on 96-00; five-round magazines.
- **Shotguns:** double-barrelled or pump; pump jams on 96-00. May fire both barrels at one target (two attack rolls at the same DEX). Damage falls with range; beyond 20 yards a cluster of targets within 3 feet may all be hit on one successful roll.

### Firearms Table

| Skill | Name | Shots/Rnd | Damage | Base | Range* | HP | Cost |
|---|---|---|---|---|---|---:|---:|
| Handgun | .22 revolver | 3 | 1D6 | 20% | 10 yards | 10 | $15 |
| Handgun | .22 automatic | 3 | 1D6 | 20% | 10 yards | 6 | $25 |
| Handgun | .32 / 7.65mm revolver | 3 | 1D8 | 20% | 15 yards | 10 | $20 |
| Handgun | .32 / 7.65mm automatic | 3 | 1D8 | 20% | 15 yards | 6 | $25 |
| Handgun | .38 / 9mm revolver | 2 | 1D10 | 20% | 15 yards | 10 | $20 |
| Handgun | .38 / 9mm automatic | 2 | 1D10 | 20% | 15 yards | 6 | $25 |
| Handgun | .45 revolver | 1 | 1D10+2 | 20% | 15 yards | 10 | $25 |
| Handgun | .45 automatic | 1 | 1D10+2 | 20% | 15 yards | 8 | $30 |
| Rifle | .22 bolt-action | 1 | 1D6+2 | 10% | 30 yards | 9 | $25 |
| Rifle | .30-06 bolt-action** | 1/2 rnds | 2D6+3 | 10% | 100 yards | 12 | $50 |
| Shotgun† | 20-gauge | 2 | 2D6 / 1D6 / 1D3 | 30% | 10 / 20 / 50 yards | 8 | $50 |
| Shotgun† | 12-gauge | 1 | 4D6 / 2D6 / 1D6 | 30% | 10 / 20 / 50 yards | 10 | $50 |
| Shotgun | sawed-off†† | — | — | — | 10 yards max | — | $100 |

\* Range for any snubnosed weapon is 5 yards.
\*\* The .30-06 fires only once every second round, but always fires in the first round.
† Shotgun damage varies with range (the three figures are the three range bands).
†† Sawed-off shotgun max range 10 yards; full damage to 5 yards, then `1D3` (20-gauge) / `1D6` (12-gauge) from 5-10 yards.

## Automatic Weapons (Sourcebook)

Fully-automatic weapons may fire a burst on the user's DEX. Each shot in the burst lowers the attack chance by 5%, but never below half the user's skill. Roll once per target; on a hit, roll an appropriate die for how many bullets land (8 shots → `1D8` hits). Only the first bullet can impale. Firing at extra targets costs one shot per extra target, and each target is rolled separately.

## Armor

Some monsters have armor (tough hide, muscle, fat). Armor is subtracted from each instance of damage: a creature with 4-point armor shot for 10 takes 6. Investigators rely on cover and Dodge rather than worn armor.
