/**
 * exporter.js - PDF Export Engine
 * Converts resume JSON → clean HTML → PDF via jsPDF + html2canvas
 * Produces ATS-compliant, single-column PDF output.
 */

function shouldIncludeSection(options, section) {
  return options?.sections?.[section] !== false;
}

function getPageLimit(options) {
  return Number(options?.pageCount) === 2 ? 2 : 1;
}

/**
 * Convert resume JSON data to clean ATS HTML string
 */
export function resumeToHTML(data, options = {}) {
  const s = (value) => value === null || value === undefined
    ? ''
    : String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const skillsSection = shouldIncludeSection(options, 'skills') && data.skills
    ? `<h2>Technical Skills</h2>
       ${data.skills.languages?.length ? `<p><strong>Languages:</strong> ${data.skills.languages.map(s).join(', ')}</p>` : ''}
       ${data.skills.frameworks?.length ? `<p><strong>Frameworks:</strong> ${data.skills.frameworks.map(s).join(', ')}</p>` : ''}
       ${data.skills.tools?.length ? `<p><strong>Tools & Platforms:</strong> ${data.skills.tools.map(s).join(', ')}</p>` : ''}
       ${data.skills.other?.length ? `<p><strong>Other:</strong> ${data.skills.other.map(s).join(', ')}</p>` : ''}`
    : '';

  const experienceSection = shouldIncludeSection(options, 'experience') && data.experience?.length
    ? `<h2>Experience</h2>
       ${data.experience.map(exp => `
         <div class="entry">
           <div class="entry-header">
             <div><strong>${s(exp.title)}</strong> — ${s(exp.company)}</div>
             <div class="date">${s(exp.dateRange)}${exp.location ? ` · ${s(exp.location)}` : ''}</div>
           </div>
           <ul>${(exp.bullets || []).map(b => `<li>${s(b)}</li>`).join('')}</ul>
         </div>`).join('')}`
    : '';

  const projectsSection = shouldIncludeSection(options, 'projects') && data.projects?.length
    ? `<h2>Projects</h2>
       ${data.projects.map(proj => `
         <div class="entry">
           <div class="entry-header">
             <div><strong>${s(proj.name)}</strong>${proj.techStack?.length ? ` <span class="tech">| ${proj.techStack.map(s).join(', ')}</span>` : ''}${proj.url ? ` — <a href="https://${s(proj.url)}">${s(proj.url)}</a>` : ''}</div>
           </div>
           ${proj.description ? `<p class="proj-desc">${s(proj.description)}</p>` : ''}
           <ul>${(proj.bullets || []).map(b => `<li>${s(b)}</li>`).join('')}</ul>
         </div>`).join('')}`
    : '';

  const educationSection = shouldIncludeSection(options, 'education') && data.education?.length
    ? `<h2>Education</h2>
       ${data.education.map(edu => `
         <div class="entry">
           <div class="entry-header">
             <div><strong>${s(edu.degree)}</strong> — ${s(edu.institution)}</div>
             <div class="date">${s(edu.year)}${edu.gpa ? ` · GPA: ${s(edu.gpa)}` : ''}</div>
           </div>
         </div>`).join('')}`
    : '';

  const certsSection = shouldIncludeSection(options, 'certifications') && data.certifications?.length
    ? `<h2>Certifications</h2>
       <ul>${data.certifications.map(c => `<li>${s(typeof c === 'string' ? c : c.name)}</li>`).join('')}</ul>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Arial', sans-serif;
    font-size: 11pt;
    color: #111;
    line-height: 1.45;
    background: #fff;
    padding: 40px 48px;
    max-width: 800px;
    margin: 0 auto;
  }
  .header { margin-bottom: 16px; }
  .name { font-size: 22pt; font-weight: 700; letter-spacing: -0.02em; }
  .tagline { font-size: 11pt; color: #555; margin: 2px 0 8px; }
  .contact {
    font-size: 9.5pt;
    color: #666;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .contact a { color: #6c63ff; text-decoration: none; }
  hr { border: none; border-top: 1.5px solid #222; margin: 10px 0 14px; }
  h2 {
    font-size: 10pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #444;
    margin-bottom: 8px;
    border-bottom: 1px solid #ddd;
    padding-bottom: 3px;
  }
  .summary { font-size: 10.5pt; color: #333; margin-bottom: 14px; line-height: 1.55; }
  .entry { margin-bottom: 12px; }
  .entry-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 4px;
    flex-wrap: wrap;
    gap: 4px;
  }
  .date { font-size: 9.5pt; color: #666; white-space: nowrap; }
  .tech { color: #888; font-size: 9.5pt; }
  .proj-desc { font-size: 9.5pt; color: #555; margin-bottom: 4px; }
  ul { margin-left: 16px; }
  li { font-size: 10.5pt; color: #333; margin: 2px 0; }
  p { font-size: 10.5pt; margin: 2px 0; }
  strong { color: #111; }
  a { color: #6c63ff; text-decoration: none; }
  section { margin-bottom: 14px; }
</style>
</head>
<body>
  <div class="header">
    <div class="name">${s(data.name)}</div>
    ${data.tagline ? `<div class="tagline">${s(data.tagline)}</div>` : ''}
    <div class="contact">
      ${data.contact?.email ? `<span>${s(data.contact.email)}</span>` : ''}
      ${data.contact?.github ? `<a href="https://${s(data.contact.github)}">${s(data.contact.github)}</a>` : ''}
      ${data.contact?.linkedin ? `<a href="https://${s(data.contact.linkedin)}">${s(data.contact.linkedin)}</a>` : ''}
      ${data.contact?.location ? `<span>${s(data.contact.location)}</span>` : ''}
    </div>
  </div>
  <hr>
   ${shouldIncludeSection(options, 'summary') && data.summary ? `<section><p class="summary">${s(data.summary)}</p></section>` : ''}
  ${skillsSection ? `<section>${skillsSection}</section>` : ''}
  ${experienceSection ? `<section>${experienceSection}</section>` : ''}
  ${projectsSection ? `<section>${projectsSection}</section>` : ''}
  ${educationSection ? `<section>${educationSection}</section>` : ''}
  ${certsSection ? `<section>${certsSection}</section>` : ''}
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
