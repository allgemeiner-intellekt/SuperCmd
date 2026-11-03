import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';

export interface AppleScriptOptions {
  language?: string;
  humanReadableOutput?: boolean;
  timeout?: number;
}

type SpawnScript = (
  executable: string,
  args: string[],
  options: { stdio: ['pipe', 'pipe', 'pipe'] },
) => ChildProcessWithoutNullStreams;

// Match the previous spawnSync default; bound each output stream independently.
const MAX_OUTPUT_BYTES = 1024 * 1024;

/** The injected adapter lets tests exercise real child lifetimes without macOS. */
export function createAppleScriptRunner(spawnScript: SpawnScript = spawn) {
  return (script: string, options?: AppleScriptOptions): Promise<string> => {
    const language = /^javascript$/i.test(String(options?.language || 'AppleScript').trim())
      ? 'JavaScript' : 'AppleScript';
    const args = ['-l', language];
    if (options?.humanReadableOutput === false) args.push('-s', 's');
    const timeout = typeof options?.timeout === 'number' && Number.isFinite(options.timeout)
      ? Math.max(1, Math.min(options.timeout, 5 * 60 * 1000)) : undefined;

    return new Promise((resolve, reject) => {
      const child = spawnScript('/usr/bin/osascript', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let failure: Error | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const stop = (error: Error) => {
        if (failure) return;
        failure = error;
        // A timeout must also stop children that ignore SIGTERM. Settle on close
        // so the caller cannot start another run before this child is reaped.
        child.kill('SIGKILL');
      };
      child.stdout.on('data', (chunk: Buffer) => {
        if (failure) return;
        stdoutBytes += chunk.length;
        if (stdoutBytes > MAX_OUTPUT_BYTES) stop(new Error('AppleScript stdout exceeded maxBuffer'));
        else stdout.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (failure) return;
        stderrBytes += chunk.length;
        if (stderrBytes > MAX_OUTPUT_BYTES) stop(new Error('AppleScript stderr exceeded maxBuffer'));
        else stderr.push(chunk);
      });
      child.on('error', stop);
      child.stdin.on('error', (error: NodeJS.ErrnoException) => {
        // An interpreter may exit before reading stdin; its exit status/stderr
        // is more useful than EPIPE and still decides success or failure.
        if (error.code !== 'EPIPE') stop(error);
      });
      child.on('close', (code) => {
        if (timer !== undefined) clearTimeout(timer);
        if (failure) reject(failure);
        else if (code !== 0) reject(new Error(Buffer.concat(stderr).toString('utf8').trim() || 'AppleScript execution failed'));
        else resolve(Buffer.concat(stdout).toString('utf8').trim());
      });
      if (timeout !== undefined) {
        timer = setTimeout(() => stop(new Error('AppleScript execution timed out')), timeout);
      }
      child.stdin.end(script);
    });
  };
}

export const runAppleScript = createAppleScriptRunner();
