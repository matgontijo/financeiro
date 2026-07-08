/* Ícones de linha (SVG inline, 24×24, traço) — visual profissional sem emojis.
   Uso: icon('nome') ou icon('nome', 20, 'classe-extra')                       */
'use strict';
(function () {
  const P = {
    grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>',
    list: '<line x1="9" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="9" y1="18" x2="21" y2="18"/><circle cx="4.5" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1" fill="currentColor" stroke="none"/>',
    'check-circle': '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5.5"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="9.5" x2="21" y2="9.5"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/>',
    landmark: '<path d="M3 9.5L12 4l9 5.5"/><line x1="5" y1="20" x2="19" y2="20"/><line x1="7" y1="12" x2="7" y2="17"/><line x1="12" y1="12" x2="12" y2="17"/><line x1="17" y1="12" x2="17" y2="17"/>',
    tag: '<path d="M4 4h7l9 9-7 7-9-9z"/><circle cx="8.5" cy="8.5" r="1.3"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
    repeat: '<path d="M17 2.5l3.5 3.5L17 9.5"/><path d="M3.5 12V10a4 4 0 014-4h13"/><path d="M7 21.5L3.5 18 7 14.5"/><path d="M20.5 12v2a4 4 0 01-4 4h-13"/>',
    flag: '<line x1="5" y1="21" x2="5" y2="3.5"/><path d="M5 4.5h13l-2.5 4 2.5 4H5"/>',
    'bar-chart': '<line x1="7" y1="19" x2="7" y2="12"/><line x1="12" y1="19" x2="12" y2="5"/><line x1="17" y1="19" x2="17" y2="9"/><line x1="3.5" y1="19" x2="20.5" y2="19"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    search: '<circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/>',
    sun: '<circle cx="12" cy="12" r="4"/><line x1="12" y1="2.5" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="21.5"/><line x1="2.5" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="21.5" y2="12"/><line x1="5.3" y1="5.3" x2="7" y2="7"/><line x1="17" y1="17" x2="18.7" y2="18.7"/><line x1="5.3" y1="18.7" x2="7" y2="17"/><line x1="17" y1="7" x2="18.7" y2="5.3"/>',
    moon: '<path d="M20 13.5A8.5 8.5 0 0110.5 4 8.5 8.5 0 1020 13.5z"/>',
    smartphone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><line x1="10.5" y1="18.5" x2="13.5" y2="18.5"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 018 0v3"/>',
    edit: '<path d="M4 20h4l11-11a2.1 2.1 0 00-3-3L5 17z"/><line x1="13.5" y1="7.5" x2="16.5" y2="10.5"/>',
    trash: '<path d="M4.5 7h15"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l1 13h9l1-13"/><line x1="10.5" y1="11" x2="10.5" y2="16.5"/><line x1="13.5" y1="11" x2="13.5" y2="16.5"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>',
    paperclip: '<path d="M20 11.5l-8 8a5 5 0 01-7-7l9-9a3.4 3.4 0 014.8 4.8l-9 9a1.8 1.8 0 01-2.6-2.6l8-8"/>',
    x: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
    'chevron-left': '<polyline points="14.5 5.5 8 12 14.5 18.5"/>',
    'chevron-right': '<polyline points="9.5 5.5 16 12 9.5 18.5"/>',
    'arrow-in': '<path d="M19 5L5 19"/><polyline points="15.5 19 5 19 5 8.5"/>',
    'arrow-out': '<path d="M5 19L19 5"/><polyline points="8.5 5 19 5 19 15.5"/>',
    swap: '<path d="M16 3.5l4 4-4 4"/><line x1="20" y1="7.5" x2="4" y2="7.5"/><path d="M8 12.5l-4 4 4 4"/><line x1="4" y1="16.5" x2="20" y2="16.5"/>',
    wallet: '<rect x="3" y="6.5" width="18" height="13" rx="2.5"/><path d="M16 12.5h5"/><circle cx="16.5" cy="13" r="0.8" fill="currentColor" stroke="none"/><path d="M6 6.5L15.5 3l1 3.5"/>',
    'credit-card': '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><line x1="2.5" y1="10" x2="21.5" y2="10"/><line x1="6" y1="15" x2="10" y2="15"/>',
    coins: '<ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7"/><path d="M3 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/><path d="M18 9.5c1.8.4 3 1.3 3 2.5v5c0 1.4-1.8 2.6-4 2.9"/>',
    'trending-up': '<polyline points="3 17 9.5 10.5 13.5 14.5 21 7"/><polyline points="15.5 7 21 7 21 12.5"/>',
    'alert-triangle': '<path d="M12 3.5L22 20H2z"/><line x1="12" y1="10" x2="12" y2="14"/><circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none"/>',
    info: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16.5"/><circle cx="12" cy="7.8" r="0.9" fill="currentColor" stroke="none"/>',
    check: '<polyline points="5 12.5 10 17.5 19 7"/>',
    download: '<path d="M12 4v11"/><polyline points="7 11 12 16 17 11"/><path d="M4.5 20h15"/>',
    upload: '<path d="M12 15V4"/><polyline points="7 9 12 4 17 9"/><path d="M4.5 20h15"/>',
    restore: '<path d="M3.5 12a8.5 8.5 0 108.5-8.5A8.6 8.6 0 004.5 8"/><polyline points="4.5 3.5 4.5 8 9 8"/>',
    'more-horizontal': '<circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
    'file-text': '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><polyline points="14 3 14 8 19 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    activity: '<polyline points="22 12 18 12 15 20.5 9 3.5 6 12 2 12"/>',
    'chart-line': '<path d="M3.5 4v16h17"/><path d="M7 14.5l4-4.5 3 3 5.5-6.5"/>',
    scale: '<line x1="12" y1="3.5" x2="12" y2="20.5"/><path d="M7 20.5h10"/><path d="M4 7h16"/><path d="M6 7l-2.5 5.5a2.6 2.6 0 005 0z"/><path d="M18 7l-2.5 5.5a2.6 2.6 0 005 0z"/>',
    trophy: '<path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v6a5 5 0 01-10 0z"/><path d="M7 6H4.5a2.5 2.5 0 002.5 4"/><path d="M17 6h2.5a2.5 2.5 0 01-2.5 4"/>',
    circle: '<circle cx="12" cy="12" r="9"/>',
  };
  window.icon = function (name, size = 18, cls = '') {
    return `<svg class="ic${cls ? ' ' + cls : ''}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.circle}</svg>`;
  };
})();
