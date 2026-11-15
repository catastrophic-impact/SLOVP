const tabsEl = document.getElementById('tabs');
let active = null;
function draw(list) {
  tabsEl.replaceChildren(...list.map((t) => {
    const b = document.createElement('button');
    b.className = 'tab' + (t.id === active ? ' active' : '');
    b.id = 'tab-' + t.id; b.textContent = t.title; b.setAttribute('role', 'tab');
    b.addEventListener('click', () => shell.switchTo(t.id));
    return b;
  }));
}
let list = [];
shell.state().then((s) => { list = s.tabs; active = s.active; draw(list); });
shell.onActive((n) => { active = n; draw(list); });
document.addEventListener('keydown', (e) => { if (e.ctrlKey && (e.key === '1' || e.key === '2')) shell.switchTo(list[Number(e.key) - 1]?.id); });
