import * as path from 'path';
import { Recorder } from '../../recorder/index.js';

export async function recordAction(options: any) {
    const url = options.url || process.env.TESTMAKER_URL;
    if (!url) {
        console.error('Error: URL is required for recording.');
        process.exit(1);
    }

    // Auto-detect environment for output consistency
    const isDev = url.includes('dev.ianai.co');
    const env = isDev ? 'dev' : 'stage';
    const baseOutputDir = path.join(options.outputDir || './output', env);

    const recorder = new Recorder(baseOutputDir);
    try {
        await recorder.start(url);
        console.log('[CLI] Recording session finished.');
    } catch (e) {
        console.error('[CLI] Recording failed:', e);
        process.exit(1);
    }
}
