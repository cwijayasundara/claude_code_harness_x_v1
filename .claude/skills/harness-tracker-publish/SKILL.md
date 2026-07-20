---
name: harness-tracker-publish
description: Publish a separately human-approved tracker projection through an explicitly configured Linear, Jira, or Azure DevOps MCP server and archive a reconciliation receipt. Use only when the user explicitly requests tracker publication or reconciliation.
---

# Tracker publication through MCP

Local `.claude/specs/` artifacts are authoritative. MCP publication is an
explicit external write and is never implied by G1 or projection approval.

1. Confirm the user explicitly requested publication to the named provider and
   project. If not, stop after export/approval.
2. Load the projection record from `.claude/specs/index.json`; require package
   `tracker-projections`, status `approved`, matching on-disk SHA-256, matching
   provider/project, and valid projection/local hashes.
3. Read previous immutable receipts under
   `.claude/specs/evidence/tracker/<projection-id>/`. Query existing remote items
   through the configured MCP server before writing. Never infer identity from
   title alone; use recorded remote IDs or a stable local-artifact marker.
4. Build create/update/no-op decisions with the harness tracker projection
   contract. If the remote item changed since its recorded snapshot, stop and
   present a human reconciliation decision. Never silently overwrite it.
5. Show the exact proposed creates, updates, links, and no-ops. Obtain explicit
   confirmation for that plan immediately before invoking write tools.
6. Use only issue/work-item tools from the projection's provider:
   - Linear: issue/project create, update, lookup, and relationship tools.
   - Jira: Jira work-item create, update, lookup, and link tools from Atlassian.
   - Azure DevOps: `wit_create_work_item`, `wit_update_work_item`, lookup, child,
     and work-item link tools. Do not use repository, pipeline, or deployment tools.
7. Preserve dependency direction and epic/story hierarchy. Clusters are planning
   metadata, never automatic engineer assignment. Do not publish secrets or raw
   provider authentication data.
8. Write a redacted receipt JSON under `.claude/work/`, then archive it with
   `harness-specs.js tracker-record`. Include local ID/hash, remote ID/URL,
   operation, timestamp, status, and a hash of the redacted remote snapshot.
   Partial failure is recorded honestly and retries operate only on failures.

Authentication is performed interactively with `/mcp`; credentials never enter
the repository. If an expected MCP server/tool is unavailable, stop and report
the missing configuration rather than substituting an unapproved API or CLI.
