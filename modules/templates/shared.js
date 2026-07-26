export const COLOR_THEMES = {
  slate: { name: 'Slate', value: '#475569' },
  indigo: { name: 'Indigo', value: '#4f46e5' },
  teal: { name: 'Teal', value: '#0d9488' },
  rose: { name: 'Rose', value: '#e11d48' },
  amber: { name: 'Amber', value: '#d97706' },
};

export const FONT_PAIRINGS = {
  sans: { name: 'Sans', heading: 'Inter', body: 'Inter' },
  'serif-heading': { name: 'Serif heading', heading: 'Playfair Display', body: 'Inter' },
  'mono-body': { name: 'Mono body', heading: 'Inter', body: 'JetBrains Mono' },
};

export const SAMPLE_RESUME = {
  name: 'Jordan Lee',
  tagline: 'Senior Software Engineer',
  contact: { email: 'jordan@example.com', github: 'github.com/jordanlee', location: 'New York, NY' },
  summary: 'Product-minded engineer delivering reliable, high-impact software for growing teams.',
  skills: { languages: ['TypeScript', 'Python'], frameworks: ['React', 'FastAPI'], tools: ['AWS', 'Docker'] },
  experience: [{
    title: 'Senior Engineer', company: 'Northstar', dateRange: '2022 – Present', location: 'Remote',
    bullets: ['Led a platform redesign that improved deployment reliability by 35%.', 'Mentored engineers and shipped customer-facing workflow improvements.'],
  }],
  projects: [{ name: 'Signal', description: 'Developer workflow platform.', techStack: ['TypeScript', 'PostgreSQL'], url: 'github.com/jordanlee/signal', bullets: ['Reduced review time by 28%.'] }],
  education: [{ degree: 'B.S. Computer Science', institution: 'State University', year: '2021' }],
  certifications: ['AWS Certified Developer'],
};

export function normalizeTemplateOptions(options = {}) {
  return {
    color: COLOR_THEMES[options.color] ? options.color : 'slate',
    fontPairing: FONT_PAIRINGS[options.fontPairing] ? options.fontPairing : 'sans',
    sections: options.sections || {},
  };
}

function escape(value) {
  return value === null || value === undefined
    ? ''
    : String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
}

function include(options, section) {
  return options.sections?.[section] !== false;
}

function section(title, content, sectionId) {
  return content ? `<section class="resume-section resume-section-${sectionId}"><h2>${title}</h2>${content}</section>` : '';
}

function contact(data) {
  const values = [data.contact?.email, data.contact?.github, data.contact?.linkedin, data.contact?.location]
    .filter(Boolean)
    .map(escape);
  return values.length ? `<div class="resume-contact">${values.map(value => `<span>${value}</span>`).join('')}</div>` : '';
}

function skillRows(data) {
  const skills = data.skills || {};
  const labels = { languages: 'Languages', frameworks: 'Frameworks', tools: 'Tools & Platforms', other: 'Other' };
  return Object.entries(labels)
    .filter(([key]) => skills[key]?.length)
    .map(([key, label]) => `<p class="skill-row"><strong>${label}:</strong> ${skills[key].map(escape).join(', ')}</p>`)
    .join('');
}

function experienceRows(data) {
  return (data.experience || []).map(item => `
    <article class="resume-entry">
      <div class="entry-heading"><strong>${escape(item.title)}</strong><span>${escape(item.dateRange)}${item.location ? ` · ${escape(item.location)}` : ''}</span></div>
      <div class="entry-subheading">${escape(item.company)}</div>
      ${(item.bullets || []).length ? `<ul>${item.bullets.map(bullet => `<li>${escape(bullet)}</li>`).join('')}</ul>` : ''}
    </article>`).join('');
}

function projectRows(data) {
  return (data.projects || []).map(item => `
    <article class="resume-entry">
      <div class="entry-heading"><strong>${escape(item.name)}</strong>${item.techStack?.length ? `<span class="tech-stack">${item.techStack.map(escape).join(' · ')}</span>` : ''}</div>
      ${item.description ? `<p class="project-description">${escape(item.description)}</p>` : ''}
      ${(item.bullets || []).length ? `<ul>${item.bullets.map(bullet => `<li>${escape(bullet)}</li>`).join('')}</ul>` : ''}
    </article>`).join('');
}

function educationRows(data) {
  return (data.education || []).map(item => `
    <article class="resume-entry education-entry"><div class="entry-heading"><strong>${escape(item.degree)}</strong><span>${escape(item.year)}${item.gpa ? ` · GPA ${escape(item.gpa)}` : ''}</span></div><div class="entry-subheading">${escape(item.institution)}</div></article>`).join('');
}

function certificationRows(data) {
  return (data.certifications || []).map(item => `<li>${escape(typeof item === 'string' ? item : item.name)}</li>`).join('');
}

export function getResumeSections(data, options) {
  return {
    summary: include(options, 'summary') && data.summary ? section('Summary', `<p class="resume-summary">${escape(data.summary)}</p>`, 'summary') : '',
    skills: include(options, 'skills') ? section('Technical Skills', skillRows(data), 'skills') : '',
    experience: include(options, 'experience') ? section('Experience', experienceRows(data), 'experience') : '',
    projects: include(options, 'projects') ? section('Projects', projectRows(data), 'projects') : '',
    education: include(options, 'education') ? section('Education', educationRows(data), 'education') : '',
    certifications: include(options, 'certifications') ? section('Certifications', certificationRows(data) ? `<ul class="certifications">${certificationRows(data)}</ul>` : '', 'certifications') : '',
  };
}

export function getTemplateHTML(data, rawOptions = {}, variant = 'classic') {
  const options = normalizeTemplateOptions(rawOptions);
  const sections = getResumeSections(data, options);
  const header = `<header class="resume-header"><div class="resume-name">${escape(data.name)}</div>${data.tagline ? `<div class="resume-tagline">${escape(data.tagline)}</div>` : ''}${contact(data)}</header>`;
  const standardContent = `${sections.summary}${sections.skills}${sections.experience}${sections.projects}${sections.education}${sections.certifications}`;

  if (variant === 'compact') {
    return `<article class="resume-document template-${variant}">${header}<div class="compact-layout"><aside>${sections.skills}${sections.education}${sections.certifications}</aside><main>${sections.summary}${sections.experience}${sections.projects}</main></div></article>`;
  }

  return `<article class="resume-document template-${variant}">${header}<main class="resume-content">${standardContent}</main></article>`;
}

export function getTemplateCSS(rawOptions = {}, variant = 'classic') {
  const options = normalizeTemplateOptions(rawOptions);
  const accent = COLOR_THEMES[options.color].value;
  const pairing = FONT_PAIRINGS[options.fontPairing];
  const headingFont = pairing.heading === 'Playfair Display' ? "'Playfair Display', Georgia, serif" : "'Inter', Arial, sans-serif";
  const bodyFont = pairing.body === 'JetBrains Mono' ? "'JetBrains Mono', 'Courier New', monospace" : "'Inter', Arial, sans-serif";

  return `
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body { color: #16202b; font-family: ${bodyFont}; font-size: 10.2pt; line-height: 1.44; }
    .resume-document { --resume-accent: ${accent}; width: 100%; min-height: 100%; padding: 38px 46px; background: #fff; }
    .resume-header { margin-bottom: 18px; }
    .resume-name { color: #102030; font-family: ${headingFont}; font-size: 25pt; font-weight: 750; letter-spacing: -0.04em; line-height: 1.04; }
    .resume-tagline { color: var(--resume-accent); font-size: 10.5pt; font-weight: 700; margin-top: 5px; }
    .resume-contact { display: flex; flex-wrap: wrap; gap: 5px 13px; color: #52606d; font-size: 8.8pt; margin-top: 10px; }
    .resume-contact span + span::before { content: '•'; color: var(--resume-accent); margin-right: 13px; }
    .resume-section { break-inside: avoid; margin: 0 0 15px; }
    .resume-section h2 { color: #243342; font-family: ${headingFont}; font-size: 9.5pt; font-weight: 800; letter-spacing: .095em; margin: 0 0 7px; padding-bottom: 4px; text-transform: uppercase; }
    .resume-summary, .skill-row, .project-description { margin: 0; }
    .skill-row + .skill-row { margin-top: 2px; }
    .resume-entry { break-inside: avoid; margin: 0 0 9px; }
    .entry-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
    .entry-heading strong { color: #152331; font-size: 10.4pt; }
    .entry-heading > span { color: #637282; font-size: 8.6pt; text-align: right; white-space: nowrap; }
    .entry-subheading { color: #4b5d6e; font-size: 9.4pt; font-weight: 650; margin-top: 1px; }
    .project-description { color: #465869; font-size: 9.2pt; margin-top: 2px; }
    .tech-stack { color: var(--resume-accent) !important; font-size: 8.4pt !important; font-weight: 700; }
    ul { margin: 4px 0 0 17px; padding: 0; }
    li { margin: 1.5px 0; padding-left: 1px; }
    li::marker { color: var(--resume-accent); }
    .certifications { columns: 2; }
    .certifications li { break-inside: avoid; }
    .template-classic { padding: 44px 54px; }
    .template-classic .resume-header { border-bottom: 2px solid var(--resume-accent); padding-bottom: 12px; }
    .template-classic .resume-section h2 { border-bottom: 1px solid #cbd5df; }
    .template-modern { border-left: 10px solid var(--resume-accent); padding-left: 36px; }
    .template-modern .resume-section h2 { border-left: 4px solid var(--resume-accent); padding-left: 8px; }
    .template-modern .resume-name { font-size: 28pt; }
    .template-minimal { padding: 50px 60px; }
    .template-minimal .resume-header { margin-bottom: 28px; }
    .template-minimal .resume-section { margin-bottom: 22px; }
    .template-minimal .resume-section h2 { border: 0; color: #7a8792; font-size: 8.3pt; padding: 0; }
    .template-compact { padding: 32px 34px; font-size: 9.3pt; }
    .template-compact .resume-header { border-bottom: 2px solid var(--resume-accent); padding-bottom: 10px; }
    .compact-layout { display: grid; grid-template-columns: 31% 1fr; gap: 24px; }
    .compact-layout aside { border-right: 1px solid #d8e0e6; padding-right: 16px; }
    .compact-layout .resume-section { margin-bottom: 13px; }
    .compact-layout .resume-section h2 { color: var(--resume-accent); font-size: 8.5pt; }
    .template-executive { padding: 0 46px 38px; }
    .template-executive .resume-header { background: var(--resume-accent); color: #fff; margin: 0 -46px 25px; padding: 32px 46px 24px; }
    .template-executive .resume-name, .template-executive .resume-tagline, .template-executive .resume-contact { color: #fff; }
    .template-executive .resume-contact span + span::before { color: rgba(255,255,255,.65); }
    .template-executive .resume-section h2 { border-bottom: 2px solid var(--resume-accent); }
    .template-technical { background-image: linear-gradient(to bottom, rgba(71,85,105,.07) 1px, transparent 1px); background-size: 100% 25px; }
    .template-technical .resume-header { border: 1px solid var(--resume-accent); padding: 14px; }
    .template-technical .resume-name, .template-technical .resume-section h2 { font-family: 'JetBrains Mono', 'Courier New', monospace; }
    .template-technical .resume-section h2 { border-bottom: 1px dashed var(--resume-accent); color: var(--resume-accent); }
  `;
}

export function createThumbnail(label, color) {
  return `<svg viewBox="0 0 180 120" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escape(label)} template preview"><rect width="180" height="120" fill="#ffffff"/><rect x="14" y="13" width="152" height="94" rx="2" fill="#f8fafc" stroke="#d7e0e7"/><rect x="27" y="26" width="73" height="7" rx="2" fill="${color}"/><rect x="27" y="40" width="124" height="3" rx="1.5" fill="#94a3b8"/><rect x="27" y="48" width="110" height="3" rx="1.5" fill="#cbd5e1"/><rect x="27" y="62" width="38" height="5" rx="1" fill="${color}"/><rect x="27" y="73" width="125" height="3" rx="1.5" fill="#94a3b8"/><rect x="27" y="81" width="118" height="3" rx="1.5" fill="#cbd5e1"/><rect x="27" y="91" width="100" height="3" rx="1.5" fill="#cbd5e1"/></svg>`;
}
