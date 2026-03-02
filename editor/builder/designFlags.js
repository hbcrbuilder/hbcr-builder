window.__HBCR_DESIGN__ = true;
window.__HBCR_DESIGN_KIND__ = "slots";


// CMS Full Builder Preview: receive draft overrides and persist to localStorage for liveData.js to apply on reload
window.addEventListener('message', (ev) => {
  try {
    const d = ev && ev.data;
    if(!d || typeof d !== 'object') return;
    if(d.type === 'HBCR_CMS_OVERRIDES' && d.draft){
      localStorage.setItem('hbcr_cms_draft_v1', JSON.stringify(d.draft));
      const params = new URLSearchParams(window.location.search || '');
      if(params.get('cmsPreview') === '1'){
        if(!window.__HBCR_CMS_RELOADING__){
          window.__HBCR_CMS_RELOADING__ = true;
          setTimeout(()=>location.reload(), 60);
        }
      }
    }
  } catch {}
});
