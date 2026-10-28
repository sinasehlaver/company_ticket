import { fileName, MAX_BYTES } from "./envelope.js";

// Save: File System Access API when present (Chromium), otherwise a download. Returns false if the user cancelled.
export async function saveFile(app, envelope) {
  const text = JSON.stringify(envelope, null, 2);
  const name = fileName(app);
  if (window.showSaveFilePicker) {
    try {
      const h = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: "JSON", accept: { "application/json": [".json"] } }] });
      const w = await h.createWritable();
      await w.write(text);
      await w.close();
      return true;
    } catch (e) {
      if (e?.name === "AbortError") return false;
      throw e;
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

// Open: returns the file text, or null if cancelled. Size is checked before reading.
export async function openFile() {
  if (window.showOpenFilePicker) {
    try {
      const [h] = await window.showOpenFilePicker({ types: [{ description: "JSON", accept: { "application/json": [".json"] } }] });
      const f = await h.getFile();
      if (f.size > MAX_BYTES) throw new Error("file too large");
      return await f.text();
    } catch (e) {
      if (e?.name === "AbortError") return null;
      throw e;
    }
  }
  return new Promise((resolve, reject) => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept: "application/json,.json" });
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      if (f.size > MAX_BYTES) return reject(new Error("file too large"));
      resolve(await f.text());
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}
