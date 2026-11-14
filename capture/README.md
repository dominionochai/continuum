# Device capture kit

One HTML file, no install, no network calls. It runs Chrome's built-in model (Gemini Nano) through a short
script and records how it behaves: availability, the model download, latency, the cost of a health probe, and
the exact errors produced by forced failures (oversized prompt, abort, use-after-destroy, bad options).
The report is copied by hand; nothing is uploaded.

## Needs
- Desktop Chrome (Windows 10/11, macOS 13+, or Linux).
- 22 GB free on the drive that holds the Chrome profile.
- 16 GB RAM and 4+ CPU cores, or a GPU with more than 4 GB of VRAM.
- An unmetered connection for the one-time model download (about 4 GB; the exact size is shown at
  `chrome://on-device-internals`).

## Steps
1. Open `chrome://flags/#optimization-guide-on-device-model` and set it to **Enabled BypassPerfRequirement**.
2. Open `chrome://flags/#prompt-api-for-gemini-nano` and set it to **Enabled**. Relaunch Chrome.
3. Serve the folder from localhost (the API is guaranteed there): in the folder with `capture.html`, run
   `python3 -m http.server 8000` (or `npx serve`), then open `http://localhost:8000/capture.html`.
4. Click **Run capture** and keep the tab open. The first run downloads the model.
5. Click **Copy report** (or **Save report.json**) and send it back.

If it stops at "Not eligible", open `chrome://on-device-internals`, screenshot the **Model Status** tab, and
send that along with the report.
