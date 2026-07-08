/**
 * pdf.js worker entry. Wraps the stock worker so the ReadableStream
 * async-iteration polyfill is installed inside the worker context too —
 * its DecompressionStream decode path uses `for await`, which WKWebView
 * lacks natively.
 */
import './streamPolyfill'
import 'pdfjs-dist/build/pdf.worker.min.mjs'
