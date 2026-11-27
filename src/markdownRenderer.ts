import { MessagePort, parentPort } from "worker_threads";
import type { CompileOptions } from "@d2lang/d2";
import { renderSource } from "./sdk";

interface RenderRequest {
  source: string;
  filename?: string;
  options: CompileOptions;
  ready: Int32Array;
  port: MessagePort;
}

parentPort?.on("message", async (request: RenderRequest) => {
  const { ready, port } = request;
  try {
    const svg = await renderSource(request.source, request.filename, request.options);
    port.postMessage({ svg });
  } catch (error) {
    port.postMessage({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    Atomics.store(ready, 0, 1);
    Atomics.notify(ready, 0);
    port.close();
  }
});
