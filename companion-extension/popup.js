(function () {
  'use strict';

  var API = 'https://attendance-tracker-backend-829771833968.us-central1.run.app/api';

  function logTelemetry(event) {
    try {
      var payload = {
        path: '/companion-extension/popup.html',
        event: event,
        source: 'cws_companion_extension',
        timestamp: Date.now()
      };
      var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(API + '/public/pageview', blob);
      } else {
        fetch(API + '/public/pageview', { method: 'POST', body: blob, keepalive: true }).catch(function () {});
      }
    } catch (e) {}
  }

  logTelemetry('companion_ext_opened');

  function openUrl(url, eventName) {
    logTelemetry(eventName);
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: url });
    } else {
      window.open(url, '_blank');
    }
  }

  document.getElementById('btn-open-meet').addEventListener('click', function () {
    openUrl('https://meet.google.com', 'companion_ext_launch_meet');
  });

  document.getElementById('btn-open-marketplace').addEventListener('click', function () {
    openUrl(
      'https://workspace.google.com/marketplace/app/attendance_tracker/829771833968?utm_source=cws_companion_extension',
      'companion_ext_install_marketplace'
    );
  });

  document.getElementById('btn-open-history').addEventListener('click', function () {
    openUrl('https://attendancetracker.dev/history.html?utm_source=cws_companion', 'cta_click');
  });
})();
