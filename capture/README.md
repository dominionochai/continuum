# Gemini Nano test kit

One HTML file, no install, no network calls. Open it in Chrome, follow the three steps on the page, and send the
report back. It checks the computer first (no download), asks before the ~4 GB model download, then records
availability, download behavior, latency, the cost of a health probe, and the exact errors from forced failures
(oversized prompt, abort, use-after-destroy, bad options).

## Needs
- Desktop Chrome on Windows 10/11, macOS 13+, or Linux.
- 22 GB free on the drive holding the Chrome profile.
- 16 GB RAM and 4+ CPU cores, or a GPU with more than 4 GB of VRAM.
- An unmetered connection for the one-time download.

## If opening the file directly does not work
The page opens fine from disk, but Chrome may only expose the API on `http://localhost`. If the page keeps saying
the feature is not switched on after both flags are set and Chrome is relaunched, serve the folder:
`python3 -m http.server 8000` (or `npx serve`) and open `http://localhost:8000/capture.html`.

## After the report comes back
`npm run analyze -- report.json` prints a summary (eligibility, download, latency, probe cost, whether the model
reported available and then failed) and how Continuum's classifier handles each real error.
