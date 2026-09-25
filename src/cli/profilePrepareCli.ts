import fs from 'node:fs/promises';
import { prepareProfile } from './profilePrepare';

async function main() {
  const args=process.argv.slice(2).filter((arg,index)=>!(index===0 && arg==='--'));
  if (args.length!==4 || args[0]!=='--workspace' || args[2]!=='--input') {
    throw new Error('Usage: profile:prepare -- --workspace <absolute path> --input <input.json>');
  }
  const input=JSON.parse(await fs.readFile(args[3],'utf8'));
  console.log(JSON.stringify(await prepareProfile(args[1],input),null,2));
}
void main().catch(error=>{console.error(error instanceof Error ? error.message : String(error));process.exitCode=1;});
