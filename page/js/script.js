/* ------------------------------
// Bookmarklet Generation Section
// ------------------------------*/

// Option for UglifyJS

// URI encode reserved characters
function encodeReserved(str) {
  const reserved = [' ', '%', '"', '<', '>', '#', '@', '\\&', '\\?'];
  return str.replace(new RegExp(reserved.join('|'), 'g'), encodeURIComponent);
}

/* ------------------------------
// Init Section
// ------------------------------*/

function init() {
  document.removeEventListener('DOMContentLoaded', init);
  let d_options = document.getElementById('options');
  let d_bookmarklets = document.getElementById('bookmarklets');
  let d_notes = document.getElementById('notes');
  const datasrc = location.href.replace(/page\/.*/, 'page/data.json');
  let groups = [];
  let index = 0;

  async function loadData() {
    return fetch(datasrc)
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
            String(index) +
            '>0</span> characters';
          note.classList.add('note');
          note.classList.add('hidden');
          d_notes.appendChild(note);
          elms.push(note);
          groups.push(elms);
          index++;
        });
        return true;
      })
      .catch((error) => {
        console.error('Fetch Error:', error);
        return false;
      });
  }

  function updateDropdown() {
    for (let i = 0; i < groups.length; i++) {
      if (Math.max(0, d_options.value) == i) {
        for (let j = 1; j < groups[i].length; j++) {
          groups[i][j].classList.remove('hidden');
        }
      } else {
        for (let j = 1; j < groups[i].length; j++) {
          groups[i][j].classList.add('hidden');
        }
      }
    }
  }

  function removeDummy() {
    while (document.getElementsByClassName('dummy').length) {
      document.getElementsByClassName('dummy')[0].remove();
    }
  }

  // Make JavaScript bookmarklet from a static source
  function attachBookmarklet(src) {
    let bookmarklets = document.getElementsByClassName('bookmarklet');
    let options = {
      compress: {
        expression: true,
        keep_fargs: true,
        keep_infinity: true,
      },
      wrap: false,
    };

    for (let i = 0; i < bookmarklets.length; i++) {
      // Update href to bookmarklet
      const src = bookmarklets[i].href;
      fetch(src)
        .then((response) => response.text())
        .then((sourceCode) => {
          let result = minify(sourceCode, options);
          if (result.error) {
            throw result.error;
          }
          if (!result.code) {
            throw 'UglyJS returned an empty string';
          }
          return result.code;
        })
        .then((compressed) => {
          return compressed.replace(/\n\s+/gm, ''); // temporary fix
        })
        .then((compressed) => {
          return encodeReserved(compressed);
        })
        .then((encoded) => {
          // Finalize bookmarklet generation
          let bookmarklet = 'javascript:void function(){' + encoded + '}();';
          bookmarklets[i].href = bookmarklet;
          bookmarklets[i].innerHTML = '<b>Server Clock</b>';

          // Update size
          const id = 's' + String(i);
          document.getElementById(id).innerText = String(bookmarklets[i].href.length);
        })
        .catch((error) => {
          console.error('Error:', error);
          return '#';
        });
    }
  }

  d_options.addEventListener('change', updateDropdown);

  loadData().then(() => {
    removeDummy();
    updateDropdown();
    attachBookmarklet();
  });
}

document.addEventListener('DOMContentLoaded', init);
