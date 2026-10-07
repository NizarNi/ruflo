import { output } from '../output.js';
import type { ActivitySnapshot } from './agent-activity.js';

type Agent = ActivitySnapshot['agents'][number];

export function activityStatusColor(value: string, label = value): string {
  if (['busy', 'running', 'in_progress'].includes(value)) return output.color(label, 'cyan');
  if (value === 'completed') return output.success(label);
  if (['failed', 'error'].includes(value)) return output.error(label);
  if (['pending', 'cancelled', 'stopped'].includes(value)) return output.warning(label);
  return output.dim(label);
}

function fields(agent: Agent): Array<[string, string]> {
  return [
    ['Agent', agent.displayName],
    ['Recorded status', agent.status],
    ['Current task', agent.assignedTask],
    ['Latest task', agent.latestTask ? agent.latestTask.description + ' (' + agent.latestTask.taskId + ')' : 'not recorded'],
    ['Latest task status', agent.latestTask?.status ?? 'not recorded'],
    ['Latest task time', agent.latestTask?.at ?? 'not recorded'],
    ['Last activity', agent.lastActivity],
    ['Occurred at', agent.occurredAt],
  ];
}

/** Wrap printable ASCII without dropping long task IDs or descriptions. */
function wrap(value: string, width: number): string[] {
  const lines: string[] = [];
  let rest = value;
  while (rest.length > width) {
    const space = rest.lastIndexOf(' ', width);
    const end = space > 0 ? space : width;
    lines.push(rest.slice(0, end));
    rest = rest.slice(end).trimStart();
  }
  lines.push(rest);
  return lines;
}

/** Each column is an agent. Membership is recorded data, never inferred edges. */
export function printActivityBoard(agents: Agent[], columns = process.stdout.columns ?? 80): void {
  const width = Math.max(1, Math.floor(columns));
  const groups = new Map<string, Agent[]>();
  for (const agent of agents) {
    for (const swarm of agent.swarms.length ? agent.swarms : ['Swarm membership: not recorded']) {
      const members = groups.get(swarm) ?? [];
      members.push(agent);
      groups.set(swarm, members);
    }
  }
  for (const [swarm, members] of groups) {
    output.writeln('');
    output.writeln(output.color(swarm + ' - ' + members.length + ' tracked agent(s)', 'cyan', 'bold'));
    // For complex Unicode, let the terminal wrap naturally; JS string length
    // cannot safely pad emoji, combining characters or double-width glyphs.
    const ascii = members.every(agent => fields(agent).every(([, value]) => /^[\x20-\x7e]*$/.test(value)));
    if (width < 34 || !ascii) {
      for (const agent of members) {
        output.writeln('');
        for (const [label, value] of fields(agent)) {
          output.writeln(output.bold(label + ': ') + (label.includes('status') ? activityStatusColor(value) : value));
        }
      }
      continue;
    }
    const count = Math.max(1, Math.min(members.length, Math.floor((width - 1) / 33)));
    const cellWidth = Math.min(56, Math.floor((width - count - 1) / count) - 2);
    for (let start = 0; start < members.length; start += count) {
      const cards = members.slice(start, start + count).map(fields);
      const border = '+' + cards.map(() => '-'.repeat(cellWidth + 2)).join('+') + '+';
      output.writeln(border);
      for (let field = 0; field < cards[0].length; field++) {
        const rows = cards.map(card => wrap(card[field][0] + ': ' + card[field][1], cellWidth));
        const height = Math.max(...rows.map(row => row.length));
        for (let line = 0; line < height; line++) {
          output.writeln('|' + rows.map((row, card) => {
            const padded = (row[line] ?? '').padEnd(cellWidth);
            const label = cards[card][field][0];
            const value = cards[card][field][1];
            const colored = label.includes('status')
              ? activityStatusColor(value, padded)
              : field === 0 ? output.color(padded, 'cyan', 'bold')
                : value === 'not recorded' || value === 'No active assignment' ? output.dim(padded) : padded;
            return ' ' + colored + ' ';
          }).join('|') + '|');
        }
        output.writeln(border);
      }
    }
  }
}
