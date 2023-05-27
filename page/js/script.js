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
  const d_options = document.getElementById('options');
  const d_bookmarklets = document.getElementById('bookmarklets');
  const d_notes = document.getElementById('notes');
  const datasrc = location.href.replace(/page\/.*/, 'page/data.json');
  const groups = [];

  async function loadData() {
    try {
      const response = await fetch(datasrc);
      const data = await response.json();
      for (const entry of data.bookmarklets) {
        const option = document.createElement('option');
        option.value = groups.length;
        option.innerText = entry.name;
        d_options.appendChild(option);

        const bookmarklet = document.createElement('a');
        bookmarklet.href = entry.src;
        bookmarklet.innerText = 'Building...';
        bookmarklet.classList.add('bookmarklet');
        bookmarklet.classList.add('hidden');
        d_bookmarklets.appendChild(bookmarklet);

        const note = document.createElement('div');
        note.innerHTML = `${entry.note.replace(/\n/g, '<br/>')}<br/><b>${entry.instruction}</b><br/><br/>Version: ${
          entry.version
        }<br/>Size: <span id="s${groups.length}">0</span> characters`;
        note.classList.add('note');
        note.classList.add('hidden');
        d_notes.appendChild(note);

        groups.push([option, bookmarklet, note]);
      }

      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  function updateDropdown() {
    const selectedIndex = Math.max(0, d_options.selectedIndex);
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const isVisible = i === selectedIndex;
      for (let j = 1; j < group.length; j++) {
        group[j].classList.toggle('hidden', !isVisible);
      }
    }
  }

  function removeDummy() {
    const dummies = document.getElementsByClassName('dummy');
    while (dummies.length) {
      dummies[0].remove();
    }
  }

  // Make JavaScript bookmarklet from a static source
  function attachBookmarklet() {
    const bookmarklets = document.getElementsByClassName('bookmarklet');

    // Option for UglifyJS
    const options = {
      compress: {
        expression: true,
        keep_fargs: true,
        keep_infinity: true,
      },
      wrap: false,
    };

    Array.from(bookmarklets).forEach(async (bookmarklet, i) => {
      // Update href to bookmarklet
      const src = bookmarklet.href;
      try {
        const response = await fetch(src);
        const sourceCode = await response.text();
        const result = minify(sourceCode, options);
        if (result.error) {
          throw result.error;
        }
        if (!result.code) {
          throw 'UglyJS returned an empty string';
        }
        const compressed = result.code.replace(/\n\s+/gm, ''); // temporary fix
        const encoded = encodeReserved(compressed);
        const bookmarkletCode = `javascript:void function(){${encoded}}();`; // Finalize bookmarklet generation
        bookmarklet.href = bookmarkletCode;
        bookmarklet.innerHTML = '<b>Server Clock</b>';

        // Update size
        const id = `s${i}`;
        document.getElementById(id).innerText = String(bookmarklet.href.length);
      } catch (error) {
        console.error(error);
        bookmarklet.href = '#';
      }
    });
  }

  d_options.addEventListener('change', updateDropdown);

  loadData().then(() => {
    removeDummy();
    updateDropdown();
    attachBookmarklet();
  });
}

document.addEventListener('DOMContentLoaded', init);
