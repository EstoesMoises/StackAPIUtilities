import { importReportFile } from "../importers/reportImporters";

self.addEventListener(
  "message",
  async (
    event: MessageEvent<{ id: string; fileName: string; text: string }>,
  ) => {
    const { id, fileName, text } = event.data;
    try {
      const result = await importReportFile(fileName, text);
      self.postMessage({ id, ok: true, result });
    } catch (error) {
      self.postMessage({
        id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
);
