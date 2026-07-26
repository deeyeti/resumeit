import { createThumbnail, getTemplateCSS, getTemplateHTML } from './shared.js';

export default {
  id: 'modern', name: 'Modern', description: 'Bold hierarchy with an accent-led layout.', bestFor: 'Tech startups and product teams',
  getCSS: options => getTemplateCSS(options, 'modern'), getHTML: (data, options) => getTemplateHTML(data, options, 'modern'),
  thumbnail: createThumbnail('Modern', '#4f46e5'),
};
