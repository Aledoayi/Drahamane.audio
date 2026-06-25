"use strict";

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = __dirname;
const audioDirectory = path.join(projectRoot, "audio");
const supportedExtensions = new Set([
  ".mp3",
  ".m4a",
  ".aac",
  ".wav",
  ".ogg",
  ".oga",
  ".flac",
  ".webm",
]);

const files = fs
  .readdirSync(audioDirectory, { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isFile() &&
      supportedExtensions.has(path.extname(entry.name).toLowerCase()),
  )
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right, "fr", { numeric: true }));

const json = `${JSON.stringify(files, null, 2)}\n`;
const javascript = `"use strict";\n\nwindow.AUDIO_TRACKS = ${JSON.stringify(files, null, 2)};\n`;

fs.writeFileSync(path.join(audioDirectory, "manifest.json"), json);
fs.writeFileSync(path.join(audioDirectory, "manifest.js"), javascript);

console.log(`${files.length} piste(s) ajoutée(s) au manifeste.`);
