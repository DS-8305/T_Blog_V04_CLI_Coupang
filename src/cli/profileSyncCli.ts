import path from 'node:path';
import { createGoogleSheetsClient } from '../sheets/googleSheetsClient';
import { syncProfileResult } from '../sheets/profileResultSync';

export async function profileSyncMain(argv: string[], overrides: {
  sync?: typeof syncProfileResult; log?: (message:string)=>void; error?: (message:string)=>void
} = {}): Promise<number> {
  try {
    const args = argv[0] === '--' ? argv.slice(1) : argv;
    if (args.length !== 2 || args[0] !== '--post' || !path.isAbsolute(args[1]!)) {
      throw new Error('Usage: profile:sync --post <absolute post folder>');
    }
    const url = await (overrides.sync ?? syncProfileResult)(args[1]!,createGoogleSheetsClient());
    (overrides.log ?? console.log)(`Profile results and Google Docs verified: ${url}. result remains reserved for draft completion.`);
    return 0;
  } catch (error) {
    (overrides.error ?? console.error)(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (process.argv[1]?.endsWith('profileSyncCli.js')) {
  void profileSyncMain(process.argv.slice(2)).then(code => {process.exitCode=code;});
}
