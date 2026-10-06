import { describe, expect, it, vi, afterEach } from 'vitest';
import { collectAgentActivity, type ActivityReader } from '../src/services/agent-activity.js';
vi.mock('../src/mcp-client.js', () => ({ callMCPTool: vi.fn() }));
vi.mock('../src/output.js', () => ({ output: {
  writeln: vi.fn(), printJson: vi.fn(), printTable: vi.fn(), printWarning: vi.fn(), printError: vi.fn(), bold: (s: string) => s,
} }));
import { callMCPTool } from '../src/mcp-client.js';
import { output } from '../src/output.js';
import { activityCommand } from '../src/commands/agent-activity.js';

const mission = 'msn_' + 'a'.repeat(24);
const createdAt = '2026-10-06T08:00:00Z';
const completedAt = '2026-10-06T09:00:00Z';
function reader(overrides: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = {
    agent_list: { agents: [{ agentId: 'researcher', status: 'busy', createdAt, lastResult: { reasoning: 'PRIVATE' } }] },
    task_list: { tasks: [
      { taskId: 't1', description: 'Review source', status: 'in_progress', assignedTo: ['researcher'], createdAt },
      { taskId: 't2', description: 'Old task', status: 'completed', assignedTo: ['researcher'], createdAt },
    ] },
    task_status: { taskId: 't1', createdAt, startedAt: '2026-10-06T08:30:00Z', completedAt, status: 'completed', result: { reasoning: 'PRIVATE' } },
    mission_events: { ok: true, data: { events: [], nextCursor: 0, lastEventSequence: 0, gap: false } },
    ...overrides,
  };
  return vi.fn<ActivityReader>(async (tool, input) => tool === 'task_status' && data[tool] ? { ...(data[tool] as Record<string, unknown>), taskId: input.taskId } : data[tool]);
}
afterEach(() => vi.clearAllMocks());

describe('recorded agent activity', () => {
  it('shows current assignments without inventing agent activity or leaking result bodies', async () => {
    const read = reader();
    const snapshot = await collectAgentActivity(read);
    expect(snapshot.agents[0]).toMatchObject({
      agent: 'researcher', status: 'busy', assignedTask: 't1: Review source',
      lastActivity: 'not recorded', occurredAt: 'not recorded',
    });
    expect(JSON.stringify(snapshot)).not.toContain('PRIVATE');
    expect(read.mock.calls.map(c => c[0])).not.toContain('agent_logs');
    expect(read.mock.calls.map(c => c[0])).not.toContain('agent_status');
    expect(snapshot.timeline[0]).toMatchObject({ type: 'task.finished', at: '2026-10-06T09:00:00.000Z', source: 'task_status.completedAt (record)' });
    expect(snapshot.timeline.every(e => !('agentId' in e))).toBe(true);
  });

  it('does not infer timestamps or status transitions for missing/invalid fields', async () => {
    const snapshot = await collectAgentActivity(reader({ task_status: { taskId: 't1', status: 'failed', createdAt: 'invalid' } }));
    expect(snapshot.timeline).toEqual([]);
    expect(snapshot.agents[0].occurredAt).toBe('not recorded');
  });

  it('projects and deduplicates mission events without confusing principals with senders', async () => {
    const event = { missionId: mission, seq: 2, type: 'task.observed', at: completedAt, principalId: 'researcher',
      payload: { taskId: 't1', status: 'failed', reasoning: 'PRIVATE', message: 'PRIVATE', sender: 'researcher', recipient: 'coordinator' } };
    const read = reader({ task_list: { tasks: [] }, mission_events: { ok: true, data: {
      events: [event, event, { ...event, missionId: 'other', seq: 3 }, { ...event, seq: 1 }],
      nextCursor: 2, lastEventSequence: 4, gap: true,
    } } });
    const snapshot = await collectAgentActivity(read, { mission, after: 1, limit: 2 });
    expect(snapshot.timeline).toHaveLength(1);
    expect(snapshot.timeline[0]).toMatchObject({ type: 'task.observed', taskId: 't1', status: 'failed' });
    expect(snapshot.mission).toEqual({ id: mission, nextCursor: 2, hasMore: true, gap: true });
    expect(snapshot.warnings.join(' ')).toContain('Mission event gap');
    expect(snapshot.warnings.join(' ')).toContain('--after 2');
    expect(JSON.stringify(snapshot)).not.toMatch(/PRIVATE|recipient|principalId/);
    expect(snapshot.agents[0].lastActivity).toBe('not recorded');
  });

  it('keeps partial source failure visible without printing raw error content', async () => {
    const read = reader({ mission_events: { ok: false, message: 'PRIVATE' } });
    const wrapped: ActivityReader = (tool, input) => {
      if (tool === 'task_status') throw new Error('PRIVATE');
      return read(tool, input);
    };
    const snapshot = await collectAgentActivity(wrapped, { mission });
    expect(snapshot.agents).toHaveLength(1);
    expect(snapshot.warnings.join(' ')).toContain('mission_events: unavailable');
    expect(snapshot.warnings.join(' ')).toContain('task_status: unavailable');
    expect(JSON.stringify(snapshot)).not.toContain('PRIVATE');
  });

  it('warns about bounded task coverage and sanitizes terminal controls', async () => {
    const snapshot = await collectAgentActivity(reader({ task_list: { tasks: [
      { taskId: 't1', status: 'pending', assignedTo: ['researcher'], description: 'Review\n\u001b[31mred\u202e' },
    ] } }), { limit: 1 });
    expect(snapshot.warnings.join(' ')).toContain('older assignments may be missing');
    expect(snapshot.agents[0].assignedTask).not.toMatch(/[\n\u001b\u202e]/);
  });

  it.each([{ limit: 0 }, { limit: 501 }, { limit: 1.5 }, { after: -1 }, { after: 1 }, { mission: 'invalid' }])('rejects invalid options before reading: %j', async (options) => {
    const read = reader();
    await expect(collectAgentActivity(read, options)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });


  it('does not attach current task state to historical completion timestamps', async () => {
    const snapshot = await collectAgentActivity(reader({ task_status: { taskId: 't1', completedAt, status: 'in_progress' } }));
    expect(snapshot.timeline.find(e => e.type === 'task.finished')).toMatchObject({ status: null });
  });

  it.each([
    { agent_list: undefined }, { task_list: {} },
    { task_status: { taskId: 't1', status: 'not_found' } },
    { mission_events: { ok: true, data: {} } },
  ])('labels malformed or disappearing sources as unavailable: %j', async (override) => {
    const snapshot = await collectAgentActivity(reader(override), { mission });
    expect(snapshot.warnings.join(' ')).toContain('unavailable');
  });

  it('keeps an empty source empty', async () => {
    const snapshot = await collectAgentActivity(reader({ agent_list: { agents: [] }, task_list: { tasks: [] } }));
    expect(snapshot.agents).toEqual([]);
    expect(snapshot.timeline).toEqual([]);
    expect(snapshot.limitations.join(' ')).toContain('not a live Codex worker feed');
  });
});

describe('activity command', () => {
  it('renders JSON without mixed table output', async () => {
    vi.mocked(callMCPTool).mockImplementation(reader() as typeof callMCPTool);
    const result = await activityCommand.action!({ args: [], flags: { _: [], format: 'json' }, cwd: '/project', interactive: false });
    expect(result.success).toBe(true);
    expect(output.printJson).toHaveBeenCalledOnce();
    expect(output.printTable).not.toHaveBeenCalled();
    expect(output.writeln).not.toHaveBeenCalled();
  });

  it('renders rows, timeline sources and missing communication labels', async () => {
    vi.mocked(callMCPTool).mockImplementation(reader() as typeof callMCPTool);
    await activityCommand.action!({ args: [], flags: { _: [] }, cwd: '/project', interactive: false });
    expect(output.printTable).toHaveBeenCalledOnce();
    const lines = vi.mocked(output.writeln).mock.calls.flat().join('\n');
    expect(lines).toContain('task_status.completedAt (record)');
    expect(lines).toContain('Communication graph: not recorded');
  });
});
