import { createThumbnail, getTemplateCSS, getTemplateHTML } from './shared.js';

export default {
  id: 'technical', name: 'Technical', description: 'Developer-forward details with a precise grid.', bestFor: 'Engineering and open-source roles',
  getCSS: options => getTemplateCSS(options, 'technical'), getHTML: (data, options) => getTemplateHTML(data, options, 'technical'),
  thumbnail: createThumbnail('Technical', '#d97706'),
};
