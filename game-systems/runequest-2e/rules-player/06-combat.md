# Combat

<!-- Source: rulebook ch.III–IV p18-31 (melee round, strike rank, attack/parry, special damage, weapons, missiles), ch.IV p28-30 (armour/shields/helmets), appendix A–C p123-125. Status: extracted-draft. Weapon/armour tables reproduced from p025/p027/p125; a few OCR-ambiguous cells to confirm at the gate. -->

Damage, hit-location effects, and healing are in `07-damage-and-healing.md`.

## The Melee Round

A melee round is about **12 seconds**. Each round:

1. **Statement of intent** — everyone declares actions.
2. **Movement** of non-engaged characters.
3. **Resolution** of attacks, parries, and spells in **strike-rank order** (lowest SR acts first).

## Strike Rank (SR)

A character's melee SR = **DEX SR + SIZ SR + the weapon's SR** (plus modifiers for readiness, movement, and — for spells — points used). The lower the total, the earlier the action; totals above 12 cannot act that round.

| DEX | SR | | SIZ | SR | | Weapon length | SR |
|---|---:|---|---|---:|---|---|---:|
| 19+ | 0 | | 22+ | 0 | | 2+ m | 1 |
| 16-18 | 1 | | 15-21 | 1 | | 1.5-1.9 m | 2 |
| 13-15 | 2 | | 07-14 | 2 | | 1.0-1.4 m | 3 |
| 09-12 | 3 | | 01-06 | 3 | | 0.5-0.9 m | 4 |
| 06-08 | 4 | | | | | 0-0.4 m | 5 |
| 01-05 | 5 | | | | | | |

- **Spells:** SR from points used — 1 pt = SR 0, 2 = 1, 3 = 2, 4 = 3, 5 = 4, +1 each beyond. A **prepared** spell/missile is SR 0; an **unprepared** one adds 5.
- **Movement** adds 1 SR per 3 metres moved before acting.
- Each listed weapon already carries its length-based SR in the Weapon Statistics Table below; add it to DEX SR + SIZ SR.

## Attack and Parry

- **Attack:** roll `D100 ≤` your ability with that weapon to hit.
- **Parry:** roll `D100 ≤` your parry ability with a weapon or shield; a successful parry blocks the blow (success or not), and the parrying item absorbs the damage (`07`).
- **Defense** (a natural ability, `01-characteristics.md`) is **subtracted from the attacker's chance to hit** instead of being rolled.
- Success bands (critical ≤ 1/20, impale ≤ 1/5 for thrusting/missile weapons, fumble) are in `02-core-resolution.md`. In combat, a **critical ignores armour**; an **impale** adds the weapon's maximum damage to its rolled damage.

### Parrying exceptional hits
A weapon parrying a **critical** takes double damage; if the attack was a long-hafted or impaling weapon the parrying weapon takes none (the haft is engaged). A **shield** parrying a critical takes double damage and any excess strikes the parrier (worn armour still protects).

### Fumbles
A weapon used at 5–20% fumbles on **96–00**; each further +20% ability narrows the range by 1%, but **00 always fumbles**. Roll on the Fumble Table:

| D100 | Effect |
|---|---|
| 01-05 | Lose next parry |
| 06-10 | Lose next attack |
| 11-15 | Lose next attack and parry |
| 16-20 | Lose next attack, parry, and any Defense |
| 21-25 | Lose next `D3` attacks |
| 26-30 | Lose next `D3` attacks and parries |
| 31-35 | Shield strap breaks; lose shield immediately |
| 36-40 | Shield strap breaks; also lose next attack |
| 41-45 | Armour strap breaks (roll hit location for which piece) |
| 46-50 | Armour strap breaks; also lose next attack and parry |
| 51-55 | Fall; lose parry (takes `D3` rounds to rise) |
| 56-60 | Twist ankle; lose ½ speed for `5D10` rounds |
| 61-63 | Twist ankle and fall (both above) |
| 64-67 | Vision impaired; −25% attack/parry (`D3` rounds unengaged to fix) |
| 68-70 | Vision impaired; −50% (`D6` rounds to fix) |
| 71-72 | Vision blocked; lose all attacks/parries (`D6` rounds to fix) |
| 73-74 | Distracted; foes attack at +25% next round |
| 75-78 | Weapon dropped (`D3` rounds to recover) |
| 79-82 | Weapon knocked `D6` m away in a `D8` direction |
| 83-86 | Weapon shattered (100% if unenchanted; −10% per battle-magic pt, −20% per rune-magic pt on it) |
| 87-89 | Hit nearest friend (or self) for rolled damage |
| 90-91 | Hit nearest friend (or self) for full possible damage |
| 92 | Hit nearest friend (or self) for a critical |
| 93-95 | Hit self for rolled damage |
| 96-97 | Hit self for full possible damage |
| 98 | Hit self for a critical |
| 99 | Roll twice more, apply both |
| 00 | Roll thrice more, apply all three |

## Hit Location (humanoid)

On a hit, roll `D20`:

| D20 | Location | | D20 | Location |
|---|---|---|---|---|
| 01-04 | Right leg | | 13-15 | Right arm |
| 05-08 | Left leg | | 16-18 | Left arm |
| 09-11 | Abdomen | | 19-20 | Head |
| 12 | Chest | | | |

Per-location hit points and the effects of limb/chest/head damage are in `07-damage-and-healing.md`.

## Grappling and Two-Weapon Use

- **Grapple:** a successful grapple catches the rolled location (a weapon parry = the weapon arm caught; shield parry = shield grasped). Next round, attack again to **immobilise** (also win STR vs STR on the Resistance Table) or **throw** (STR+DEX vs SIZ+DEX). A thrown character rolls DEX×5 or takes `1D6` to a random location (armour protects). After the initial grab, SR is by DEX alone.
- **Two weapons:** one in each hand gives 2 attacks, 2 parries, or 1 of each. The off hand starts at 5% and needs DEX ≥ 1.5× the weapon's minimum. The second attack's SR = first weapon's SR + second weapon's SR (if the total exceeds 12, only the first lands). At 100%+ with each, a character may strike one foe twice at full, or two foes at half each.

## Weapon Breakage

Weapons absorb parry damage cumulatively across a fight; when accumulated damage exceeds the weapon's HP, it breaks. A weapon takes damage when it parries a successful attack, or attacks into a successful parry — **except** short stabbing weapons (too little mass) and long-hafted weapons (haft engaged, not the head), which damage parrying *shields* but not weapons.

## Weapon Statistics

STR/DEX = minimum to wield (2 excess STR covers 1 missing DEX); Damage adds the damage bonus where it applies; HP = parry hit points; ENC = encumbrance; Length sets the weapon SR; Cost in L.

| Class | Weapon | STR/DEX | Damage | HP | ENC | Len (m) | SR | Cost |
|---|---|---|---|---:|---:|---|---:|---:|
| Axe 1H | Battle Axe | 13/9 | `1D8+2` | 15 | 2 | 0.8 | 3 | 40 |
| | Hatchet | 7/9 | `1D6+1` | 15 | 1 | 0.4 | 4 | 25 |
| Axe 2H | Battle Axe | 9/9 | `1D8+2` | 15 | 2 | 0.8 | 3 | 40 |
| | Great Axe | 11/9 | `2D6+2` | 15 | 2 | 1.2 | 2 | 50 |
| | Pole Axe | 13/11 | `3D6` | 12 | 2 | 1.5-1.8 | 1 | 15 |
| | Rhomphia | 11/11 | `2D6+2` | 12 | 2 | 1.2 | 2 | 50 |
| Butt | Head butt | — | `1D4` | — | 0 | — | 4 | — |
| Dagger | Dagger | — | `1D4+2` | 12 | 0 | 0.2-0.3 | 4 | 20 |
| Fist | Fist | — | `1D3` | — | 0 | — | 4 | — |
| | Claw | 7/— | `1D4+1` | 5 | 1 | — | 4 | 50 |
| | Heavy cestus | —/— | `1D3+2` | 10 | 1 | — | 4 | 40 |
| | Light cestus | —/— | `1D3+1` | 5 | 0 | — | 4 | 25 |
| Flail 1H | Grain flail | 9/— | `1D6` | 8 | 1 | 0.5 | 3 | 10 |
| | War flail | 11/— | `1D6+2` | 12 | 2 | 0.7 | 3 | — |
| Flail 2H | Military flail | 9/— | `2D6+2` | 15 | 3 | 2.0 | 0 | 75 |
| Grapple | Grapple | — | special | — | 0 | — | 4 | — |
| Hammer 1H | War hammer/pick | 11/9 | `1D6+2` | 20 | 1 | 0.8 | 3 | 50 |
| Hammer 2H | Great hammer | 9/9 | `1D12+2` | 15 | 3 | 1.5 | 1 | 75 |
| Kick | Kick | — | `1D6` | — | 0 | — | 4 | — |
| Mace 1H | Heavy mace | 13/7 | `1D8+2` | 20 | 2 | 0.8 | 3 | 40 |
| | Light mace | 7/7 | `1D6+2` | 20 | 1 | 0.6 | 3 | 15 |
| | Singlestick | —/9 | `1D6` | 10 | 0 | 0.4 | 4 | 10 |
| Maul | Maul | 11/— | `2D8` | 15 | 3 | 1.5 | 1 | 40 |
| | Quarterstaff | 9/9 | `1D8` | 15 | 2 | 2.0 | 0 | 10 |
| Morning star | Morning star flail | 11/7 | `1D10+1` | 12 | 2 | 1.0 | 2 | 100 |
| Pike | Pike | 11/7 | `1D12+1` | 15 | — | 3.5+ | 0 | 30 |
| Rapier | Rapier | 7/13 | `1D6+1` | 12 | 1 | 1.2 | 2 | 100 |
| Shortsword | Shortsword | —/— | `1D6+1` | 20 | 1 | 0.6 | 3 | 35 |
| Sickle | Sickle | —/— | `1D6+1` | 15 | 1 | 0.5 | 3 | 30 |
| Spear 1H | Long spear | 11/7 | `1D8+1` | 15 | 1 | 2.5 | 1 | 20 |
| | Short spear | 9/7 | `1D6+1` | 15 | 2 | 1.8 | 2 | 15 |
| | Lance | 9/7 | `1D10+1` | 20 | 3 | 3.0 | 0 | 30 |
| Spear 2H | Long spear | 9/— | `1D10+1` | 15 | 3 | 2.5 | 0 | 20 |
| | Short spear | 7/7 | `1D8+1` | 15 | 2 | 1.8 | 1 | 15 |
| Sword 1H | Bastard sword | 13/9 | `1D10+1` | 20 | 1 | 1.2 | 2 | 75 |
| | Broadsword | —/— | `1D8+1` | 20 | 1 | 1.0 | 2 | 50 |
| | Scimitar | 9/9 | `1D8+1` | 20 | 1 | 1.0 | 2 | 50 |
| Sword 2H | Bastard sword | 9/— | `1D10+1` | 20 | 1 | 1.2 | 2 | 75 |
| | Greatsword | —/13 | `2D8` | 15 | 2 | 1.5 | 1 | 150 |

## Missile Weapons

Weapon length is not used; range and rate of fire are. A target moving across the archer's view, or dodging, halves the chance to hit; movement straight toward/away does not. A shield cannot be readied while using a missile weapon except a small shield with a sling.

Base attack chances: Sling 10%, Bow 10%, Crossbow 20%, Staff sling 5%, Thrown axe 10%, Thrown dagger 15%, Javelin 15%, Thrown rock 25%. **Half the damage bonus** is added to thrown-weapon damage.

**Range:** the table's listed range is the **effective** range (full chance to hit). **Medium** range (about 1½× effective) is at **half** chance; **long** range (up to about twice effective) is at **quarter** chance; beyond that, no shot. (Per-weapon effective ranges, damage, and rate of fire are in the Missile Statistics Table, p27–28 — to transcribe at the gate.)

## Armour

Worn armour **absorbs** damage at its location. Leather may be worn under other armour (cumulative ENC). "Silent" is the modifier to Stealth.

| Area | Type | Absorbs | ENC | Cost | Silent |
|---|---|---:|---:|---:|---:|
| Legs | Greaves, leather | 1 | 0 | 15 | 0 |
| | Cuirboilli | 3 | 1 | 40 | 0 |
| | Plate | 6 | 2 | 120 | −15 |
| Abdomen+Legs | Trews, leather | 1/2 | 0/1 | 10/20 | 0 |
| | Chainmail | 5 | 3 | 120 | −15 |
| Abdomen | Skirt, leather | 1/2 | 0/1 | 10/20 | 0 |
| | Light/Heavy scale | 4/5 | 2/3 | 30/60 | −15/−30 |
| | Chainmail | 5 | 2 | 100 | −25 |
| Chest+Abdomen | Hauberk, leather | 1/2 | 0/1 | 20/40 | 0 |
| | Linen | 3 | 2 | 30 | −5 |
| | Ring mail | 4 | 2 | 80 | −15 |
| | Light/Heavy scale | 4/5 | 2/3 | 40/60 | −30/−25 |
| | Chainmail | 5 | 2 | 200 | −20 |
| Chest | Byrnie, leather | 1/2 | 0/1 | 10/20 | 0 |
| | Ring mail | 4 | 1 | 50 | −5 |
| | Chainmail | 5 | 1 | 120 | −15 |
| | Cuirass (cuirboilli/linen) | 3 | 1 | 40/35 | −5 |
| | Heavy scale | 5 | 3 | 40 | −25 |
| | Brigandine | 5 | 2 | 175 | −15 |
| | Plate | 6 | 3 | 200 | −15 |
| Arms | Sleeves, chainmail | 5 | 2 | 75 | −15 |
| | Vambraces, leather | 1 | 0 | 10 | 0 |
| | Cuirboilli | 3 | 1 | 30 | 0 |
| | Plate | 6 | 2 | 100 | −10 |

### Shields

| Shield | STR | Absorbs | ENC | Cost |
|---|---|---:|---:|---:|
| Small | 5+ | 8 | 1 | 15 |
| Medium | 9+ | 12 | 2 | 30 |
| Large | 12+ | 16 | 3 | 50 |

### Helmets

| Helmet | Absorbs | ENC | Cost |
|---|---:|---:|---:|
| Hood (leather) | 1 | 0 | 3 |
| Cap | 2 | 0 | 5 |
| Composite helm | 3 | 0 | 10 |
| Open helm | 4 | 1 | 15 |
| Closed helm | 5 | 1 | 30 |
| Full helm | 6 | 2 | 50 |
