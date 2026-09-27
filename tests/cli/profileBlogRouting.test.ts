import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { main } from '../../src/cli/draftCli';
import { resolveProfileBlog } from '../../src/cli/profileBlogRouting';

const folders: string[] = [];
afterEach(async () => { for (const folder of folders.splice(0)) await fs.rm(folder, { recursive: true, force: true }); });
async function folder(file?: string, data?: unknown) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-route-')); folders.push(dir);
  if (file) await fs.writeFile(path.join(dir, file), JSON.stringify(data));
  return dir;
}
it.each([
  ['운동선수', '야구선수', 'https://time-giver.tistory.com'],
  ['정치인', '국회의원', 'https://moneyguru.tistory.com'],
  ['공무원', '장관', 'https://moneyguru.tistory.com']
])('routes %s using task classification', async (majorType, promptType, expected) => {
  const dir = await folder('profile-task.json', { row: { majorType, promptType } });
  expect(await resolveProfileBlog([dir], 'auto')).toBe(expected);
});
it('reads the existing connected-tool row snapshot', async () => {
  const dir = await folder('connector-source.json', { sourceRow: ['SP1', '운동선수', '야구선수'] });
  expect(await resolveProfileBlog([dir], 'auto')).toBe('https://time-giver.tistory.com');
  await expect(resolveProfileBlog([dir], 'https://moneyguru.tistory.com')).rejects.toThrow(/mismatch/i);
});
it('rejects unknown and conflicting classifications', async () => {
  for (const row of [{ majorType: '기타', promptType: '미정' }, { majorType: '정치인', promptType: '야구선수' }]) {
    const dir = await folder('profile-task.json', { row });
    await expect(resolveProfileBlog([dir], 'auto')).rejects.toThrow(/classification/i);
  }
});
it('rejects mixed destinations before saving', async () => {
  const a = await folder('profile-task.json', { row: { majorType: '운동선수' } });
  const b = await folder('profile-task.json', { row: { majorType: '공직자' } });
  await expect(resolveProfileBlog([a, b], 'auto')).rejects.toThrow(/mixed/i);
});
it('preserves explicit legacy destinations but does not guess auto', async () => {
  const dir = await folder();
  expect(await resolveProfileBlog([dir], 'https://sample.tistory.com')).toBe('https://sample.tistory.com');
  await expect(resolveProfileBlog([dir], 'auto')).rejects.toThrow();
});
it('does not ignore malformed metadata', async () => {
  const dir = await folder(); await fs.writeFile(path.join(dir, 'connector-source.json'), '{');
  await expect(resolveProfileBlog([dir], 'https://moneyguru.tistory.com')).rejects.toThrow();
});
it('routes a service-account v2 source and rejects disagreement with its task', async () => {
  const dir = await folder('sheet-source.json', { version: 2, promptType: '야구선수' });
  expect(await resolveProfileBlog([dir], 'auto')).toBe('https://time-giver.tistory.com');
  await fs.writeFile(path.join(dir, 'profile-task.json'), JSON.stringify({ row: { majorType: '정치인' } }));
  await expect(resolveProfileBlog([dir], 'auto')).rejects.toThrow(/mixed/i);
});
it.each(['auto', 'moneyguru.tistory.com'])('CLI enforces routing before browser attachment: %s', async requested => {
  const workspace = await folder();
  const post = path.join(workspace, 'posts', '001'); await fs.mkdir(post, { recursive: true });
  await fs.writeFile(path.join(post, 'content.txt'), '[TITLE]주권 프로필[/TITLE]\n본문');
  await fs.writeFile(path.join(post, 'connector-source.json'), JSON.stringify({ personId: 'SP1', row: { personId: 'SP1', majorType: '운동선수', promptType: '야구선수', name: '주권' } }));
  // A later civic post must not affect a one-post run's athlete destination.
  const later = path.join(workspace, 'posts', '002'); await fs.mkdir(later);
  await fs.writeFile(path.join(later, 'content.txt'), '[TITLE]정치인 프로필[/TITLE]\n본문');
  await fs.writeFile(path.join(later, 'connector-source.json'), JSON.stringify({ row: { majorType: '정치인' } }));
  const attach = vi.fn((_endpoint: string, _blogUrl: string) => ({ verifySession: async () => ({ ok: true as const }), close: async () => {}, saveDraft: async () => ({ outcome: 'confirmed' as const, status: 'draft_saved' as const }) }));
  const errors: string[] = [];
  const code = await main(['run', '--workspace', workspace, '--blog-url', requested, '--max-posts', '1'], {
    attachAutomation: attach, runPosts: async () => ({ stopped: false, message: 'complete' }), log: () => {}, error: message => errors.push(message)
  });
  if (requested === 'auto') {
    expect(code, errors.join()).toBe(0);
    expect(attach.mock.calls[0]?.[1]).toBe('https://time-giver.tistory.com');
  } else {
    expect(code).toBe(1); expect(errors.join()).toMatch(/mismatch/i); expect(attach).not.toHaveBeenCalled();
  }
});
