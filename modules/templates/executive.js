import { createThumbnail, getTemplateCSS, getTemplateHTML } from './shared.js';

export default {
  id: 'executive', name: 'Executive', description: 'Confident header band with leadership presence.', bestFor: 'Lead, staff, and management roles',
  getCSS: options => getTemplateCSS(options, 'executive'), getHTML: (data, options) => getTemplateHTML(data, options, 'executive'),
  thumbnail: createThumbnail('Executive', '#e11d48'),
};
