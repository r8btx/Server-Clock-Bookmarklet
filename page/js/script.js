/* ------------------------------
// Bookmarklet Generation Section
// ------------------------------*/

// Option for UglifyJS
let options = {
  compress: {
    expression: true,
    keep_fargs: true,
    keep_infinity: true,
  },
  wrap: false,
};

// URI encode reserved characters
function encodeReserved(str) {
  const reserved = [' ', '%', '"', '<', '>', '#', '@', '\\&', '\\?'];
  return str.replace(new RegExp(reserved.join('|'), 'g'), encodeURIComponent);
}

// Make JavaScript bookmarklet from a static source
function makeBookmarklet(src) {
  let sourceCode;
  let compressed;
  fetch(src)
    .then((response) => response.text())
    .then((text) => {
      sourceCode = text;
    });
  compressed = minify(sourceCode, options).code;
  compressed = compressed.replace(/\n\s+/gm, ''); // temporary fix
  bookmarklet = 'javascript:void function(){' + encodeReserved(compressed) + '}();';
  return bookmarklet;
}

/* ------------------------------
// Init Section
// ------------------------------*/

function init() {
  document.removeEventListener('DOMContentLoaded', init);
  let d_options = document.getElementById('options');
  let d_bookmarklets = document.getElementById('bookmarklets');
  let d_notes = document.getElementById('notes');
  const datasrc = location.href.replace(/page\/.*/, 'data.json');
  let groups = [];
  let index = 0;

  function loadData() {
    fetch(datasrc)
      .then((response) => response.json())
      .then((data) => {
        data['bookmarklets'].forEach((entry) => {
          let elms = [];
          let option = document.createElement('option');
          option.value = index;
          option.innerText = entry['name'];
          d_options.appendChild(option);
          elms.push(option);

          let bookmarklet = document.createElement('a');
          bookmarklet.href = entry['src'];
          bookmarklet.innerText = 'Building...';
          bookmarklet.classList.add('bookmarklet');
          bookmarklet.classList.add('hidden');
          d_bookmarklets.appendChild(bookmarklet);
          elms.push(bookmarklet);

          let note = document.createElement('div');
          note.innerHTML =
            entry['note'].replace(/\n/g, '<br/>') +
            '<br/><b>' +
            entry['instruction'] +
            '</b><br/><br/>Version: ' +
            entry['version'] +
            '<br/>Size: <span id=s' +
            index +
            '>0</span> characters';
          note.classList.add('note');
          note.classList.add('hidden');
          d_notes.appendChild(note);
          elms.push(note);
          groups.push(elms);
          index++;
        });
      });
    index--; // last index is notequal to length
  }

  function updateDropdown() {
    for (let i = 1; i < groups[index].length; i++) {
      groups[index][i].classList.add('hidden');
    }
    index = this.target.value;
    for (let i = 1; i < groups[index].length; i++) {
      groups[index][i].classList.remove('hidden');
    }
  }

  function removeDummy() {
    while (document.getElementsByClassName('dummy').length) {
      document.getElementsByClassName('dummy')[0].remove();
    }
  }

  function attachBookmarklet() {
    let bookmarklets = document.getElementsByClassName('bookmarklet');
    for (let i = 0; i < bookmarklets.length; i++) {
      // Update href to bookmarklet
      const src = bookmarklets[i].href;
      bookmarklets[i].href = makeBookmarklet(src);
      bookmarklets[i].innerHTML = '<b>Server Clock</b>';
      // Update size
      const id = 's' + String(i);
      document.getElementById(id).innerText = String(bookmarklets[i].href.length);
    }
  }

  d_options.addEventListener('change', updateDropdown);

  loadData();
  removeDummy();
  updateDropdown();
  attachBookmarklet();
}

document.addEventListener('DOMContentLoaded', init);
