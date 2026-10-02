import type { PDFDocumentLoadingTask } from 'pdfjs-dist'

// pdf.js is loaded only when a PDF is opened (a recipe card, a coloring page), so the app bundle
// doesn't carry it. Its canvases show every page: iOS web views show only the first page of a PDF in an iframe.
export async function openPdf(data: ArrayBuffer): Promise<PDFDocumentLoadingTask> {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  return pdfjs.getDocument({ data })
}
