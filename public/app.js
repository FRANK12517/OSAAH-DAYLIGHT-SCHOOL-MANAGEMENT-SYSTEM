const nav = document.querySelector('#sidebar-nav');
document.querySelector('.menu-button').addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('open'));
async function loadFoundation() { const [branding, sidebar] = await Promise.all([fetch('/api/branding').then((r) => r.json()), fetch('/api/sidebar').then((r) => r.json())]); document.querySelector('#school-name').textContent = branding.schoolName; document.querySelector('#motto').textContent = branding.motto; nav.innerHTML = sidebar.categories.map((group) => `<h4>${group.category}</h4>${group.modules.map((module) => `<a href="${module.route}">${module.icon} ${module.moduleName}</a>`).join('')}`).join(''); }
loadFoundation();
