(function(){
  const nameEl = document.getElementById('name');
  const metaEl = document.getElementById('meta');
  const iconImg = document.getElementById('iconImg');
  const miniImg = document.getElementById('miniImg');
  const miniLbl = document.getElementById('miniLbl');

  function setIcon(url){
    const u = (url || '').trim();
    if(!u){
      iconImg.style.display = 'none';
      miniImg.style.display = 'none';
      return;
    }
    // If they pass a relative asset path, keep it.
    iconImg.src = u;
    miniImg.src = u;
    iconImg.style.display = '';
    miniImg.style.display = '';
  }

  window.addEventListener('message', (ev) => {
    const d = ev.data;
    if(!d || d.type !== 'HBCR_CMS_PREVIEW') return;

    const sheet = d.sheet || '';
    const id = d.id || '';
    const name = (d.name || '').trim() || id || '—';

    nameEl.textContent = name;
    metaEl.textContent = `${sheet}${id ? ' · ' + id : ''}`;
    miniLbl.textContent = name;
    setIcon(d.icon);
  });
})();
