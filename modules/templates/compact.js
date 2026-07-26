import { createThumbnail, getTemplateCSS, getTemplateHTML } from './shared.js';

export default {
  id: 'compact', name: 'Compact', description: 'Dense two-column layout for broader skill sets.', bestFor: 'Technical roles with many qualifications', atsCaution: true,
  getCSS: options => getTemplateCSS(options, 'compact'), getHTML: (data, options) => getTemplateHTML(data, options, 'compact'),
  thumbnail: createThumbnail('Compact', '#0d9488'),
};
