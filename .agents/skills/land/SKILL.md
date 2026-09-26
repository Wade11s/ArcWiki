---
name: land
description: >-
  Land ArcWiki changes on the intended GitHub main branch. Invoke only when the
  user explicitly requests landing or merging, including the Land Changes
  action; not for review, preparation, passing checks, or skill installation.
disable-model-invocation: true
metadata:
  delta-action: land
---

# Land ArcWiki changes

An invocation of this skill is the landing request. Proceed through the landing workflow; do not ask for the same merge permission again. Stop only for a genuine blocker, ambiguous scope or conflict, an unmet contribution requirement, or a failed or unverifiable required check.

## 1. Establish scope and destination

- Work in the attached ArcWiki Delta worktree. Inspect status, the current branch, remotes, and the requested change's files. Include this skill itself when it belongs to the requested change. Selectively stage only in-scope files, including untracked source files; preserve unrelated user changes. Do not stage generated executables, `src-tauri/target/`, or credentials. [`.gitignore`](../../../.gitignore#L1-L18) identifies generated and local-only files; [the credential boundary](../../../AGENTS.md#L7-L10) is binding.
- Verify `origin` still points to the intended GitHub repository, `Wade11s/ArcWiki`, and that its default destination is `main`. `local` is a backlink to the user's primary checkout, not a publication remote; leave that checkout untouched. Confirm the current destination's branch rules, required checks, review requirements, and contribution policy rather than assuming today's unprotected state persists. If the target or requested scope is ambiguous, ask one focused question.
- Create an unpublished topic branch for the scoped work if necessary, then make a descriptive commit without an interactive editor (`GIT_EDITOR=true git commit -m "..."`). Do not amend or rebase a published/shared commit. Compare the staged file list and diff with the intended scope, check whitespace, and ensure no key or session token value is included before committing.

## 2. Verify the exact candidate

- Install dependencies only if needed, using the checked-in manifests and lockfile (`bun install --frozen-lockfile`; [`package.json`](../../../package.json#L15-L33), [`bun.lock`](../../../bun.lock)). Run checks appropriate to the files being landed **after** the final reconciliation with `origin/main`, not just on an earlier version:
  - `bun run test` for sidecar or UI behavior; its script covers `sidecar` and `src` ([`package.json`](../../../package.json#L13)).
  - `bun run build` for frontend changes; it type-checks and builds the UI ([`package.json`](../../../package.json#L9-L10)).
  - `bun run desktop:build` for Tauri, sidecar packaging, or desktop release changes; it builds the sidecar before packaging ([`package.json`](../../../package.json#L11-L12), [`scripts/build-sidecar.ts`](../../../scripts/build-sidecar.ts#L13-L25), [`src-tauri/tauri.conf.json`](../../../src-tauri/tauri.conf.json#L44-L53)).
  - For changed desktop GUI behavior, test the affected interaction with `cua-driver`, snapshotting the window before and after each action and checking the result. An unverified injected gesture is not a pass ([`AGENTS.md`](../../../AGENTS.md#L9-L10)).
- For this thread's cross-layer desktop change, run all three Bun commands above and the applicable GUI check. If a required GUI check cannot be observed, obtain specific human verification of the **current build** or report a blocker; do not substitute a passing compilation.
- Confirm `git diff --check` and the final staged/committed contents. If any check fails, fix it and rerun the affected checks on the revised candidate. Do not land while a required local or remote check is failing, pending, missing, or unverifiable.

## 3. Reconcile and land

- Fetch `origin/main` before publication. Rebase only the unpublished topic commit(s) if the destination advanced. The user's preference is to resolve conflicts automatically **when the intended result is clear**. Preserve unrelated work; if intent is ambiguous or a resolution is unsafe, abort the in-progress operation, report that nothing landed, and ask for a decision. Rerun applicable verification after any reconciliation changes the candidate.
- If current destination policy still permits direct changes and imposes no unmet review/check gate, push a non-forced fast-forward of the verified commit to `origin/main`. Never force-push or use `local` for publication. A rejected push is not success: fetch, reconcile, reverify, and retry safely, or report the blocker.
- If destination policy now requires a pull request, publish an unpublished topic branch to `origin`, create a PR against `main`, and meet the actual review and submission requirements. Obtain human-authored text if a contribution policy requires it; agent-written text plus approval is not a substitute. Wait for **all required** checks and reviews on the PR's final head commit to pass before invoking a supported GitHub merge method; never use admin bypass or auto-merge to skip this gate. A merge queue submission is not success until the change actually reaches `main`. If requirements cannot be met, report not landed.
- Verify the result against the actual `origin/main` commit and GitHub state. A prepared commit, topic push, open PR, or started check is not a completed landing.

## 4. Report the outcome

- In a subthread, when `report_subthread_status` is available, report `success` only after verifying the requested change reached the destination; use `failure` for a failed attempt or genuine blocker. Otherwise report directly here. Failure is nonterminal: continue safe recovery when permitted, then report the verified updated outcome.
- Use a short sentence-case title and a one-line description. Link the verified short commit SHA to its actual commit URL and, when remote CI applies, link the actual passed or failed check/run. Omit nonexistent or unverified links; local checks may be named without a CI URL. State explicitly when the change was **not** landed. Do not report skill installation or routine progress as landing success.
