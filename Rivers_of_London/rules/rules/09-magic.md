# Newtonian Magic

<!-- Source: newtonian-magic, skills, core-rules, rules-summaries. Status: extracted-draft. -->

This file covers magic systems and procedures. Individual spell effects, spell prerequisites, and spell trees belong in `10-spells.md`.

## Magic Prerequisites

Human investigators need the Magical advantage before selecting the Magic skill. Magic begins at 60 when selected during standard character creation.

The Magic skill covers:

- Casting Newtonian spells.
- Detecting that a spell is being cast.
- Identifying a spell being cast on a strong enough detection result.

The Magic skill does not cover demi-monde magic. Demi-monde glamour, thematic powers, and related abilities belong in `11-demi-monde.md`.

## Vestigia

Magic leaves sensory traces called vestigia. Everyone has some ability to sense them, represented by Sense Vestigia as a common skill.

Starting values:

- Most human investigators: Sense Vestigia 30.
- Human investigators with Magic: Sense Vestigia 60 for free.
- Fae investigators: Sense Vestigia 60.

Sense Vestigia can be improved normally with development points. An investigator without Magic can also train this sensitivity during downtime; the Folly's formal Vestigia Sensitivity Training is a three-day programme that grants a development point to spend on Sense Vestigia.

Vestigia usually appear as sensory impressions: sound, smell, physical sensation, emotion, taste, visual flash, or a combination.

## Vestigia Strength

| Strength | Typical source | Detection |
|---|---|---|
| Weak | Old traces, background magical residue, or recent magic on material that retains vestigia poorly. | Regular success detects the main element. Hard success detects all elements. |
| Strong | Recent magic, supernatural activity, or accumulated human emotion retained by the environment. | Regular success detects all elements. |
| Extremely strong | Very powerful magic, sites saturated by intense emotion, or powerful supernatural presence. | Usually no roll is required. |

Calling for a Sense Vestigia roll can reveal that something strange is present. If that information itself should remain uncertain, the GM can use passive description or call for rolls only when the result matters.

## Vestigia as Clues

Vestigia can be colour, clue, or both.

- A vestigium may point to a person, location, event, emotional association, method, or repeated supernatural source.
- A practitioner's signare can be detected in the same manner as vestigia.
- The meaning of a vestigium may be indirect or only become clear in hindsight.
- If investigators detect vestigia but cannot interpret the clue, the GM may allow an INT roll to understand the connection.
- If a vestigium is essential to keep the case moving, give the clue without a roll or make the roll add extra context rather than gate progress.

## Vestigia Retention

Materials retain vestigia differently.

| Material | Retention |
|---|---|
| Stone | Excellent retention; old buildings can hold heavy traces. |
| Concrete | Nearly as good as stone. |
| Metal | Weaker than stone and concrete. |
| Wood | Weaker than metal. Green wood dampens magic and can act as a magical insulator. |
| Plastic | Variable; some plastics, including PVC, retain vestigia very well. |
| Corpses | Poor retention. Magic strong enough to kill may leave traces, but usually only for a few days. |

## Signare

Every practitioner has a distinctive magical signature called a signare. Other practitioners and some demi-monde beings can perceive it through Sense Vestigia.

Rules:

- Detect signare with Sense Vestigia using the vestigia rules.
- Signare can identify the practitioner behind a spell or magical trace if the observer has sufficient context.
- A teacher's signare leaves an inherited element in apprentices.
- A practitioner investigator creates a signare during character creation.
- A signare usually combines two or three sensory elements.
- If trained by a practitioner with a known signare, include one element from the teacher's signare as a third element.

Fae investigators generally do not have signare. A successful Sense Vestigia roll on a fae investigator reveals something strange and otherworldly rather than a practitioner signature.

## Newtonian Spells

Newtonian spells are built from mental forms called formae. A spell using one forma is first order. Higher-order spells use multiple formae.

Core spell terms:

| Term | Meaning |
|---|---|
| Order | Spell complexity and base magic point cost. |
| Base cost | Magic points equal to the spell's order. |
| Prerequisite | Spell or mastered spell required before learning another spell. |
| Mastered spell | A spell practised enough to cast more reliably and sometimes boost. |
| Boost | Extra magic points spent on a mastered spell to increase or alter its effect, if the spell allows it. |

Spell prerequisites are mandatory. An investigator cannot choose or learn a spell unless all listed prerequisites are met. If a spell entry lists no prerequisites, none are required.

## Starting Spells

Starting practitioners are created in `03-character-creation.md`.

Standard starting package:

- Two first-order spells, one mastered and one unmastered.
- One second-order spell, unmastered.

Newtonian apprentices start with Werelight mastered. Hedge wizards choose which first-order spell is mastered.

## Learning and Mastering Spells

During an investigator development phase, a practitioner may spend development points to learn spells or master spells. Full development point procedure belongs in `05-advancement.md`.

Magic-specific limits:

- Learning one new spell costs 1 development point.
- Mastering one known unmastered spell costs 1 development point.
- A practitioner can learn at most one new spell per development phase.
- A practitioner can master at most one spell per development phase.
- With 2 development points, a practitioner may learn one spell and master one spell in the same development phase.
- Knowing higher-order spells requires a balanced foundation: a practitioner cannot know more spells in any order than in any lower order.
- To learn spells of the next order up, a practitioner must know at least two spells of the current order.
- To master a spell of the next order up, a practitioner must have mastered at least two spells of the current order.
- Mastery is permanent.

## Magic Points

Maximum magic points:

```text
POW / 5 + number of mastered spells
```

Rules:

- Divide POW by 5 using the normal value from the character sheet.
- Each mastered spell adds +1 maximum magic point.
- When a spell is mastered later, maximum magic points increase by 1.
- Casting a spell costs magic points equal to the spell's order.
- Spent magic points recover at the next scene.
- If current magic points are zero, a practitioner may still attempt spells, but must roll for HTD each time.
- Do not track negative magic points.

## The Next Scene

Spent magic points refresh to normal maximum at the next scene.

A next scene requires a meaningful break, usually about 30 minutes or more. Moving between rooms is not enough. Travelling across London usually is enough. The GM decides when enough time has passed.

## Casting Procedure

Use this procedure when time pressure, danger, uncertainty, combat, exceptional circumstances, or dramatic stakes matter.

1. Choose the spell and any boost.
2. Confirm the spell is known and prerequisites are satisfied.
3. Spend the spell's base magic point cost, plus boost cost if any.
4. Apply mastered, combat, exceptional-circumstance, and other modifiers.
5. Roll Magic unless the no-pressure rule applies.
6. Resolve the result.

Spellcasting takes one combat round or the narrative equivalent. In combat, casting uses the caster's action for the round.

## No-Pressure Casting

If the caster has unlimited time and no pressing concern, no Magic roll is required. The spell works eventually.

Procedure:

1. Spend the spell's cost as normal.
2. Roll `1D100` for the number of minutes required to cast safely.
3. Assume the caster rests enough between attempts to recover any spent magic points.

This shortcut does not apply in combat or exceptional circumstances.

## Spellcasting Results

| Result | Effect |
|---|---|
| Critical, Hard, or Regular success | The spell works as intended. |
| Failure | The spell produces an unintended, weak, misplaced, strange, or missed effect. The GM decides. |
| Fumble | The caster's current magic points drop to zero and the caster rolls for HTD. |

On an initial failure, Luck may be spent to make the Magic roll succeed if the roll is not a fumble. Outside combat, the roll may instead be pushed.

Failure should usually avoid significant direct harm to the caster unless the roll was pushed, fumbled, or made with zero magic points.

## Mastered and Unmastered Casting

| Spell state | Normal casting | Exceptional circumstances | Combat |
|---|---|---|---|
| Mastered | Gain a bonus die on the Magic roll. | The mastered bonus die cancels the exceptional-circumstance penalty die. | The mastered bonus die cancels one combat penalty die. |
| Unmastered | No automatic modifier. | Apply one penalty die. | Apply normal combat bonus or penalty dice. |

Standard multiple bonus/penalty die cancellation rules apply. A mastered spell's bonus die may cancel one penalty die, but it does not create more than one net bonus die.

## Pushing Spellcasting

Outside combat, a failed initial Magic roll can be pushed. Combat spellcasting cannot be pushed.

Requirements:

- The original magic point cost has already been spent.
- The player describes extra time, focus, force, altered movement, stronger vocalisation, or another plausible push.
- No additional magic point cost is paid for the pushed roll.
- If the spell is mastered, the pushed Magic roll still gains the mastered bonus die unless cancelled by another penalty.

Outcomes:

| Pushed result | Effect |
|---|---|
| Success | The spell works normally. No additional magic points are spent. |
| Failure | The spell works normally, current magic points drop to zero, and the caster rolls for HTD. |
| Fumble | The spell fails, current magic points drop to zero, and the caster rolls for HTD with a penalty die. |

Luck cannot alter a pushed roll.

A caster may choose not to push and instead attempt a fresh casting later. A fresh casting costs the spell's magic points again.

## Exceptional Circumstances

Exceptional magical circumstances include areas imbued with magic, magically intensified or dampened environments, altered magical conditions, and similar situations.

Rules:

- Apply one penalty die to the Magic roll.
- A mastered spell's bonus die cancels this penalty die.
- On success, the spell works normally.
- On failure, use the normal failed spellcasting rules.
- On fumble, current magic points drop to zero and the caster rolls for HTD.

Drunkenness or recreational drug use counts as exceptional circumstances because spellcasting requires a focused mind.

## Spellcasting in Combat

Combat spells use the ranged attack framework unless the spell says otherwise.

- Roll Magic instead of Firearms.
- The same roll determines whether the spell is cast and whether it hits.
- Combat spellcasting cannot be pushed.
- Luck can alter a failed combat Magic roll unless the roll is a fumble.
- The target has the same response options as against firearms, such as diving for cover or fighting back if the combat rules allow it.
- Ranged attack modifiers apply to spell attacks.
- Spell damage rolls usually use the caster's DEX.
- If a spell deals base weapon damage, add that base damage to the damage roll result.

Common ranged modifiers that also apply to spell attacks include point-blank range, aiming, cover/concealment, fast-moving targets, and target size. Full combat handling belongs in `06-combat.md`.

## Boosting Spells

Only mastered spells can be boosted, and only if the spell entry includes a boost effect.

Rules:

- A boost is any magic point cost above the spell's base cost.
- The maximum boost on a single spell equals the highest order of spell the caster has mastered.
- The base cost remains the spell's order.
- Boost effects are listed in individual spell entries.
- Some boosts increase size, range, duration, damage, brightness, quantity, or control.
- Some spells allow additional magic points later to sustain the spell.

Adjectivia and inflectentes are magical techniques that modify or bend formae; in rules terms, they are usually represented by boost effects, mastery effects, prerequisites, or higher-order spell construction.

## Sensing Spellcasting

When a character begins casting a spell, nearby practitioners can attempt a Magic roll to detect it before the caster's spellcasting roll is resolved.

| Detection result | Effect |
|---|---|
| Regular success | The observer senses that a spell is being prepared, but not which spell. |
| Hard success or better | The observer senses that a spell is being prepared. If familiar with the spell, the observer identifies it by name. If unfamiliar, the observer gets a hint of the spell's likely effect. |
| Failure | The observer does not detect enough to act on. |

A practitioner who detects the casting may be able to cast rapidly in response under the combat rules for fighting back with magic.

If an NPC begins casting, the GM should offer eligible practitioner investigators the detection roll.

## Spells and Technology

Powered microprocessors are vulnerable to magical discharge. Unpowered microprocessors are safe. Devices without microprocessors are generally immune.

This destruction is commonly called sanding because the silicon chip is reduced to fine sand.

| Device position | Effect |
|---|---|
| Powered device within arm's length, about 1 metre/yard | Chip is destroyed automatically. |
| Powered device beyond arm's length but within point-blank range, 1-3 metres/yards | Chip is destroyed if the owner or carrier fails a Hard Luck roll. |
| Powered device beyond 3 metres/yards and within 15 metres/yards of a boosted spell | Chip is destroyed if the owner or carrier fails a Regular Luck roll. |

Operational notes:

- Disconnecting the battery or power source protects the device.
- Spare phones and removable batteries are useful precautions for practitioners.
- Mechanical watches and vehicles without electronic engine management avoid this risk.
- Sudden combat, surprise spellcasting, or urgent reactions may justify an INT roll to determine whether the investigator remembered to disconnect vulnerable gear.
- Outside sudden pressure, assume trained investigators take routine precautions unless device loss would be interesting.

## Hyperthaumaturgical Degradation

Hyperthaumaturgical Degradation (`HTD`) is the physical harm caused by overuse or mishandling of magic.

Roll for HTD when:

- A spellcasting Magic roll fumbles.
- A pushed spellcasting roll fails.
- A pushed spellcasting roll fumbles.
- A practitioner casts while at zero magic points.
- Another rule or magical hazard calls for an HTD roll.

HTD procedure:

1. Set current magic points to zero.
2. Roll POW.
3. If the trigger was a fumbled pushed spellcasting roll, apply one penalty die to the POW roll.
4. Apply the result below.

| POW result | HTD effect |
|---|---|
| Critical success | No damage. |
| Hard success | 1 damage. |
| Regular success | 2 damage. |
| Failure | 4 damage: Mortal Wound. |
| Fumble | 5 damage: Fatal Blow. The investigator dies unless 30 Luck is spent immediately to reduce it to a Mortal Wound. |

HTD damage can cause impairment through the normal wound rules. Steadfast does not protect against HTD impairment.
