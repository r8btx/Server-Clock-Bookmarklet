const scb_version = '0.2';
const header = '[Server Clock]\n';
const prefix = 'https://r8btx.github.io/Server-Clock-Bookmarklet/';
const launch = `${prefix}js/serverClock.js`;
const secpol = 'securitypolicyviolation';
const startmsg = `Launcher started. [Ver. ${scb_version}]`;

console.log(startmsg);

function blocked(e) {
  if (e.blockedURI === launch) {
    document.removeEventListener(secpol, blocked);
    if (confirm(`${header}This webpage prohibits loading a remote script.\nDo you wish to try a non-launcher version?`))
      window.open(`${prefix}page/`, '_blank');
  }
}

document.addEventListener(secpol, blocked);

const script = document.createElement('script');
script.src = launch;
document.body.appendChild(script);
alert(header + startmsg);
