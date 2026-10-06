/** Read-only projections of recorded state. Never use synthetic agent_logs. */
export type ActivityReader = (tool: string, input: Record<string, unknown>) => Promise<unknown>;
type Row = Record<string, unknown>;
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const records = (value: unknown): Row[] => Array.isArray(value) ? value.map(record) : [];
const text = (value: unknown): string | null => typeof value === 'string' && value.length > 0
  ? value.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, ' ').slice(0, 200) : null;
const timestamp = (value: unknown): string | null => typeof value === 'string' && Number.isFinite(Date.parse(value))
  ? new Date(value).toISOString() : null;

export interface ActivityEvent {
  id: string;
  at: string | null;
  type: string;
  taskId: string | null;
  status: string | null;
  source: string;
}
export interface ActivitySnapshot {
  observedAt: string;
  agents: Array<{ agent: string; assignedTask: string; status: string; lastActivity: string; occurredAt: string; source: string }>;
  timeline: ActivityEvent[];
  mission: { id: string; nextCursor: number; hasMore: boolean; gap: boolean } | null;
  warnings: string[];
  limitations: string[];
}

export async function collectAgentActivity(
  read: ActivityReader,
  options: { mission?: string; after?: number; limit?: number } = {},
): Promise<ActivitySnapshot> {
  const limit = options.limit ?? 50;
  const after = options.after ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('limit must be an integer from 1 to 500');
  if (!Number.isSafeInteger(after) || after < 0) throw new Error('after must be a non-negative safe integer');
  if (options.mission !== undefined && !/^msn_[a-f0-9]{24}$/.test(options.mission)) throw new Error('mission must be a valid msn_ id');
  if (after && !options.mission) throw new Error('after requires mission');
  const warnings: string[] = [];
  async function fetch(tool: string, input: Row): Promise<Row> {
    try {
      const result = record(await read(tool, input));
      if (result.error || result.ok === false || result.success === false || result.isError === true) throw new Error('unavailable');
      const malformed = tool === 'agent_list' ? !Array.isArray(result.agents)
        : tool === 'task_list' ? !Array.isArray(result.tasks)
        : tool === 'task_status' ? typeof result.taskId !== 'string' || result.status === 'not_found'
        : tool === 'mission_events' ? result.ok !== true || !Array.isArray(record(result.data).events)
          || !Number.isSafeInteger(record(result.data).nextCursor) || !Number.isSafeInteger(record(result.data).lastEventSequence)
        : false;
      if (malformed) throw new Error('invalid source response');

      return result;
    } catch {
      // Never expose raw errors, tool arguments, result bodies or private transcripts.
      warnings.push(tool + ': unavailable; activity not recorded in this snapshot');
      return {};
    }
  }
  const [agentResult, taskResult, missionResult] = await Promise.all([
    fetch('agent_list', { includeTerminated: true }),
    fetch('task_list', { limit }),
    options.mission ? fetch('mission_events', { missionId: options.mission, afterSequence: after, limit }) : Promise.resolve({}),
  ]);
  const tasks = records(taskResult.tasks);
  if (tasks.length >= limit) warnings.push('Task snapshot limited to ' + limit + ' newest records; older assignments may be missing.');
  const details = await Promise.all(tasks.map(t => fetch('task_status', { taskId: t.taskId })));
  const timeline: ActivityEvent[] = [];
  for (const task of details) {
    const taskId = text(task.taskId);
    if (!taskId || task.status === 'not_found') continue;
    for (const [field, type] of [['createdAt', 'task.created'], ['startedAt', 'task.started'], ['completedAt', 'task.finished']] as const) {
      const at = timestamp(task[field]);
      if (at) timeline.push({ id: taskId + ':' + field, at, type, taskId,
        status: null, source: 'task_status.' + field + ' (record)' });
    }
  }
  const missionData = record(record(missionResult).data);
  const seen = new Set<number>();
  for (const event of records(missionData.events)) {
    if (event.missionId !== options.mission || !Number.isSafeInteger(event.seq) || (event.seq as number) <= after || seen.has(event.seq as number)) continue;
    seen.add(event.seq as number);
    const payload = record(event.payload);
    // Fixed fields only. Mission principals are not agent identities.
    timeline.push({ id: options.mission + ':' + event.seq, at: timestamp(event.at), type: text(event.type) ?? 'not recorded',
      taskId: text(payload.taskId), status: text(payload.status), source: 'mission_events ' + options.mission + ' #' + event.seq });
  }
  const mission = options.mission && typeof missionData.nextCursor === 'number' ? {
    id: options.mission, nextCursor: missionData.nextCursor,
    hasMore: missionData.nextCursor < Number(missionData.lastEventSequence), gap: missionData.gap === true,
  } : null;
  if (mission?.gap) warnings.push('Mission event gap: reload with ruflo mission get --mission ' + mission.id + ' before continuing replay.');
  if (mission?.hasMore) warnings.push('More mission events: use --mission ' + mission.id + ' --after ' + mission.nextCursor + '.');
  const agents = records(agentResult.agents).map(agent => {
    const assigned = tasks.filter(t => Array.isArray(t.assignedTo) && t.assignedTo.includes(agent.agentId)
      && ['pending', 'in_progress'].includes(String(t.status)));
    return {
      agent: text(agent.agentId) ?? 'not recorded',
      assignedTask: assigned.map(t => (text(t.taskId) ?? 'not recorded') + ': ' + (text(t.description) ?? 'not recorded')).join('; ') || 'not recorded',
      status: text(agent.status) ?? 'not recorded',
      // Reassignment means task timestamps cannot identify the agent that acted.
      lastActivity: 'not recorded', occurredAt: 'not recorded', source: 'agent_list; task_list (current state)',
    };
  });
  timeline.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '') || a.id.localeCompare(b.id));
  return { observedAt: new Date().toISOString(), agents, timeline, mission, warnings, limitations: [
    'Tracked state only; not a live Codex worker feed. Snapshot time is not activity time.',
    'Assignments are current recorded associations; task timestamps do not establish which agent acted.',
    'Messages, handoffs and tool activity: not recorded by these sources. Communication graph: not recorded.',
    'Local task IDs and mission task IDs belong to separate namespaces.',
  ] };
}
