const fs = require('fs');
const file = 'companion-extension/popup.js';
let code = fs.readFileSync(file, 'utf8');

const targetIdx = code.indexOf('  var API =');
if (targetIdx !== -1) {
  const replacement = `  function openUrl(url) {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: url });
    } else {
      window.open(url, '_blank');
    }
  }

  document.getElementById('btn-open-meet').addEventListener('click', function () {
    openUrl('https://meet.google.com');
  });

  document.getElementById('btn-open-marketplace').addEventListener('click', function () {
    openUrl(
      'https://workspace.google.com/marketplace/app/attendance_tracker/829771833968?utm_source=cws_companion_extension'
    );
  });

  document.getElementById('btn-open-history').addEventListener('click', function () {
    openUrl('https://attendancetracker.dev/history.html?utm_source=cws_companion');
  });
})();
`;
  code = code.substring(0, targetIdx) + replacement;
  fs.writeFileSync(file, code, 'utf8');
  console.log('Successfully updated companion-extension/popup.js to zero-telemetry');
} else {
  console.log('Target not found');
}
