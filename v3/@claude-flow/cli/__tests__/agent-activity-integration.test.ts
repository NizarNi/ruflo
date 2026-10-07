import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectAgentActivity } from '../src/services/agent-activity.js';
import { agentTools } from '../src/mcp-tools/agent-tools.js';
import { taskTools } from '../src/mcp-tools/task-tools.js';

describe('activity against persisted MCP state', () => {
  it('reads canonical/hive agents and task timestamps without changing the source files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ruflo-activity-'));
    const previous = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = root;
    try {
      const dir = join(root, '.claude-flow');
      mkdirSync(join(dir, 'agents'), { recursive: true });
      mkdirSync(join(dir, 'tasks'), { recursive: true });
      const createdAt = '2026-10-06T08:00:00.000Z';
      const agent = { agentId: 'coder', agentType: 'coder', status: 'busy', createdAt, config: {}, taskCount: 0, health: 1 };
      writeFileSync(join(dir, 'agents', 'store.json'), JSON.stringify({ agents: { coder: agent }, version: '3.0.0' }));
      writeFileSync(join(dir, 'agents.json'), JSON.stringify({ agents: { reviewer: { ...agent, agentId: 'reviewer', status: 'idle' } } }));
      writeFileSync(join(dir, 'tasks', 'store.json'), JSON.stringify({ version: '3.0.0', tasks: {
        task1: { taskId: 'task1', description: 'Review snapshot', status: 'in_progress', assignedTo: ['coder'],
          createdAt, startedAt: '2026-10-06T09:00:00.000Z', completedAt: null, result: { reasoning: 'PRIVATE' } },
      } }));
      const handlers = [...agentTools, ...taskTools];
      const snapshot = await collectAgentActivity(async (name, input) => {
        const tool = handlers.find(t => t.name === name);
        if (!tool) throw new Error(name);
        return tool.handler(input);
      });
      expect(snapshot.agents.map(a => a.agent).sort()).toEqual(['coder', 'reviewer']);
      expect(snapshot.agents.find(a => a.agent === 'coder')?.assignedTask).toBe('Review snapshot [in_progress] (task1)');
      expect(snapshot.timeline.map(e => e.type)).toEqual(['task.started', 'task.created']);
      expect(snapshot.agents.every(a => a.lastActivity === 'not recorded')).toBe(true);
      expect(JSON.stringify(snapshot)).not.toContain('PRIVATE');
      expect(snapshot.warnings).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_FLOW_CWD;
      else process.env.CLAUDE_FLOW_CWD = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
