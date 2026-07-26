import { createThumbnail, getTemplateCSS, getTemplateHTML } from './shared.js';

export default {
  id: 'classic', name: 'Classic', description: 'Traditional, polished, and conservative.', bestFor: 'Enterprise and finance-adjacent roles',
  getCSS: options => getTemplateCSS(options, 'classic'), getHTML: (data, options) => getTemplateHTML(data, options, 'classic'),
  thumbnail: createThumbnail('Classic', '#475569'),
};
