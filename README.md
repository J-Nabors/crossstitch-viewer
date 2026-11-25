# Stitch Focus

Stitch Focus is a browser-based cross-stitch chart viewer. Open a PDF or PNG, then click a thread in the palette or a stitch in the chart. Use **Other colors** to fade, gray out, or hide the remaining stitches. Use **Grid settings** to change the 10-stitch guide lines.

Checkboxes mark whole thread colors complete. Progress is stored in the current browser and restored when you reopen the same PDF or the same PNG with the same grid settings. Keep your original pattern file so you can reopen it.

## Importing patterns

- **HaftiX-style PDF charts.** The viewer can assemble charts that include extractable stitch symbols and numbered grid axes. It reads matching thread names from a compatible embedded PDF key. Use **Add thread key** to apply a separate compatible key.
- **PNG and other PDFs.** Choose a chart page if prompted, then enter the number of columns and rows and match the chart boundaries. For a PNG with one pixel per stitch, use the full image and its pixel dimensions. The manual importer reads flat colors and groups them by sampled RGB value. Scanned or monochrome symbol-only charts require a compatible extractable chart or a flat-color export to distinguish threads.

Patterns and thread keys are processed in the browser. The public repository contains an original sample chart, the app, and a vendored copy of [Mozilla PDF.js](https://github.com/mozilla/pdf.js) under its [Apache 2.0 license](vendor/pdfjs/LICENSE).

## Running from source

Serve the repository root over HTTP, for example with `python -m http.server 8000`, and open `http://localhost:8000/`. For GitHub Pages, select **Deploy from a branch**, then **main** and **/ (root)** in the repository's Pages settings. The app needs no build step.
