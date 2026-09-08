# PDF dependencies

Served from this site; loaded only by the PDF worker. No build step required.

- `jspdf-4.2.1.umd.min.js`: jsPDF **4.2.1**, from `dist/jspdf.umd.min.js` in <https://registry.npmjs.org/jspdf/-/jspdf-4.2.1.tgz>. MIT license: `jspdf-LICENSE.txt`.
  SHA-256: `e6551fcdc32f09d6853b2c5126d18d01d9447e0da618a41a11ebeee0f6c20d54`.
- `NotoSans-Regular.ttf`: Noto Sans, from <https://github.com/notofonts/noto-fonts/blob/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf>. SIL Open Font License 1.1: `NotoSans-LICENSE.txt`.
  SHA-256: `b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5`.

Run both browser PDF suites after upgrades. The Unicode search layer uses jsPDF's font serialization hook; confirm actual text extraction and rendered international text as well as ordinary downloads.
