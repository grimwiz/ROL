# Damage and Healing

<!-- Source: rulebook p16-17 (Taking Damage, Shock, Falling, Drowning, Poison). Status: reviewed-complete (PDF-gated 2026-06-16; HP thresholds, 1HP/week healing, Shock 1D20, Falling 1D6/10ft, Drowning CON×10→×1 + 1D8, Poison-vs-CON all verified vs p-061/062). -->

## Hit Points and Damage

Hit Points (HP) = (SIZ + CON) ÷ 2 (see `01-characteristics.md`). Damage is subtracted from current HP.

- There is no penalty for accumulated damage until a character is at **2 HP or less**, unless the Keeper rules a specific injury impairs an action (e.g. burned hands block manipulation).
- At **1 or 2 HP** the character falls unconscious: alive, but will not wake without aid.
- At **0 HP or less** the character dies.

CON is never lowered by damage.

## Shock

If a single wound deals damage equal to **half or more of current HP**, the victim must roll CON or less on `1D20` or fall unconscious.

## Natural Healing

The body regenerates **1 HP per week** of game time. Under the care of a competent doctor or nurse, or in hospital, the Keeper may allow **2 HP per week** (or **3** in extraordinary circumstances). A character may act with less than full HP.

## First Aid and Medical Skills

- **First Aid** heals `1D3` HP and can wake the unconscious/stunned. Only one First Aid attempt per wound, whether or not it succeeds.
- **Treat Poison**, applied before symptoms appear, purges `2D6` levels of poison.
- **Treat Disease** eases mild or recurrent illness; severe disease needs a hospital.
- **Diagnose Disease** identifies an ailment and can double a Treat Disease or Pharmacy attempt.

(See `04-skills.md` for full skill notes.)

## Falling

A falling character takes `1D6` damage per 10 feet fallen. A successful Jump roll on a deliberate leap reduces the damage by `1D6`.

## Drowning, Strangling, and Suffocation

When a character is without air, roll on `1D100`:

- Round 1: CON×10 or less. Round 2: CON×9. Round 3: CON×8. Each round the multiplier drops by one, down to CON×1; after the tenth round keep rolling CON×1 each round.
- The first failed roll means a breath of the surrounding medium: `1D8` damage that round (in water), and `1D8` automatically every round thereafter — no further CON rolls are made.

The same procedure covers strangling (see Grapple in `05-combat.md`), poison gas, and smoke inhalation.

## Poison

Every poison has a numerical **potency**. When poisoned, match the poison's potency (active) against the victim's CON (passive) on the Resistance Table (`02-core-resolution.md`).

- If the poison overcomes CON, the victim normally takes the full potency as HP damage.
- If CON resists, the victim takes half potency, or none, as the Keeper rules.

Most poisons act after a delay: fast poisons within 3-4 rounds, most animal venoms a minute or more (a cobra bite ~15 minutes).
