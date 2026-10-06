import type { Command } from '../types.js';
import { output } from '../output.js';
import { callMCPTool } from '../mcp-client.js';
import { collectAgentActivity } from '../services/agent-activity.js';

export const activityCommand: Command = {
  name: 'activity',
  description: 'Snapshot of tracked agents and recorded task/mission activity (not a live feed)',
  options: [
    { name: 'mission', type: 'string', description: 'Include a page of durable events for this mission' },
    { name: 'after', type: 'number', description: 'Mission event cursor (default: 0)', default: 0 },
    { name: 'limit', type: 'number', description: 'Newest tasks and mission events per page (1–500)', default: 50 },
  ],
  examples: [
    { command: 'ruflo agent activity', description: 'Show tracked state and recorded task timestamps' },
    { command: 'ruflo agent activity --mission msn_… --after 0 --format json', description: 'Include a mission event page as JSON' },
  ],
  async action(ctx) {
    try {
      const snapshot = await collectAgentActivity(callMCPTool, {
        mission: ctx.flags.mission as string | undefined,
        after: ctx.flags.after === undefined ? undefined : Number(ctx.flags.after),
        limit: ctx.flags.limit === undefined ? undefined : Number(ctx.flags.limit),
      });
      if (ctx.flags.format === 'json') output.printJson(snapshot);
      else {
        output.writeln(output.bold('Recorded agent activity — snapshot ' + snapshot.observedAt));
        output.printTable({ columns: [
          { key: 'agent', header: 'Agent', width: 18 }, { key: 'swarm', header: 'Swarm', width: 28 },
          { key: 'assignedTask', header: 'Assigned task', width: 36 },
          { key: 'status', header: 'Status', width: 14 }, { key: 'lastActivity', header: 'Last activity', width: 18 },
          { key: 'occurredAt', header: 'Occurred at', width: 18 },
        ], data: snapshot.agents, maxWidth: 112 });
        if (!snapshot.agents.length) output.writeln('No agent rows returned by the source.');
        output.writeln(output.bold('Recorded task / mission timeline (newest first)'));
        if (!snapshot.timeline.length) output.writeln('Activity: not recorded.');
        else output.printTable({ columns: [
          { key: 'at', header: 'When', width: 25 },
          { key: 'type', header: 'Event', width: 20 },
          { key: 'taskId', header: 'Task', width: 18 },
          { key: 'status', header: 'Status', width: 14 },
          { key: 'source', header: 'Source', width: 28 },
        ], data: snapshot.timeline.map(event => ({
          ...event,
          at: event.at ?? 'not recorded',
          taskId: event.taskId ?? 'not recorded',
          status: event.status ?? 'not recorded',
        })), maxWidth: 112 });
        if (snapshot.mission) output.writeln('Mission cursor: ' + snapshot.mission.nextCursor);
        for (const limitation of snapshot.limitations) output.writeln(limitation);
        for (const warning of snapshot.warnings) output.printWarning(warning);
      }
      return { success: true, data: snapshot };
    } catch (error) {
      output.printError(error instanceof Error ? error.message : String(error));
      return { success: false, exitCode: 1 };
    }
  },
};
