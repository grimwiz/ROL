# Sanity

<!-- Source: rulebook p26-31 (Using SAN, Shock & Temporary Loss, Indefinite Insanity, Typical SAN Losses, Insanity Table, Value of Insanity, Regaining SAN, Curing Insanity). Status: reviewed-complete (PDF-gated 2026-06-16; Typical SAN Losses, Temporary Insanity, Insanity Table, Institutional Disasters & availability tables verified vs p-071/073/074/075; fixed Ophidiophobia spelling). -->

Sanity (SAN) is the characteristic tracking mental stability. Starting SAN = POW×5 (`01-characteristics.md`). Maximum SAN is always `99 − Cthulhu Mythos %`, so learning the Mythos permanently lowers the ceiling.

## Sanity Rolls

The Keeper calls for a Sanity roll — `D100` against **current SAN** — when an investigator meets something unnatural (a monster, a behaving-unnaturally horde, a horribly mutilated corpse) or reads a Mythos book or learns/casts certain spells.

- **Success:** no loss, or a minimal loss; the investigator carries on.
- **Failure:** lose SAN. The amount depends on the source (see Typical SAN Losses) or the Keeper's ruling.

Each distinct confrontation needs its own roll — reading a book, then casting from it, then facing what it summons is three rolls. A number of like monsters seen at once or in rapid succession is a **single** roll; encounters spread over hours need separate rolls.

## Sanity Loss, Shock, and Temporary Insanity

Whenever a character loses **5 or more SAN in a single experience**, it is a shock: make an Idea roll.

- **Idea succeeds:** the character grasps the full horror and goes **temporarily insane** for a duration on the table below.
- **Idea fails:** no madness, but the character may not clearly remember what just happened.

### Temporary Insanity Time Table

| 1D10 | Duration |
|---:|---|
| 1-4 | 1D10 combat rounds |
| 5-7 | 1D10 Full Turns |
| 8-9 | 1D10 Hours |
| 10 | 1D10 Days |

Temporary insanity may be a faint, hysterics, or a nervous breakdown, and often leaves a phobia tied to its cause.

## Indefinite Insanity

If a character loses **20% or more of current SAN within a single hour**, he automatically goes insane on an **indefinite** basis. The Keeper picks an affliction from the Insanity Table (or rolls `1D6` for the first six entries). Indefinite insanity does not lift on its own; it must be treated (see Recovery).

## Typical SAN Losses

| Potential Loss | Event |
|---|---|
| 1D3 | Surprised by corpse |
| 1D3 | Surprised by mangled corpse of animal |
| 1D4 | Surprised by fragment of a corpse |
| 1D6 | Surprised by horribly mangled corpse |
| 1D6 | Waking up in a tomb or coffin |
| 1D6 | See good friend or close relative die |
| 1D8 | Meet someone you know to be dead |
| 1D8 | Witnessing bizarre occurrence (e.g. sky turns green) |
| 1D10 | Witnessing grisly bizarre occurrence (e.g. gigantic bloody head falls from the heavens) |
| 1D10 | Undergo severe torture |

Monster-specific SAN losses are given with each creature in `bestiary.md`.

## Insanity Table

For indefinite insanity. Roll `1D6` if the affliction is not obvious from context.

1. **Catatonia** — foetal position; oblivious, cannot walk or stand.
2. **Amnesia** — memory lost (often selective); language and physical skills usually remain, knowledge skills go.
3. **Stupefaction** — no will; will not communicate or act independently.
4. **Pantophobia** — fear of everything; constant fright.
5. **Paranoia** — everyone is an enemy; secret schemes of protection and revenge.
6. **Phobia** — Keeper picks `1D6` phobias from the list below.

### Phobia List

Agoraphobia (open places), Bacteriophobia (bacteria), Ballistophobia (bullets), Barophobia (loss of gravity), Claustrophobia (enclosed spaces), Demophobia (crowds), Dendrophobia (trees), Doraphobia (fur), Entomophobia (insects), Nyctophobia (nightfall), Ophidiophobia (snakes), Scotophobia (darkness), Teratophobia (monsters), Thalassophobia (the sea), Xenophobia (foreigners).

Phobias persist even after the insanity is cured, hindering but not preventing normal life.

## The Value of Insanity

A character who goes mad may gain in two ways:

- **Mythos insight:** the first time he goes temporarily or indefinitely insane from a Mythos source, add `+5%` to Cthulhu Mythos; each later bout adds `+1%`. (This lowers maximum SAN.)
- **Sudden insight:** roll **higher** than the Idea roll on `D100` after going insane to gain an unnatural insight into the problem or monster faced — at the Keeper's discretion.

## Regaining and Increasing Sanity

SAN may never exceed `99 − Cthulhu Mythos`.

- **Mastering a skill:** each time a skill reaches 90% in play (not one starting at 90%), add `2D6` SAN.
- **Defeating a monster:** gain SAN equal to the danger that being posed — capped at the maximum a single such creature could cost (e.g. a dimensional shambler restores up to `1D10`, never more). Defeating monsters does not by itself cure existing insanity.

## Recovery and Treatment

### Psychoanalysis

- One psychoanalyst treats one patient per week. A successful Psychoanalysis roll restores `1` SAN that week; a special success (≤ 1/5 needed roll) restores `1D3`; a roll of 96-00 costs the patient `1D6` SAN. SAN can never be raised above the Luck roll (POW×5) by this method.
- **Curing temporary/indefinite insanity:** the patient spends `1D6` game months in intensive treatment, then the analyst rolls Psychoanalysis. Success cures; a special success also restores `1D6` SAN; 96-00 costs `1D6` SAN and bars that analyst from ever curing this patient.

### Institutionalization

Each committal, set a **Cure Rate** = `1D100 − 25` (under 01 = caretaking only, no cure). Every `1D6` months roll `1D100`:

- ≤ Cure Rate: cured and released.
- Otherwise: lose `1D6` SAN.
- 96-00: lose `1D6` SAN **and** roll on Institutional Disasters.

Institutionalization can never raise SAN above its current value.

#### Institutional Disasters

| 1D100 | Result | Effect |
|---|---|---|
| 01-20 | Disfigurement | Lose 1D6 APP |
| 21-40 | Poor Health | Lose 1D6 CON |
| 41-55 | Muscle Atrophy | Lose 1D6 STR |
| 56-70 | Mental Damage | Lose 1D6 INT |
| 71-85 | Nerve Damage | Lose 1D6 DEX |
| 86-00 | Coma | Roll 1D10 each month: ≤ CON, awaken cured; between CON and CON×5, keep sleeping; over CON×5, lose 1D6 CON and keep sleeping. |

### Availability

Psychoanalysts and institutions are found by population band (US, Canada, Great Britain, France, Germany, Austria, Northern Italy, Japan, Czechoslovakia, Scandinavia, Australia):

| Population | 1D100 Roll to find an analyst |
|---|---|
| Up to 100,000 | 01-05 |
| 100,000-300,000 | 01-50 |
| 300,000-600,000 | 01-95 |
| Over 600,000 | 01-99 (roll 1D10 for the number available) |

Elsewhere, in populations of 300,000+, roll POW×1 or less, once per game year. A non-mental institution's cure rate is `1D100 − 50`. Some regions had no institutions at all.

## Permanent Insanity

When SAN reaches **0**, the character is hopelessly, incurably insane and becomes a Keeper-run NPC.
