import { createThumbnail, getTemplateCSS, getTemplateHTML } from './shared.js';

export default {
  id: 'minimal', name: 'Minimal', description: 'Clean whitespace with quiet section labels.', bestFor: 'Design-minded and senior engineers',
  getCSS: options => getTemplateCSS(options, 'minimal'), getHTML: (data, options) => getTemplateHTML(data, options, 'minimal'),
  thumbnail: createThumbnail('Minimal', '#64748b'),
};
