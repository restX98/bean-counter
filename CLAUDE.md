# CLAUDE.md

## Branching
- `master` is always green: the test suite passes at every commit on it.
- Never commit directly to `master`.
- Branch names: `feature/`, `fix/`, `chore/`, `docs/` + topic. Lowercase, hyphenated.
- Merge when the topic is coherent and tests pass, then delete the branch.

## Commits
- One logical change per commit. If the message needs "and", split it.
- Conventional prefixes, imperative mood: `feat:`, `fix:`, `docs:`, `chore:`, `test:`.
- Write for a human reading `git log` in six months. Say why, not what.

## Session discipline
- When asked to plan, document, review, or scaffold, produce only that.
- Do not create or modify files not named in my request. Reading is fine.
- Problems noticed outside the current task get listed at the end, not fixed.
- Ask before adding any new dependency.
