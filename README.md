# Stitch Focus

Stitch Focus is a browser-based cross-stitch chart viewer. Click stitches or thread rows to add or remove colors from the selection. Under **Other colors**, set opacity to 0% to hide other stitches or set saturation to 0% to make them grayscale. Zoom and scroll with stitch rulers on all four edges of the viewport. **Grid settings** controls the 10-stitch guide lines and the optional 1 × 1 grid.

Checkboxes mark whole thread colors complete. Progress is stored in the current browser and restored when you open the same pattern file with the same manual grid settings, if any.

Use **Progress backup** to copy a code containing all saved checkmarks. Paste it into **Progress backup** on the destination device and choose **Import code**. Import combines checkmarks by default. Select the replace option to restore the saved checkmarks for the patterns in the code exactly. Keep your pattern files alongside the code.

## Importing patterns

- **HaftiX-style PDF charts.** The viewer can assemble charts that include extractable stitch symbols and numbered grid axes. It reads matching thread names from a compatible embedded PDF key. Use **Add thread key** to apply a separate compatible key.
- **Open Cross Stitch (.oxs).** The importer reads the dimensions, thread palette, and full crosses. Specialty stitches such as partial crosses, backstitches, knots, and beads are skipped. Programs including FlossCross can export OXS. [OXS specification and sample chart](https://www.ursasoftware.com/OXSFormat/) · [FlossCross export options](https://flosscross.com/)
- **Flat-color charts in PDF, PNG, JPEG, or GIF.** Choose a chart page if prompted, then enter the number of columns and rows and match the chart boundaries. For a one-pixel-per-stitch image, use the full image and its pixel dimensions. JPEG import groups nearby color values to reduce compression artifacts. Use PNG or OXS for colors that are close together. GIF import reads the first frame. Symbol-only scans require a flat-color export to distinguish threads. [Stitch Fiddle export formats](https://www.stitchfiddle.com/en/help/1pe3-3svb1t/download-print)

Patterns and thread keys are processed in the browser. The public repository contains an original sample chart, the app, and a vendored copy of [Mozilla PDF.js](https://github.com/mozilla/pdf.js) under its [Apache 2.0 license](vendor/pdfjs/LICENSE).

## Running from source

Serve the repository root over HTTP, for example with `python -m http.server 8000`, and open `http://localhost:8000/`. For GitHub Pages, select **Deploy from a branch**, then **main** and **/ (root)** in the repository's Pages settings. The app needs no build step.
