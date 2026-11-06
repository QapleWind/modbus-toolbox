'use strict';
(() => {
  if (!window.desktop || window.desktop.kind !== 'electron') return;
  document.documentElement.classList.add('desktop-app');
  window.desktop.onNavigate(route => {
    if (['rtu','tcp','debug','rawserial','ascii','converter','text','compare','bases','address','bits','checker'].includes(route)) location.hash = '#/' + route;
  });

})();
