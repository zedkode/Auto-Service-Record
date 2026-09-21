# ADR-010 — Three separate frontend applications

**Status:** Accepted · **Date:** 2026-09-20 · **Deciders:** Platform architecture

## Context

Three audiences with genuinely different requirements:

| Surface | Audience | Dominant requirement |
| --- | --- | --- |
| Marketing | Anonymous public | SEO, first-load performance |
| Dashboard | Authenticated customers | Rich interactivity, offline-capable later |
| Admin | Internal staff | Strict access control, no public exposure |

A common shortcut is to put administration behind a `/admin` route inside the customer
application. That decision is difficult to undo and carries permanent risk.

## Decision

**Three independently deployable applications on three origins**, sharing packages but not
builds:

```text
www.example.com     apps/marketing   static/SSG, SEO-optimised
app.example.com     apps/dashboard   SPA, authenticated
admin.example.com   apps/admin       SPA, separate auth realm
```

The admin application has its own session cookie, its own session table, its own
authentication endpoints and its own RBAC. It may be IP-restricted. **A customer session is
never valid for the admin application.**

## Alternatives considered

**One application with routing.** One build, one deployment, shared everything. Rejected on
security and technical grounds. Security: admin code, admin route definitions and admin
API paths ship in the bundle every customer downloads; a routing bug, a misconfigured guard
or an XSS in the customer app puts platform-wide administration one mistake away. Technical:
the marketing site needs server-rendered HTML for SEO while the dashboard is a client-side
SPA, and merging them means either an SEO compromise or SSR complexity the dashboard does
not need. Operationally, a marketing copy change would redeploy the customer application.

**Marketing separate, dashboard and admin combined.** Fixes the SEO problem, keeps the
security problem. The security problem is the more expensive one.

**Micro-frontends.** Runtime composition of independently deployed fragments. Considerable
complexity for a system with three well-understood surfaces and one team.

## Consequences

**Positive.** Admin code never reaches a customer's browser. Compromising a customer
session yields nothing on the admin origin. Each application optimises for its own
requirement — static generation for marketing, SPA for the dashboard. Independent deploy
cadence: marketing copy changes ship without touching the product. CSP and CORS policies
can be tightened per origin.

**Negative.** Three builds, three deployments, three CI targets. Shared code must live in
`packages/ui` and friends, which requires discipline about what genuinely belongs there.
Cross-origin authentication needs deliberate cookie-domain configuration. A design change
must be applied in three places — mitigated by the shared design system, which is the whole
reason `packages/ui` exists.

**Non-negotiable.** The admin application is never merged into the dashboard, and never
becomes a hidden route. This separation is a security boundary, not an organisational
preference.
