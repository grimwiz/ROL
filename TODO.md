# TODO

- **Link artifacts to entities.** Allow a saved file/picture to be linked to an
  existing entity in the information tabs (a character, NPC, Place, or Thing),
  so the artifact shows on that entity and (if player-visible) reaches players
  with it. Open design points: entities are LLM-generated text blocks without
  stable IDs — links would need to key off entity name (fragile across
  regeneration) or a stored mapping; where the link UI lives (Edit Files vs the
  entity card); how a linked image renders on the card.

- **Archive / Unarchive files.** A pair of actions for files that should be
  kept but must not appear in, or feed into, any description or analysis
  (i.e. excluded from the GM/player source walks and the LLM context).
  Likely an `archive/` subfolder that the source/asset listers skip.
