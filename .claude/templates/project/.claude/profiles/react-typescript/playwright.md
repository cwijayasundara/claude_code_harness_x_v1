# Optional Playwright profile

Enable this only for stable, high-value user journeys. Set `optional_sensors.playwright: enabled` in `.claude/harness.yaml` and define `npm run test:e2e` in the project.

Keep journeys short and business-focused. For observable UI or layout changes,
compare a fresh screenshot with the approved design or baseline and record the
differences and fixes. Store screenshots, traces, or video links as PR evidence;
do not create broad browser coverage merely to increase automation counts.
