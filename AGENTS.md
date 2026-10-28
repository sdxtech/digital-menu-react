# Project Working Rules

## 1. Git Workflow

* Before making any code changes, check the current Git branch.
* If the current branch is `main`, switch to `dev` first, then create a focused feature/fix branch from `dev` before editing files, unless the user explicitly says otherwise.
* If the current branch is another protected base branch, create a focused feature/fix branch before editing files, unless the user explicitly says to work on the current branch.
* Do not commit, push, merge, rebase, force-push, or delete branches unless explicitly requested.
* Do not use destructive Git commands such as `git reset --hard`, `git clean -fd`, or force checkout without explicit approval.

### Branch Naming

Branch names must use lowercase kebab-case with a short type prefix:

* `fix/<short-description>` for bug fixes.
* `feat/<short-description>` for new features.
* `chore/<short-description>` for maintenance.
* `refactor/<short-description>` for internal code cleanup without behavior changes.

Examples:

* `fix/disable-number-input-wheel`
* `feat/store-request-export`
* `chore/update-dependencies`
* `refactor/store-request-service`

Keep branch names specific and concise.

### Local and Deployment Synchronization

* Treat the branch and commit SHA as the source of truth; local, CI, staging, and production must not be assumed to contain the same code merely because they use the same repository.
* Before starting work, fetch remote refs and verify the active branch and recent commits. If working from `dev`, fast-forward it from `origin/dev` before creating a feature or fix branch.
* When preparing changes for merge or deployment, verify that the tested branch contains the intended fix and that the intended deployment source is the same branch/commit. Do not recommend or prepare deployment from an unrelated feature branch, stale local branch, uncommitted working tree, or manually copied build output.
* Deployment remains user-owned. Before handing off a deployable change, record the exact source commit SHA with `git rev-parse HEAD` so the user can verify that the deployed SHA matches the commit that passed validation/CI.
* After merging a fix into `dev`, ensure feature branches are rebased or recreated from the updated base before continuing related work. Do not assume a commit in another branch is available locally.
* Keep CI checks required for merge/deploy: type-check, lint, tests, and the affected application build. Treat a failed or skipped check as a deployment blocker unless explicitly approved.
* When diagnosing local-versus-deployed differences, compare `git rev-parse HEAD`, `git status --short`, `git branch --show-current`, and the deployed commit SHA before changing code or data.
* Prefer exposing the running commit SHA through the application version/health information when the project supports it, so environment drift can be identified quickly.

---

## 2. Task Execution Strategy

* Start with the smallest relevant scope.
* Understand the requested behavior before making changes.
* Resolve straightforward implementation details independently using the existing project conventions.
* Do not ask for clarification when the intent can be reasonably inferred from the request and existing codebase.
* Ask for clarification only when ambiguity could materially change behavior, architecture, security, or data.
* Prefer a safe and minimal implementation over presenting multiple theoretical approaches.
* Do not propose or implement architecture changes unless the task requires them.
* For bug fixes, identify the root cause before modifying code.
* For new features, find the closest existing feature with similar behavior and follow its implementation pattern.
* Do not continue exploring once enough information is available to safely implement the task.

---

## 3. Repository Search Strategy

* Do not scan or read the entire repository unless genuinely required.
* Inspect only files, modules, routes, components, services, schemas, models, and tests directly related to the task.
* Use targeted searches before broad repository searches.
* Avoid repeatedly reading files that have already been inspected unless they changed or additional context is required.

Search in this order:

1. Exact filename or module/component name.
2. Exact function, class, variable, DTO, schema, model, or route.
3. API endpoint, UI label, error message, or other exact string related to the task.
4. Closest existing feature with similar behavior.
5. Broader repository search only if previous searches fail.

Do not perform broad repository exploration before targeted searches.

---

## 4. Context Management

* Keep working context focused on the current task.
* Do not load unrelated modules or large amounts of unrelated code.
* Focus on relevant functions and sections instead of repeatedly reading entire large files.
* Reuse information already discovered during the task.
* Avoid reopening unchanged files without a reason.

Ignore these directories and files by default unless explicitly relevant:

* `node_modules`
* `dist`
* `build`
* `.next`
* `.turbo`
* `.cache`
* `coverage`
* `.git`
* logs
* temporary files
* generated files
* database dumps
* large exported datasets
* uploaded assets unrelated to the task

---

## 5. Project Boundaries

Before editing, determine which layer the task belongs to:

* Frontend
* Backend
* Database
* Infrastructure
* Shared/common code

Stay within the relevant layer whenever possible.

* For frontend-only tasks, do not inspect backend internals unless the API contract is unclear or relevant to the requested behavior.
* For backend-only tasks, do not inspect frontend code unless request/response usage must be verified.
* Do not modify database schemas for application-only changes unless necessary.
* Do not modify infrastructure for application changes unless necessary.
* Do not modify multiple layers simply for consistency if the requested behavior does not require it.

---

## 6. Before Making Changes

* Inspect the relevant implementation before editing.
* Understand the existing execution flow before changing behavior.
* Follow the project's existing architecture, directory structure, naming conventions, and coding patterns.
* Check for existing utilities, components, services, hooks, DTOs, schemas, models, helpers, and shared functions before creating new ones.
* Prefer extending existing implementations over introducing duplicate logic.
* Identify the smallest set of files required to complete the task.
* Check related tests when they exist.

---

## 7. Change Scope

* Make the smallest reasonable change required to complete the requested task.
* Do not perform unrelated refactoring.
* Do not perform unrelated formatting, renaming, cleanup, or optimization.
* Do not modify unrelated files.
* Preserve existing behavior unless the requested change explicitly requires changing it.
* Preserve existing public APIs and contracts unless the task requires changing them.
* Avoid introducing new abstractions unless they provide a clear benefit for the requested change.
* Do not restructure directories as part of a small feature or bug fix.
* Preserve existing formatting outside modified code.

---

## 8. Decision Making

* If multiple valid implementations exist, choose the simplest solution that matches existing project patterns.
* Treat existing project conventions as the default decision.
* Prefer consistency with nearby code over introducing a new pattern.
* Do not stop to present multiple implementation options unless there is a meaningful architectural, security, performance, or data-integrity tradeoff.
* Avoid overengineering.
* Avoid speculative changes for hypothetical future requirements.
* Implement what is required now.

---

## 9. Code Quality

* Keep implementations simple, readable, and maintainable.
* Avoid unnecessary duplication.
* Use descriptive names consistent with the existing codebase.
* Prefer small focused functions over unnecessarily large functions.
* Do not create wrapper functions that only forward calls without adding meaningful behavior.
* Avoid unnecessary abstractions for one-off logic.
* Remove temporary debugging code before finishing.
* Do not leave commented-out code.
* Remove unused imports, variables, and functions introduced by the change.
* Do not introduce `any`, ignored TypeScript errors, disabled lint rules, or similar workarounds unless there is a justified reason.
* Do not suppress errors merely to make validation pass.

---

## 10. Dependencies

* Do not add, remove, or upgrade dependencies unless necessary for the requested task.
* Prefer existing project dependencies and native platform capabilities.
* Ask for approval before introducing a significant new dependency.
* Do not replace an existing library simply because another library could solve the same problem.
* Do not modify lockfiles unless dependency changes require it.
* Do not add or use the `keyv`, `cacheable`, `@keyv/*`, or `@cacheable/*` libraries. Treat them as prohibited dependencies due to malware risk.

---

## 11. Database and Data Safety

* Do not drop databases, collections, tables, indexes, or production data without explicit approval.
* Do not truncate or reset data without explicit approval.
* Do not execute destructive migrations without explicit approval.
* Do not reset migration history unless explicitly requested.
* Never assume development data can safely be deleted.
* Preserve backward compatibility when modifying schemas unless explicitly instructed otherwise.
* Review migrations for potential data loss before executing them.
* Prefer additive schema changes when practical.
* Do not execute production database operations unless explicitly requested.

---

## 12. Environment and Secrets

* Never expose, print, commit, or hardcode passwords, API keys, tokens, connection strings, private keys, or other secrets.
* Do not modify `.env` files unless explicitly requested.
* Do not modify production configuration unless explicitly requested.
* When new environment variables are required, update the appropriate example/template configuration where applicable.
* Never replace active credentials with placeholder values.
* Do not log secrets or sensitive environment values for debugging.

---

## 13. Error Handling

* Do not silently ignore errors.
* Preserve existing project error-handling conventions.
* Handle expected failure states explicitly.
* Validate external and user-controlled input at appropriate boundaries.
* Do not expose internal stack traces, credentials, database details, or sensitive implementation information to end users.
* Do not catch exceptions only to discard them unless intentionally justified.

---

## 14. Implementation Efficiency

* Prefer modifying an existing function, component, service, hook, utility, or module over creating a parallel implementation.
* Reuse existing code where appropriate.
* Avoid introducing unnecessary files.
* Avoid unnecessary abstractions.
* Avoid unnecessary indirection.
* Avoid redesigning existing interfaces when a small extension is sufficient.
* Do not rename unrelated variables, functions, files, classes, or components.
* Do not rewrite working code simply to match personal style preferences.

---

## 15. Command Execution

* Prefer non-interactive commands.
* Avoid commands that start long-running development servers unless required.
* Do not start duplicate development servers, watchers, workers, Docker containers, or background processes.
* Check whether required services are already running before starting new ones.
* Before starting Docker services, check existing container status.
* Prefer starting only required Docker services instead of the entire stack when possible.
* Stop temporary processes started solely for validation when they are no longer needed.
* Do not repeatedly execute expensive commands without a reason.

---

## 16. Validation Strategy

After making changes, run relevant validation available in the project.

Use the cheapest and most targeted validation first.

Recommended order:

1. Syntax/type validation for affected code.
2. Targeted linting.
3. Targeted unit tests.
4. Targeted integration tests.
5. Affected package/module build.
6. Full project validation only when justified.

Additional rules:

* Prefer targeted tests for the affected module before running the full test suite.
* Run full builds or full test suites when changes affect shared/core functionality or when targeted validation is insufficient.
* Do not repeatedly run the same validation command if no relevant code changed after the previous successful run.
* If validation cannot be run, clearly state why.
* Do not claim a change works unless it was validated, or explicitly state that it was not verified.

---

## 17. Failure Handling

* If a command fails, inspect the actual error before taking another action.
* Do not blindly retry the same failing command.
* Do not repeatedly try random fixes.
* Determine whether the failure was introduced by the current change.
* Distinguish current-change failures from pre-existing project failures.
* Do not modify unrelated code just to make validation pass.
* If an error is clearly unrelated and pre-existing, report it instead of fixing it automatically.
* If the selected approach is clearly incorrect, reconsider the implementation instead of stacking workarounds.

---

## 18. Large Changes

For tasks affecting multiple modules or layers:

* Break implementation into small logical changes.
* Work on one logical layer at a time.
* Validate each significant layer before moving to the next when practical.
* Avoid modifying frontend, backend, database, and infrastructure simultaneously unless required.
* Reuse existing contracts between layers instead of redesigning them.
* Keep each change focused on the requested behavior.

---

## 19. Performance-Sensitive Changes

When modifying performance-sensitive code:

* Measure or identify the actual bottleneck before optimizing.
* Do not perform speculative optimization.
* Avoid introducing caching unless there is a clear need and invalidation behavior is understood.
* Avoid unnecessary database queries, network calls, filesystem operations, and repeated computation.
* Preserve correctness before optimizing performance.

---

## 20. Security

* Treat all user-controlled input as untrusted.
* Preserve authentication and authorization checks.
* Do not bypass permission checks to make a feature work.
* Do not weaken validation, authentication, authorization, CORS, CSRF, rate limiting, or other security controls without explicit instruction.
* Use parameterized database queries or existing ORM/query-builder mechanisms.
* Do not construct unsafe raw queries from user-controlled input.
* Do not expose sensitive internal fields through API responses unless required.

---

## 21. Definition of Done

A task is complete when:

* The requested behavior is implemented.
* The root cause is addressed for bug fixes.
* No unrelated behavior was intentionally changed.
* The implementation follows existing project conventions.
* Relevant validation passes.
* Temporary/debug code is removed.
* No unnecessary dependency was introduced.
* No secrets were exposed.
* The diff is limited to files required by the task.

Once these conditions are met, stop.

Do not continue refactoring, optimizing, cleaning up, or improving unrelated code after the requested task is complete.

---

## 22. Completion Report

After completing a coding task, provide a concise summary containing:

* What was changed.
* Which files were changed.
* What validation was run and its result.
* Any validation that could not be run.
* Any remaining risks, assumptions, or follow-up work directly related to the task.

Keep the report concise.

Do not reproduce large code diffs unless requested.

Do not create commits, push branches, open pull requests, merge branches, or deploy changes unless explicitly requested.

---

## 23. Page Titles for New or Changed Routes

* Whenever adding a page or adding, renaming, or moving a route, update the matching browser document title in `frontend/src/lib/document-title.ts` in the same change.
* Check every new route, including shared dashboard routes and nested routes; do not assume adding a route in `frontend/src/App.tsx` automatically registers its document title.
* Keep the browser title consistent with the page heading and navigation label, following the existing `<Page Title> | SPICES` format.
* Before marking the task complete, verify that each affected valid route resolves to its intended title and never falls back to `Page Not Found`. Preserve that fallback for genuinely unknown routes.
* Run `node --test tests/document-title.test.ts` from `frontend` after adding or changing routes. This existing test checks title coverage for every route registered in `App.tsx`; treat a failure as a completion blocker.
