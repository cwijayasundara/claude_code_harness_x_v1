# Conditional Playwright profile

When an approved story contract declares the `ui` feature surface, configure
the pre-PR `browser-e2e` check and map at least one approved browser test through
the G4 traceability artifact. Playwright is the default for this profile. An
equivalent browser runner requires a human-reviewed rationale in the story
contract. Define the project-owned command (for example `npm run test:e2e`) in
`.claude/verification.json`; the core harness does not install browser tooling.

Keep journeys short and business-focused. For observable UI or layout changes,
compare a fresh screenshot with the approved design or baseline and record the
differences and fixes. Store screenshots, traces, or video links as PR evidence;
do not create broad browser coverage merely to increase automation counts.
