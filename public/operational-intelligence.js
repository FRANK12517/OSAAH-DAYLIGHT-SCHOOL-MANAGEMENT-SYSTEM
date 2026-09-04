function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function label(value) { return value.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase()); }
export async function mount(workspace) {
  const section = element('section', 'hero operational-intelligence'); section.id = 'osaah-operational-intelligence'; section.hidden = true;
  section.append(element('p', 'eyebrow', 'VERIFIED OPERATIONAL STATUS'), element('h3', '', 'Operational Intelligence'));
  workspace.prepend(section);
  try {
    const response = await fetch('/api/ai/operational-status'); const result = await response.json();
    if (!response.ok) throw new Error('Operational intelligence unavailable');
    if (!result.cards.length) return section.remove();
    const grid = element('div', 'operational-cards');
    for (const card of result.cards) { const panel = element('article', 'operational-card'); panel.append(element('h4', '', card.moduleId.replaceAll('-', ' ')), element('p', 'muted', `Data quality: ${card.dataQuality.status}`)); for (const [name, value] of Object.entries(card.metrics)) panel.append(element('div', 'operational-metric', `${label(name)}: ${value ?? 'Not configured'}`)); if (card.warnings.length) panel.append(element('p', 'people-warning', card.warnings.join(' '))); grid.append(panel); }
    section.append(grid, element('p', 'muted', result.explanation ?? 'AI explanation is unavailable; verified operational metrics remain visible.')); section.hidden = false;
  } catch { section.append(element('p', 'people-warning', 'Operational intelligence is temporarily unavailable.')); section.hidden = false; }
}
