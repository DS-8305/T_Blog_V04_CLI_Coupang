import { main } from '../../src/cli/draftCli';
import { TistoryBlogAutomation } from '../../src/automation/TistoryBlogAutomation';

const [endpoint, blogUrl] = process.argv.slice(2);
if (!endpoint || !blogUrl) throw new Error('Test endpoint and blog URL required');
process.exitCode = await main(['verify', '--blog-url', 'sample.tistory.com'], {
  attachAutomation: () => TistoryBlogAutomation.attach(endpoint, blogUrl)
});
