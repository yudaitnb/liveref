import * as Comlink from "comlink";
import RunnerWorker from "./runner.worker?worker";
import type { RunnerApi, RunResult, RunnerOptions } from "./runnerTypes";

export type { RunResult, RunnerOptions };

export type RunnerHandle = {
  run: (code: string, timeoutMs: number, opts?: RunnerOptions) => Promise<RunResult>;
  stop: () => void;
  isRunning: () => boolean;
};

export function createRunner(): RunnerHandle {
  let worker: Worker | null = null;
  let api: Comlink.Remote<RunnerApi> | null = null;
  let running = false;

  const start = () => {
    worker = new RunnerWorker();
    api = Comlink.wrap<RunnerApi>(worker);
  };

  const stop = () => {
    if (worker) worker.terminate();
    worker = null;
    api = null;
    running = false;
  };

  const run = async (code: string, timeoutMs: number, opts?: RunnerOptions) => {
    stop();
    start();
    running = true;

    const timeout = new Promise<never>((_, rej) => {
      const id = setTimeout(() => {
        clearTimeout(id);
        stop();
        rej(new Error(`Timeout: exceeded ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      const res = await Promise.race([api!.run(code, opts), timeout]);
      running = false;
      stop();
      return res;
    } catch (e) {
      running = false;
      stop();
      throw e;
    }
  };

  return { run, stop, isRunning: () => running };
}
