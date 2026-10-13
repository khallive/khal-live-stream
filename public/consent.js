(function(){
  // consent.js — shows a simple consent banner and loads AdSense only after acceptance
  const ADS_CLIENT = 'ca-pub-9211419038317507';
  const ADS_SRC = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADS_CLIENT}`;

  function setCookie(name, value, days) {
    let expires = '';
    if (days) {
      const d = new Date();
      d.setTime(d.getTime() + (days*24*60*60*1000));
      expires = '; expires=' + d.toUTCString();
    }
    document.cookie = name + '=' + (value || '') + expires + '; path=/; SameSite=Lax';
  }

  function getCookie(name) {
    const nameEQ = name + '=';
    const ca = document.cookie.split(';');
    for(let i=0;i<ca.length;i++){
      let c = ca[i];
      while (c.charAt(0)==' ') c = c.substring(1,c.length);
      if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length,c.length);
    }
    return null;
  }

  function loadAdsScript(cb) {
    if (window.adsbygoogle) { cb(); return; }
    const s = document.createElement('script');
    s.async = true;
    s.src = ADS_SRC;
    s.crossOrigin = 'anonymous';
    s.onload = cb;
    s.onerror = function(){ console.warn('Failed to load adsbygoogle'); cb(); };
    document.head.appendChild(s);
  }

  function pushAds() {
    // only run on non-localhost
    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (isLocal) return;

    loadAdsScript(function(){
      try {
        (adsbygoogle = window.adsbygoogle || []).push({});
      } catch(e){ console.warn('ads push failed', e); }
    });
  }

  function showBanner() {
    const banner = document.getElementById('consent-banner');
    if (!banner) return;
    banner.classList.remove('hidden');
    document.getElementById('consent-accept').addEventListener('click', function(){
      setCookie('ads_consent', 'granted', 365);
      banner.classList.add('hidden');
      pushAds();
    });

    document.getElementById('consent-decline').addEventListener('click', function(){
      setCookie('ads_consent', 'denied', 365);
      banner.classList.add('hidden');
    });
  }

  // init
  const consent = getCookie('ads_consent');
  if (consent === 'granted') {
    pushAds();
  } else if (consent === 'denied') {
    // do nothing
  } else {
    // show banner
    document.addEventListener('DOMContentLoaded', showBanner);
  }
})();
