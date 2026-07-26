/**
 * exporter.js - PDF Export Engine
 * Converts resume JSON → clean HTML → PDF via jsPDF + html2canvas
 * Produces ATS-compliant, single-column PDF output.
 */

import { getTemplate, normalizeTemplateOptions, SAMPLE_RESUME } from './templates/index.js';

function getPageLimit(options) {
  return Number(options?.pageCount) === 2 ? 2 : 1;
}

export function resolveRenderOptions(options = {}) {
  const template = getTemplate(options.templateId);
  return {
    ...options,
    ...normalizeTemplateOptions(options),
    templateId: template.id,
    sections: options.sections || {},
  };
}

/**
 * Convert resume JSON data to clean ATS HTML string
 */
export function resumeToHTML(data, options = {}) {
  const resolvedOptions = resolveRenderOptions(options);
  const template = getTemplate(resolvedOptions.templateId);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  ${template.getCSS(resolvedOptions)}
</style>
</head>
<body>
  ${template.getHTML(data, resolvedOptions)}
</body>
</html>`;
}

/**
 * Render resume HTML into a preview container
 */
export function renderResumePreview(container, data, options = {}) {
  const html = resumeToHTML(data, options);
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'width:100%; height:100%; border:none; min-height:600px;';
  container.innerHTML = '';
  container.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  return iframe;
}

export function renderTemplateThumbnail(container, templateId, options = {}) {
  const thumbnailOptions = { ...options, templateId, pageCount: 1 };
  const iframe = document.createElement('iframe');
  iframe.title = `${getTemplate(templateId).name} template preview`;
  iframe.setAttribute('aria-label', iframe.title);
  iframe.style.cssText = 'width:333%; height:333%; transform:scale(0.3); transform-origin:top left; border:0; pointer-events:none;';
  container.innerHTML = '';
  container.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  doc.write(resumeToHTML(SAMPLE_RESUME, thumbnailOptions));
  doc.close();
  return iframe;
}

/**
 * Export resume to PDF using jsPDF + html2canvas
 */
export async function exportToPDF(resumeData, filename = 'resume.pdf', options = {}) {
  if (typeof window.jspdf === 'undefined' && typeof window.jsPDF === 'undefined') {
    throw new Error('jsPDF library not loaded.');
  }
  if (typeof window.html2canvas === 'undefined') {
    throw new Error('html2canvas library not loaded.');
  }

  const { jsPDF } = window.jspdf || window;
  const html = resumeToHTML(resumeData, options);

  // Create hidden iframe to render the HTML
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed; left:-9999px; top:-9999px; width:800px; height:1px; visibility:hidden;';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  // Wait for fonts and layout
  await new Promise(r => setTimeout(r, 600));

  const body = doc.body;
  const totalHeight = body.scrollHeight;
  iframe.style.height = totalHeight + 'px';

  await new Promise(r => setTimeout(r, 200));

  const canvas = await window.html2canvas(body, {
    scale: 2,
    useCORS: true,
    allowTaint: true,
    backgroundColor: '#ffffff',
    width: 800,
    height: totalHeight,
    windowWidth: 800,
  });

  document.body.removeChild(iframe);

  const imgData = canvas.toDataURL('image/png');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const pageWidth = 210; // A4 width in mm
  const pageHeight = 297; // A4 height in mm
  const naturalImgWidth = pageWidth;
  const naturalImgHeight = (canvas.height * naturalImgWidth) / canvas.width;
  const maxHeight = pageHeight * getPageLimit(options);
  const fitScale = naturalImgHeight > maxHeight ? maxHeight / naturalImgHeight : 1;
  const imgWidth = naturalImgWidth * fitScale;
  const imgHeight = naturalImgHeight * fitScale;
  const x = (pageWidth - imgWidth) / 2;

  let y = 0;
  let pageNum = 0;

  while (y < imgHeight - 0.01) {
    if (pageNum > 0) pdf.addPage();
    pdf.addImage(imgData, 'PNG', x, -y, imgWidth, imgHeight);
    y += pageHeight;
    pageNum++;
  }

  pdf.save(filename);
}

/**
 * Generate safe filename from resume data
 */
export function getResumeFilename(resumeData, companyHint = '') {
  const name = (resumeData.name || 'resume').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  const company = companyHint ? `_${companyHint.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}` : '';
  const date = new Date().toISOString().split('T')[0];
  return `${name}${company}_${date}.pdf`;
}
