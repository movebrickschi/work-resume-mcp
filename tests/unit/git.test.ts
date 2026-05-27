import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

import { execa } from 'execa';
import { getGitStatus, isGitRepo, getDiffStat, getHunksUnified0 } from '../../src/git.js';

const mockExeca = execa as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => mockExeca.mockReset());

describe('isGitRepo', () => {
  it('returns true when rev-parse succeeds', async () => {
    mockExeca.mockResolvedValueOnce({ stdout: '/abs/repo', exitCode: 0 } as any);
    expect(await isGitRepo('/abs/repo')).toBe(true);
  });
  it('returns false when rev-parse throws', async () => {
    mockExeca.mockRejectedValueOnce(new Error('not a git repo'));
    expect(await isGitRepo('/abs/repo')).toBe(false);
  });
});

describe('getGitStatus', () => {
  it('parses HEAD / branch / dirty', async () => {
    mockExeca
      .mockResolvedValueOnce({ stdout: 'a1b2c3', exitCode: 0 } as any)
      .mockResolvedValueOnce({ stdout: 'feature/x', exitCode: 0 } as any)
      .mockResolvedValueOnce({ stdout: ' M src/a.ts\n?? src/b.ts\n', exitCode: 0 } as any);
    const s = await getGitStatus('/abs/repo');
    expect(s.head).toBe('a1b2c3');
    expect(s.branch).toBe('feature/x');
    expect(s.dirty_files).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('returns empty dirty_files when clean', async () => {
    mockExeca
      .mockResolvedValueOnce({ stdout: 'a1b2c3', exitCode: 0 } as any)
      .mockResolvedValueOnce({ stdout: 'main', exitCode: 0 } as any)
      .mockResolvedValueOnce({ stdout: '', exitCode: 0 } as any);
    const s = await getGitStatus('/abs/repo');
    expect(s.dirty_files).toEqual([]);
  });
});

describe('getDiffStat', () => {
  it('parses numstat output into per-file counts', async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: '12\t3\tsrc/a.ts\n0\t0\tsrc/b.ts\n-\t-\tassets/img.png\n',
      exitCode: 0,
    } as any);
    const stats = await getDiffStat('/abs/repo');
    expect(stats.get('src/a.ts')).toEqual({ added: 12, removed: 3 });
    expect(stats.get('src/b.ts')).toEqual({ added: 0, removed: 0 });
    expect(stats.get('assets/img.png')).toEqual({ added: 0, removed: 0 });
  });
});

describe('getHunksUnified0', () => {
  it('returns per-file added line ranges from unified=0 diff', async () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index e69de29..0000001 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -10,0 +11,3 @@ class Foo {',
      '+  bar() {}',
      '+  baz() {}',
      '+}',
      '@@ -30,2 +33,1 @@',
      '-  old1();',
      '-  old2();',
      '+  newOnly();',
      '',
    ].join('\n');
    mockExeca.mockResolvedValueOnce({ stdout: diff, exitCode: 0 } as any);
    const hunks = await getHunksUnified0('/abs/repo');
    expect(hunks.get('src/a.ts')).toEqual([
      { addedStart: 11, addedCount: 3 },
      { addedStart: 33, addedCount: 1 },
    ]);
  });
});
