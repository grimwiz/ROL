# LLM Prompt Sequence

These prompts are for iterative distillation from `private/extracted-source/rulebook-relevant.md`.

The intended flow is:

1. `00-source-inventory.md` - identify subjects, missing pieces, parse risks, and proposed logical order.
2. `01-logical-outline.md` - produce the target file/chapter structure without following the rulebook's teaching order.
3. `02-rules-draft.md` - draft one rules file at a time from the raw seed.
4. `03-scenario-draft.md` - draft one scenario reference file at a time from the raw seed.
5. `04-completeness-review.md` - compare a draft against the raw seed and list missing nuances.

Do not paste generated final text back into the raw source folder. Final paraphrased files go in `../rules/` or `../scenario/`.
