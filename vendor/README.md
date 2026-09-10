# Vendored browser dependencies

Served from this site; loaded only by the PDF worker and service worker. No build step required.

- `coi-serviceworker-0.1.7.js`: Cross-Origin-Isolation service worker helper, enables `crossOriginIsolated` by setting COOP/COEP headers. MIT license.
  SHA-256: `d3fb4cfb0654a3a7c05d8cd43658dbb2123e7547d0dc279891d889f714039802`.
- `jspdf-4.2.1.umd.min.js`: jsPDF **4.2.1**, from `dist/jspdf.umd.min.js` in <https://registry.npmjs.org/jspdf/-/jspdf-4.2.1.tgz>. MIT license: `jspdf-LICENSE.txt`.
  SHA-256: `e6551fcdc32f09d6853b2c5126d18d01d9447e0da618a41a11ebeee0f6c20d54`.
- `NotoSans-Regular.ttf`: Noto Sans, from <https://github.com/notofonts/noto-fonts/blob/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf>. SIL Open Font License 1.1: `NotoSans-LICENSE.txt`.
  SHA-256: `b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5`.

Run both browser PDF suites after upgrades. The Unicode search layer uses jsPDF's font serialization hook; confirm actual text extraction and rendered international text as well as ordinary downloads.

Safe Mode uses `transformers-3.8.1.min.js` and its single-threaded ONNX WebAssembly runtime from `@huggingface/transformers` **3.8.1**. Apache-2.0 license: `TransformersJS-LICENSE.txt`.

- Transformers.js SHA-256: `aa5002b70e789798da263f5f99c62bd3e8fcd0c119258a493c40c180648365fa`
- ONNX loader SHA-256: `08fb86ec433c78bfb032c5d84a68b8e8e5a8d81268fa39e24314179a5767a5b9`
- ONNX WASM SHA-256: `c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39`

Model weights are quantized, fetched by pinned revision from Hugging Face on first use, and cached by the browser. Model repositories and revisions are declared in `safe-worker.js`; each repository contains its own licence notice and model card.

- [DistilBERT multilingual toxicity classifier](https://huggingface.co/onnx-community/distilbert-multilingual-toxicity-classifier-ONNX), revision `4fbaccee8caaba02641b1757f7ef697e3fbffdb8` (OpenRAIL++).
- [MobileBERT MNLI](https://huggingface.co/Xenova/mobilebert-uncased-mnli), revision `8b0ea66ab7b190bba77418ba03b67d69cfc9a1ee` (see upstream model card).
- [CLIP ViT-B/32](https://huggingface.co/Xenova/clip-vit-base-patch32), revision `d15189d7028b43f1d3e65039190477f6af591c2a` (see upstream model card).
