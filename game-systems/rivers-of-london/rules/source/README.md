# Source Staging

This folder is for preparing source material before distillation.

Generated raw source files belong in the repo-root `private/extracted-source/`, which is gitignored because it contains copied rulebook text. Final paraphrased rules files belong in `../`; scenario files belong in `../scenario/`.

## Build the Raw Seed

```bash
npm run extract:source
```

This writes:

- `private/extracted-source/rulebook-relevant.md`
- `private/extracted-source/manifest.json`
- `private/extracted-source/sections/*.md`

By default, the builder excludes *The Domestic*, front matter, bibliography, index, character-sheet facsimiles, contributor biographies, back-cover text, and Chapter 8's full scenario text.

To include Chapter 8 as optional scenario reference:

```bash
npm run extract:source -- --include-bookshop
```

## Use

Use `private/extracted-source/rulebook-relevant.md` as the full seed body for the LLM prompt sequence in `../prompts/`. The files in `private/extracted-source/sections/` are navigation and review aids for targeted follow-up, not the primary workflow.

The seed and section files are still copyrighted source material; do not treat them as publishable output.
