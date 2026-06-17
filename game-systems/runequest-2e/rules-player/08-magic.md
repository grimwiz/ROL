# Magic

<!-- Source: rulebook ch.V p33-34, 40-42 (battle magic mechanics, POW gain, spirit combat, shamans). Status: extracted-draft. Spell descriptions are in 09; rune magic and cults in 10. -->

RuneQuest has two magic systems: **battle magic** (common, magic-point spells — this file and `09-battle-magic-spells.md`) and **rune magic** (cult spells from the gods — `10-rune-magic-and-cults.md`). Both draw on POW.

## Magic Points

An adventurer's **magic points equal his current POW** (`01-characteristics.md`). Casting spends points; they recover with rest. Overcoming a foe's magical resistance can permanently raise POW (the POW-gain roll, `02-core-resolution.md`).

## Learning Battle Magic

Battle-magic spells are bought from cults, temples, and teachers at the prices in the spell list (`09`). A character memorises a limited number (governed by **INT**). Some spells are **variable** — they can be learned and enchanted to higher point levels (e.g. Bladesharp 1–4), up to each spell's cap; the listed POW points are the **minimum** to cast.

## Casting

A spell takes effect on its **strike rank** (Spell Strike Rank Table) and, against a resisting target, must overcome the target's POW.

### Spell strike rank
SR = readiness (**ready 0 / unready +5**) + **DEX SR** + **POW-used SR** (1 pt = 0, 2 = 1, 3 = 2, 4 = 3, 5 = 4, 6 = 5).

### Focus
Most spells affecting **others or objects** need a carved **focus** (a rune on a wand, staff, ring, or the weapon affected) to cast in one round; without a focus, casting takes **two rounds** (the first spent visualising the rune). Spells affecting **the caster's own body need no focus**. A ½-metre wand holds ~20 foci; a staff holds all. To cast at a target, look at the focus (to set the spell) then point it at the target.

### Does the spell work?
- Spells on **oneself, on objects, or any Healing**, and spells on **unconscious** targets, are not resisted — but **96–00 always fails**.
- Against a resisting target, compare the **caster's POW vs the target's POW** on the Resistance Table (`02`): 50% when equal, ±5% per point of difference. Roll that or less on `D100`.
- **Failure still spends the spell's POW points.**

### Casting rules
1. If the caster takes damage or his concentration is broken **before** the spell's strike rank, the spell fails — but **no POW is lost**.
2. Spells **cannot be combined** (two Bladesharp 2 ≠ Bladesharp 4; a severed limb needs one full Healing 6).
3. **Extra POW** may be added beyond the minimum to punch through a Countermagic or Shield; the effect is unchanged but the spell overcomes the defence.
4. A spell that has taken effect **persists** even if the target leaves the casting range.
5. Where two spells are **incompatible**, a later cast simply has no effect.

### Duration types
- **Passive** — active only during the round cast (most Detect spells).
- **Temporal** — lasts **10 melee rounds**, then ends (Bladesharp, Demoralize, Fanaticism, Mobility…).
- **Permanent** — the effect persists after a one-round cast (Disruption, Extinguish, Ignite, Repair); it does not undo itself, though it can be healed/relit/repaired by other means.

## Spirit Combat

A free spirit (average **INT 3D6, POW 3D6+6**) can be challenged — found with a Detect Spirit spell or by a priest/shaman. The spirit englobes the challenger and both make **raw-POW attacks** (POW vs POW on the Resistance Table). On a successful attack the winner, in order, may:

1. **Break off** (disembodied spirit only).
2. **Drain POW** — roll as a POW-increase roll (01-10 → 3, 11-40 → 2, 41-00 → 1) and **subtract** that from the opponent (temporary, recovered after the fight; **POW reduced to 0 = the loser ceases to exist**).
3. **Capture** — a combatant with current-POW superiority may overcome the opponent's resistance again to capture it. If the **spirit** wins it can possess the body; if the **character** wins he can bind the spirit with a Spirit Binding spell and exploit it.

## Shamans

A character of high POW may, through about a year's training and by obtaining a **fetch** (a separate spirit gained via the shaman's POW and CHA), become a **shaman** — a master of spirits who can find, bind, and command them, heal disease, and teach spirit magic. Bound spirits serve until freed (or until the shaman dies or cannot resurrect himself).

## Divine Intervention

Followers of a cult may, in extremity, beg their god to act directly — a roll on the **Divine Intervention Table** that costs POW. This belongs to rune magic and cult standing; see `10-rune-magic-and-cults.md`.
