/* JobFlow AI - reads CV files locally (PDF via pdf.js, DOCX via mammoth, TXT). */
(function (root) {
  const MAX_BYTES = 10 * 1024 * 1024;

  async function readPdf(file) {
    const pdfjs = await import(chrome.runtime.getURL('lib/pdf.min.mjs'));
    pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.mjs');
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    for (let i = 1; i <= Math.min(pdf.numPages, 12); i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      let line = '';
      let lastY = null;
      const lines = [];
      for (const item of content.items) {
        const y = item.transform ? Math.round(item.transform[5]) : null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
          lines.push(line.trim());
          line = '';
        }
        line += item.str + (item.hasEOL ? '\n' : ' ');
        lastY = y;
      }
      lines.push(line.trim());
      pages.push(lines.filter(Boolean).join('\n'));
    }
    return pages.join('\n\n');
  }

  async function readDocx(file) {
    const result = await root.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return result.value;
  }

  async function readCv(file) {
    if (!file) throw new Error('No file selected.');
    if (file.size > MAX_BYTES) throw new Error('That file is larger than 10 MB.');
    const name = file.name.toLowerCase();
    let text;
    if (name.endsWith('.pdf') || file.type === 'application/pdf') text = await readPdf(file);
    else if (name.endsWith('.docx')) text = await readDocx(file);
    else if (name.endsWith('.txt') || file.type === 'text/plain') text = await file.text();
    else if (name.endsWith('.doc')) throw new Error('Old .doc files are not supported. Save it as PDF or DOCX.');
    else throw new Error('Please upload a PDF, DOCX or TXT file.');

    text = String(text || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (text.length < 80) {
      throw new Error("We couldn't read text from this file. If it's a scanned image, export a text-based PDF instead.");
    }
    return text;
  }

  root.JobFlowCvReader = { readCv };
})(self);
