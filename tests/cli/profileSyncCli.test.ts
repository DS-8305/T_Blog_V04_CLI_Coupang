import { expect,it,vi } from 'vitest';
import { profileSyncMain } from '../../src/cli/profileSyncCli';
it('rejects missing or relative --post before accessing APIs',async () => {
  const sync=vi.fn();
  expect(await profileSyncMain([],{sync,error:vi.fn()})).toBe(1);
  expect(await profileSyncMain(['--post','relative'],{sync,error:vi.fn()})).toBe(1);
  expect(sync).not.toHaveBeenCalled();
});
it('syncs only the explicit post folder',async () => {
  const sync=vi.fn(async(_folder: string)=> 'https://docs.google.com/document/d/id/edit');
  expect(await profileSyncMain(['--post','C:\\workspace\\posts\\one'],{sync,log:vi.fn()})).toBe(0);
  expect(sync.mock.calls[0]?.[0]).toBe('C:\\workspace\\posts\\one');
});
