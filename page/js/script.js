// URI encode reserved characters
function encodeReserved(str) {
  const reserved = [' ', '%', '"', '<', '>', '#', '@', '\\&', '\\?'];
  return str.replace(new RegExp(reserved.join('|'), 'g'), encodeURIComponent);
}

// Markdown format to html format
function encodeMarkdown(markdown) {
  // headers (e.g. # Header1)
  markdown = markdown.replace(/###### (.*?)(\n|$)/g, '<h6>$1</h6>\n');
  markdown = markdown.replace(/##### (.*?)(\n|$)/g, '<h5>$1</h5>\n');
  markdown = markdown.replace(/#### (.*?)(\n|$)/g, '<h4>$1</h4>\n');
  markdown = markdown.replace(/### (.*?)(\n|$)/g, '<h3>$1</h3>\n');
  markdown = markdown.replace(/## (.*?)(\n|$)/g, '<h2>$1</h2>\n');
  markdown = markdown.replace(/# (.*?)(\n|$)/g, '<h1>$1</h1>\n');

  // bold and italic emphasis (e.g. **bold** or _italic_)
  markdown = markdown.replace(/\*\*(.*?)\*\*|__(.*?)__/g, '<strong>$1$2</strong>');
  markdown = markdown.replace(/\*(.*?)\*|_(.*?)_/g, '<em>$1$2</em>');

  // code blocks (e.g. ```code```)
  markdown = markdown.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');

  // inline code (e.g. `code`)
  markdown = markdown.replace(/`([^`]+)`/g, '<code>$1</code>');

  // unordered lists (e.g. * Item)
  markdown = markdown.replace(/\n\* (.*?)(\n|$)/g, '\n<ul>\n<li>$1</li>\n</ul>');

  // ordered lists (e.g. 1. Item)
  markdown = markdown.replace(/\n\d+\. (.*?)(\n|$)/g, '\n<ol>\n<li>$1</li>\n</ol>');

  // line breaks
  markdown = markdown.replace(/\n/g, '<br>');

  return markdown;
}

// Copy on click instead of run (<a> tag only)
function copyOnClick(event) {
  event.preventDefault();
  const copyText = document.createElement('textarea');
  copyText.value = event.target.href;
  copyText.style.display = 'hidden';
  document.body.appendChild(copyText);
  copyText.select();
  copyText.setSelectionRange(0, 99999); // For mobile devices

  try {
    navigator.clipboard.writeText(copyText.value);
    prompt(
      'Code copied to clipboard!\n' +
        'You can now create a bookmarklet by following these steps:\n' +
        '1. Create a regular bookmark in your browser.\n' +
        '2. In the URL section, paste the copied code.\n' +
        '3. Done!\n\n' +
        'Code in case your browser blocks automatic copying:',
      copyText.value,
    );
  } catch (error) {
    console.error('Unable to copy code to clipboard:', error);
  }
  copyText.remove();
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
        note.innerHTML = `${encodeMarkdown(entry.note)}<br/><b>${encodeMarkdown(
          entry.instruction,
        )}</b><br/><br/>Version: ${entry.version}<br/>Size: <span id="s${groups.length}">0</span> characters`;
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
        toplevel: true,
        expression: true,
        passes: 2,
      },
      mangle: { toplevel: true },
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
        bookmarklet.innerHTML = 'Server Clock';
        bookmarklet.addEventListener('click', copyOnClick); // Copy code on click

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
