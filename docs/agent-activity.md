# Recorded agent activity

Run `ruflo agent activity` to inspect Ruflo-tracked agent state and recorded task timestamps. This is a read-only snapshot, not a live Codex worker monitor.

```bash
ruflo agent activity
ruflo agent activity --format json
ruflo agent activity --mission msn_<24-hex-characters> --after 0 --limit 50
```

Agents are grouped by recorded swarm membership, with one agent per column and fewer columns on narrow terminals. Each agent card shows the recorded role followed by its identifier, active task descriptions and IDs, swarm, recorded status, last activity, and occurrence time. Names are display labels; stored IDs stay unchanged. Project names are not guessed. No active assignment means the complete task snapshot contains no pending/in-progress assignment for that agent; unavailable or limited coverage remains not recorded. The existing agent registry has no reliable per-agent activity timestamp, so last activity and occurrence time read **not recorded**. Snapshot time tells you when the view was collected; sources are read independently, not atomically.

Colors distinguish active states (cyan), completed (green), failed (red), pending/cancelled/stopped (yellow), and idle/missing data (dim). Labels remain readable without color; the existing NO_COLOR setting is respected. Very narrow terminals or complex Unicode use labelled blocks to avoid incorrect character-width padding. Wide terminals may also show a compact timeline with a Description column; long or Unicode descriptions use blocks to avoid broken borders. JSON remains uncolored and adds displayName, swarms, latestTask and event description fields.

Latest task shows the most recently timestamped task associated with the agent in the returned page, including completed/cancelled tasks. Its status and timestamp remain visible after the agent returns idle. Association is not proof of which agent executed past work.

Recorded status is registry state, not live Codex execution. Creating an assigned pending task does not mark its agent busy; task assign does. External Codex activity is not automatically synchronized. The current task_update path can also leave registry state stale; this display does not silently infer a replacement status.

The timeline includes creation, start, and finish timestamps returned by `task_status`, plus a page of durable `mission_events` when a mission is selected. It shows recorded descriptions, event types and task/status fields, never arbitrary result bodies, private reasoning, message bodies or tool arguments. A task timestamp does not identify which worker acted: tasks can be reassigned. Local task IDs and mission task IDs are separate namespaces.

The default limit is 50 (maximum 500). Task coverage is the newest records only; older assignments may be missing, and the view warns when the limit is reached. Mission pages report their next cursor; use it with `--after` to continue. Duplicate mission sequences are suppressed. A gap is explicitly reported with an instruction to reload the mission snapshot before continuing. Source failures are reported as unavailable rather than silently treated as proof of inactivity.

`agent logs` is a separate legacy command that currently synthesizes entries from stored state. This view does not use it. It also cannot observe unregistered Codex workers or all local agent messages.

## Future worker event contract

A live communication plot needs durable structured lifecycle events containing event ID/sequence, timestamp, sender, recipient, event type, task ID, status, and source. Worker integrations must emit assignments, handoffs, message metadata, completion and error events, with reconnect/replay support. A public task/tool summary can be added; private reasoning and raw payloads must stay out.

Until that contract is implemented, messages, handoffs, tool activity and communication edges remain **not recorded**. The snapshot does not infer an arrow from assignment, status, mission principal, or task timestamps.
