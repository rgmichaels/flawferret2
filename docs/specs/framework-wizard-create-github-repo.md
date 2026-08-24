# Framework wizard: create a new GitHub repository as a destination option

Status: Reconciled against FLW-2 and implemented
Date: 2026-08-24

Jira: FLW-2. The first draft of this spec was written without access to FLW-2's
description. It has since been reconciled against the authoritative ticket
text; the "Reconciliation notes" section at the bottom records where the draft
drifted and what changed.

## Problem

In the "Where" section of the framework build form
(`apps/web/app/framework/new/framework-folder-picker.tsx` — a single-page form
since the wizard consolidation in
`docs/specs/framework-builder-wizard-consolidation.md`), choosing "GitHub
repository" as the destination only lets you target a repository that already
exists — either one already registered in FlawFerret2 (the "Choose Registered
Repository" dropdown) or one typed in manually via Owner/Repository/Branch.
Server-side, `createFrameworkPullRequest` in
`apps/api/src/framework-template.ts` assumes the repo and branch already exist:
it opens with `GET /repos/{owner}/{repo}/branches/{branch}`, which 404s for a
repo that doesn't exist yet. That blocks the "build a framework straight into a
fresh GitHub repo" flow.

(A related but distinct capability already exists for the **local**
destination: `createGithubRemoteForLocalFramework` creates a GitHub repo and
pushes an already-initialized local git repo to it as `origin`. That path is
unaffected by this spec.)

## Proposed change

App: `apps/api` (primary), `apps/web` (form UI), `packages/job-schemas` (shared
contract). No `packages/db` migration — `FrameworkBuild` already stores
`githubOwner`/`githubRepository` per build, and a build that created its own
repo is recorded the same way an existing-repo build is. No
`JobStatus`/`JobEventType` change — framework builds are not job-lifecycle
events.

**Shared schema (`packages/job-schemas/src/index.ts`):** reuse the existing
`createGithubRepository` boolean on `createFrameworkRequestSchema` for the new
sub-option rather than adding a second "create a repo" flag — it is currently
only consumed when `destinationType === "local"`, and this change makes it
meaningful for `destinationType === "github"` too. Add
`githubRepositoryVisibility: z.enum(["private", "public"]).default("private")`
for the visibility choice. The local-destination path keeps its hardcoded
`private: true` (out of scope here).

**Web (`apps/web/app/framework/new/framework-folder-picker.tsx`):** add a
"Create a new GitHub repository" checkbox as the first control inside the
GitHub destination block, so the ways to specify a GitHub target stay clearly
distinct: (1) pick a registered repo, (2) type owner/repo/branch of an existing
repo, (3) create a new repo. When it is checked:

- The "Choose Registered Repository" dropdown is hidden and any selected
  registered-repo id is cleared — a not-yet-created repo can't be a registered
  one.
- Owner stays editable (your GitHub username, or an org your token can create
  repositories in) and Repository is prefilled from the package name if empty.
- The Branch input is replaced by a Visibility select (Private default /
  Public). A brand-new repo's default branch is whatever GitHub creates on
  `auto_init`, so there is nothing meaningful for the user to pick there.

`FrameworkGithubPushToggle` (the "After building" local-push disclosure) must
stop rendering its hidden `createGithubRepository=false` fallback when the
destination is GitHub, or — because it sits after the picker in the form — it
would win the last-value-wins read in `getCheckedFormValue`.

**API (`apps/api/src/framework-template.ts`):** in `createFrameworkPullRequest`,
before any other GitHub call, when `request.createGithubRepository` is `true`
and `request.destinationType === "github"`:

1. Resolve owner vs. org the same way `createGithubRemoteForLocalFramework`
   already does (`GET /user`, case-insensitive login match), then create the
   repository via `POST /user/repos` or `POST /orgs/{owner}/repos` with
   `auto_init: true` and `private: githubRepositoryVisibility !== "public"`.
   `auto_init` matters: a repo created without it has no branches, and the
   existing branch → tree → commit → PR flow has nothing to base off.
2. Target the created repo's `default_branch` for the base branch and the PR
   base, rather than the wizard's Branch value — GitHub picks the default
   branch name from the account/org setting on `auto_init`, and it can't be
   set at creation time.
3. Treat the build as overwriting for a newly created repo: the only content
   there is GitHub's `auto_init` README stub, and reporting the generated
   README as "skipped" on a repo the user just created would be confusing.
4. Translate GitHub's "name already exists on this account" 422 into a plain
   message naming the repo and pointing at the two ways out (rename, or clear
   the checkbox). It surfaces through the existing `createError` banner on the
   form — no new error UI.
5. Everything after that — per-build `flawferret/create-framework-...` branch,
   tree, commit, pull request — runs unchanged, so a new repo gets its first
   framework commit through the same human-review PR gate as an existing repo.

No change to `createGithubRemoteForLocalFramework` or the local-destination
flow.

## User stories / acceptance criteria

- From the Destination section, selecting GitHub + "Create a new GitHub
  repository" and submitting the form creates a new repo on GitHub with the
  generated framework files and opens a pull request against the new repo's
  default branch.
- Given the repository name already exists under the chosen owner, when I
  submit, then I see a clear error naming the repository and no files are
  partially created (repo creation is the first write; nothing else runs).
- Given I leave Visibility on its "Private" default, then the created
  repository is private; choosing "Public" creates a public one.
- Given an owner that is an organization the token can access, then the repo
  is created via `POST /orgs/{owner}/repos` instead of `POST /user/repos`.
- Given "Create a new GitHub repository" is checked, then the "Choose
  Registered Repository" dropdown is hidden.
- The existing "commit to an existing repo" GitHub flow is unaffected: with
  the box unchecked, no repo-creation or `/user` call is made.
- New tests pass; existing framework-template tests still pass.

## Out of scope

- Connecting an already-created local git repo to a newly created GitHub
  remote (the push flow) — that is the follow-up once "local git init" (FLW-1)
  and this ticket both exist.
- Org/team permission management beyond typing an owner the token can already
  create repositories in. In particular, no org-listing API call or owner
  dropdown: the Owner field stays free text, and the server resolves user vs.
  org from `GET /user`.
- Any change to the local-destination repo-creation flow
  (`createGithubRemoteForLocalFramework`), including its hardcoded
  `private: true`.
- Automatically registering the newly created repository as a FlawFerret2
  `Repository` — `github`-destination builds have no "register after build"
  toggle at all today, and adding one is a separate feature.
- Repo-creation defaults beyond private/public (issues, wiki, project boards,
  branch protection, templates).
- Deleting or rolling back a repository if the commit or PR step fails after
  creation succeeds — surfaced as an error, matching how the local
  destination's "failed" status already leaves a created-but-unfinished repo
  in place.

## Reconciliation notes (draft vs. FLW-2)

- **Field naming.** The draft proposed a boolean `githubRepositoryPrivate`.
  FLW-2 describes the input as "visibility (private/public)", so the shared
  field is `githubRepositoryVisibility: "private" | "public"` (default
  `private`) instead. Reusing `createGithubRepository` for the toggle itself
  is unchanged from the draft.
- **Owner selection.** FLW-2 mentions "owner (user vs. an org, if the token
  has org access)" but scopes out "org/team permission management beyond
  selecting an existing accessible owner". Implemented as a free-text Owner
  field with server-side user-vs-org resolution rather than a fetched
  organization dropdown, which would need a new API route. Called out as an
  assumption in case a picker was intended.
- **Branch handling.** The draft left an open question about renaming the
  `auto_init` branch to match the wizard's Branch field. FLW-2 says to target
  "the new repo's default branch", so the rename step is dropped: the Branch
  input is hidden when creating a new repo and the flow follows GitHub's
  actual default branch.
- **Draft PR.** FLW-2's acceptance criteria mention "a draft PR" while also
  saying to use "the same commit + draft PR path already used for existing
  repos". The existing path opens a normal (non-draft) PR, and changing that
  would alter the existing-repo flow that FLW-2 requires stay unaffected, so
  PRs stay non-draft for both.
- **Blank owner.** The draft suggested resolving a blank Owner to the
  authenticated user. The shared schema already requires an owner for the
  GitHub destination, so the form still requires it; the server-side fallback
  exists only as a defensive default.
- **Wizard structure.** The draft referred to wizard steps
  ("Review/Results steps"). The form is a single page as of
  `docs/specs/framework-builder-wizard-consolidation.md`; errors surface in
  the existing single `createError` banner.
