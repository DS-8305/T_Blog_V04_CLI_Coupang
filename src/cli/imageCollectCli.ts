import { parseImageCollectArgs } from "./imageCollectArgs";
import { collectPostImages, type ImageCollectDependencies } from "./imageCollect";

export type ImageCollectCliDependencies = ImageCollectDependencies & {
  collect?: typeof collectPostImages;
  log?: (message: string) => void;
  error?: (message: string) => void;
};

export async function imageCollectMain(
  argv: string[],
  overrides: ImageCollectCliDependencies = {}
): Promise<number> {
  const collect = overrides.collect ?? collectPostImages;
  const log = overrides.log ?? console.log;
  const logError = overrides.error ?? console.error;

  try {
    const args = parseImageCollectArgs(argv);
    const manifest = await collect(args, {
      ...overrides,
      onLog: overrides.onLog ?? log
    });

    const markerSummary = manifest.images.map((item) => item.marker).join(", ");
    log(
      `Collected ${manifest.images.length} image(s) for "${manifest.keyword}" (${manifest.engine}): ${markerSummary}`
    );
    return 0;
  } catch (error) {
    logError(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (process.argv[1]?.endsWith("imageCollectCli.js")) {
  void imageCollectMain(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
