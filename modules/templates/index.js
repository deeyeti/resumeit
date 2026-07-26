import classic from './classic.js';
import modern from './modern.js';
import minimal from './minimal.js';
import compact from './compact.js';
import executive from './executive.js';
import technical from './technical.js';

export { COLOR_THEMES, FONT_PAIRINGS, SAMPLE_RESUME, normalizeTemplateOptions } from './shared.js';

export const TEMPLATES = [classic, modern, minimal, compact, executive, technical];

export function getTemplate(templateId = 'modern') {
  return TEMPLATES.find(template => template.id === templateId) || modern;
}
