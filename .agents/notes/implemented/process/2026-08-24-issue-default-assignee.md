# Agent Note: Issue default assignee uses an Issue-only fallback

Status: implemented

## Problem

The Issue creation workflow shared `defaultRoute` with PR routing. That route assigns unmatched PRs to the repository owner, while new Issues need a collaborator as their default fallback. Reusing or changing the shared route would alter PR assignment behavior.

## Decision

The routing configuration now defines `issueDefaultRoute.assignees` as `["Aa728848"]`. `.github/workflows/auto-assign-issues.yml` keeps the existing category matching first; when no Issue category route matches, it uses `issueDefaultRoute`, then the hardcoded Aa728848 fallback if the configuration cannot be read. The shared `defaultRoute` remains unchanged for PR routing. Existing Issue templates are not modified.

Recognized Issue categories therefore keep their existing route-specific assignees, while an Issue without a matching category is assigned to Aa728848. The workflow continues to run only for newly opened Issues, excludes pull-request payloads, and filters the Issue author from the assignee list.

## Alternatives considered

- Change `defaultRoute.assignees` to `Aa728848`: rejected because the PR auto-assignment workflow consumes the same field and would move unmatched PR assignments away from the repository owner.
- Add `assignees` to every Issue template: rejected because template-level assignment would not represent a fallback and would bypass the existing category routing; the user had also already updated the templates.
- Ignore category routes and assign every Issue to Aa728848: rejected for this change because it would replace an existing routing policy rather than change the default fallback.

## Consequences

Unmatched new Issues now go to Aa728848, and a configuration-read failure still has Aa728848 as its safe hardcoded fallback. PR reviewer and assignee routing remains governed by the existing shared `defaultRoute`. The stale-assignment workflow already watches Aa728848 and escalates inactive open items to the repository owner after 14 days.

The earlier Issue-only fallback decision is superseded by [separate Issue and PR assignment](2026-08-25-issue-pr-assignment-separation.md); the rationale for keeping `defaultRoute` independent of Issue assignment remains relevant to PR routing.
