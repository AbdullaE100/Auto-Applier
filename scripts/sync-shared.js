/* Copies code shared between the extension and the web app. Run: npm run sync */
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const copies = [
  ['extension/shared/countries.js', 'web/shared/countries.js'],
  ['extension/shared/questions.js', 'web/shared/questions.js'],
  ['extension/shared/settings.js', 'web/shared/settings.js'],
  ['extension/shared/icons.js', 'web/shared/icons.js'],
  ['extension/shared/ui.css', 'web/assets/ui.css'],
  ['extension/lib/supabase.js', 'web/vendor/supabase.js'],
  ['extension/icons/icon128.png', 'web/assets/icon128.png'],
  ['extension/icons/icon48.png', 'web/assets/favicon.png']
];
for (const [from, to] of copies) {
  fs.mkdirSync(path.dirname(path.join(root, to)), { recursive: true });
  fs.copyFileSync(path.join(root, from), path.join(root, to));
}
console.log(`Synced ${copies.length} shared files into web/`);
