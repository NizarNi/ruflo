import { afterEach, describe, expect, it, vi } from 'vitest';
import { output, OutputFormatter } from '../src/output.js';
import { printActivityBoard } from '../src/services/agent-activity-view.js';
import type { ActivitySnapshot } from '../src/services/agent-activity.js';

const originalColor = output.isColorEnabled();
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); output.setColorEnabled(originalColor); });
const agent = (name: string): ActivitySnapshot['agents'][number] => ({
  agent: name, displayName: 'coder / ' + name, status: 'idle', swarms: ['team (mesh)'], swarm: 'team (mesh)',
  assignedTask: 'No active assignment', latestTask: { taskId: 'task-' + 'x'.repeat(60), description: 'Implement search with a long description that must wrap intact', status: 'completed', at: '2026-10-07T10:00:00.000Z' },
  lastActivity: 'not recorded', occurredAt: 'not recorded', source: 'test',
});
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

describe('swarm activity board', () => {
  it.each([40, 80, 120])('keeps all bordered lines aligned at %i columns, including ANSI colors', width => {
    output.setColorEnabled(true);
    const spy = vi.spyOn(output, 'writeln').mockImplementation(() => {});
    printActivityBoard([agent('api'), agent('web'), agent('qa')], width);
    const lines = spy.mock.calls.map(([line]) => strip(String(line)));
    const borders = lines.filter(line => /^[+|]/.test(line));
    expect(borders.length).toBeGreaterThan(0);
    expect(borders.every(line => line.length <= width)).toBe(true);
    expect(new Set(borders.map(line => line.length)).size).toBeLessThanOrEqual(2);
    if (width >= 80) expect(lines.some(line => line.includes('coder / api') && line.includes('coder / web'))).toBe(true);
    expect(spy.mock.calls.flat().join('')).toContain('\x1b[32m');
  });

  it('uses border-free output for Unicode rather than corrupting padding', () => {
    const spy = vi.spyOn(output, 'writeln').mockImplementation(() => {});
    const unicode = agent('検索 👩‍💻');
    printActivityBoard([unicode], 80);
    const lines = spy.mock.calls.map(([line]) => strip(String(line)));
    expect(lines.join('\n')).toContain(unicode.displayName);
    expect(lines.some(line => /^[+|]/.test(line))).toBe(false);
  });

  it('keeps status labels readable without ANSI and respects NO_COLOR', () => {
    vi.stubEnv('NO_COLOR', '1');
    expect(new OutputFormatter().isColorEnabled()).toBe(false);
    output.setColorEnabled(false);
    const spy = vi.spyOn(output, 'writeln').mockImplementation(() => {});
    printActivityBoard([agent('api')], 80);
    const text = spy.mock.calls.flat().join('\n');
    expect(text).not.toContain('\x1b');
    expect(text).toContain('completed');
    expect(text).toContain('Recorded status: idle');
  });
});
