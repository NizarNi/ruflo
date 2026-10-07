import type { Command } from '../types.js';
import { output } from '../output.js';
import { callMCPTool } from '../mcp-client.js';
import { collectAgentActivity } from '../services/agent-activity.js';
import { printActivityBoard, activityStatusColor as statusColor } from '../services/agent-activity-view.js';

function field(label: string, value: string): void {
  output.writeln('  ' + output.bold(label + ': ') + (value === 'not recorded' || value === 'No active assignment' ? output.dim(value) : value));
}

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
        printActivityBoard(snapshot.agents);
        output.writeln('');
        if (!snapshot.agents.length) output.writeln('No agent rows returned by the source.');
        output.writeln(output.bold('Recorded task / mission timeline (newest first)'));
        if (!snapshot.timeline.length) output.writeln('Activity: not recorded.');
        else {
          // Compact summaries on wide terminals; labelled blocks elsewhere.
          // Avoid bordered cells for long or Unicode text whose display width varies.
          const wide = (process.stdout.columns ?? 80) >= 120;
          const tableFits = wide && snapshot.timeline.every(event =>
            /^[\x20-\x7e]*$/.test(event.description ?? '') && (event.description?.length ?? 0) <= 50
            && /^[\x20-\x7e]*$/.test(event.type) && event.type.length <= 22);
          if (tableFits) output.printTable({ columns: [
            { key: 'at', header: 'When (UTC)', width: 24 },
            { key: 'type', header: 'Event', width: 22 },
            { key: 'description', header: 'Description', width: 50 },
          ], data: snapshot.timeline.map(event => ({
            at: event.at ?? 'not recorded', type: output.color(event.type, 'cyan'),
            description: event.description ?? 'not recorded',
          })) });
          for (const event of snapshot.timeline) {
            output.writeln('');
            output.writeln(output.color(event.type, 'cyan') + ' · ' + (event.at ?? 'not recorded'));
            field('Description', event.description ?? 'not recorded');
            field('Task ID', event.taskId ?? 'not recorded');
            field('Event status', statusColor(event.status ?? 'not recorded'));
            field('Source', event.source);
          }
        }
        output.writeln('');
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
