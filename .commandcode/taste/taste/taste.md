# Taste
- Prefers documentation organized into purpose-based subfolders (e.g. problem-statement, specs, plan, reviews, presentation) rather than a flat `docs/` directory. Confidence: 0.6
- When handing over a design/UI asset (e.g. a Stitch HTML export, usually via a local file path), expects it to be implemented faithfully — same palette, typography, and layout — rather than reinterpreted or approximated from a spec. Confidence: 0.6
- Insists on no fabricated or unmeasured figures in UI/marketing surfaces; values that have no real data must degrade to a placeholder (e.g. an em dash) and read from live sources instead. Confidence: 0.5
- Likes new page styles scoped/namespaced so they don't clobber the existing app's theme (e.g. a separate scoped CSS file with its own token prefix). Confidence: 0.5
- Optimizes for speed of delivery: wants the change implemented and a build run, then stop — extra verification (dev servers, live route probing, manual browser checks) is seen as too time-consuming. Confidence: 0.75
- Prefers pnpm for running frontend scripts (e.g. `pnpm build`). Confidence: 0.5
- When supplying a concrete value (e.g. a literal CSS padding like `60px`), expects it applied verbatim rather than replaced by the agent's own approximation — substituting a different value reads as ignoring the instruction. Confidence: 0.6
- Favors minimal styling on the dark UI: dislikes decorative light chip/background treatments that clash (e.g. the global light `code` background), preferring plain, unstyled elements that "look fine" as-is. Confidence: 0.5
