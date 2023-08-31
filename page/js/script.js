function encodeReserved(str) {
  const reserved = [' ', '%', '"', '<', '>', '#', '@', '\\&', '\\?'];
  return str.replace(new RegExp(reserved.join('|'), 'g'), encodeURIComponent);
}

function encodeMarkdown(markdown) {
  const headers = Array.from({ length: 6 }, (_, i) => `<h${i + 1}>$1</h${i + 1}>\n`);
  markdown = markdown.replace(/#{1,6} (.*?)(\n|$)/g, (_, match) => headers[match.length - 1]);

  const emphasis = ['strong', 'em'];
  markdown = markdown.replace(
    /\*\*(.*?)\*\*|__(.*?)__/g,
    (_, match1, match2, index) => `<${emphasis[index]}>${match1 || match2}</${emphasis[index]}>`,
  );

  markdown = markdown.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  markdown = markdown.replace(/`([^`]+)`/g, '<code>$1</code>');

  markdown = markdown.replace(/\n\* (.*?)(\n|$)/g, '\n<ul>\n<li>$1</li>\n</ul>');
  markdown = markdown.replace(/\n\d+\. (.*?)(\n|$)/g, '\n<ol>\n<li>$1</li>\n</ol>');

  markdown = markdown.replace(/\n/g, '<br>');

  return markdown;
}

function copyOnClick(event) {
  event.preventDefault();
  const copyText = document.createElement('textarea');
  copyText.value = event.target.href;
  copyText.style.display = 'hidden';
  document.body.appendChild(copyText);
  copyText.select();
  copyText.setSelectionRange(0, 99999);

  try {
    navigator.clipboard.writeText(copyText.value);
    prompt(
      'Code copied to clipboard!\nYou can now create a bookmarklet by following these steps:\n1. Create a regular bookmark in your browser.\n2. In the URL section, paste the copied code.\n3. Done!\n\nCode in case your browser blocks automatic copying:',
      copyText.value,
    );
  } catch (error) {
    console.error('Unable to copy code to clipboard:', error);
  }
  copyText.remove();
}

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
        bookmarklet.className = 'bookmarklet hidden';
        d_bookmarklets.appendChild(bookmarklet);

        const note = document.createElement('div');
        note.innerHTML = `${encodeMarkdown(entry.note)}<br/><b>${encodeMarkdown(
          entry.instruction,
        )}</b><br/><br/>Version: ${entry.version}<br/>Size: <span id="s${groups.length}">0</span> characters`;
        note.className = 'note hidden';
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
    for (const group of groups) {
      const isVisible = group === groups[selectedIndex];
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

  function attachBookmarklet() {
    const bookmarklets = document.getElementsByClassName('bookmarklet');
    const options = {
      compress: { toplevel: true, expression: true, passes: 2 },
      mangle: { toplevel: true },
      wrap: false,
    };

    Array.from(bookmarklets).forEach(async (bookmarklet, i) => {
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
        const compressed = result.code.replace(/\n\s+/gm, '');
        const encoded = encodeReserved(compressed);
        const bookmarkletCode = `javascript:void function(){${encoded}}();`;
        bookmarklet.href = bookmarkletCode;
        bookmarklet.innerHTML = 'Server Clock';
        bookmarklet.addEventListener('click', copyOnClick);

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
