(() => {
  let clock;
  let clockTime; // Final estimation
  let adjustment;
  let adjustments = []; // A pool of clock adjustments (client/server time difference)
  let best_at_hand;
  let repeated = 0;
  const min_repeat = 5;
  const max_repeat = 25;
  const timeout_time = 5000; // In msec. Will retry request after this time
  const tolerance_err = 125;
  const tolerance_outlier = 200;

  // Request current page
  const url = window.location.href;

  // Create a request object with no-cache headers
  // This prevents looking up 'date' header from cached responses
  const request = new Request(url, {
    method: 'GET',
    cache: 'no-store',
    headers: new Headers({
      Connection: 'keep-alive',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      Expires: '0',
    }),
  });

  function getTime() {
    return performance.timeOrigin + performance.now();
  }

  // Try to target end points (least & max truncation)
  function getDelay(elapsed, repeated) {
    if (!best_at_hand) return 250;
    let delay = 0;
    let upper = 0;
    while (delay <= 0) {
      upper += 1000;
      delay = upper - elapsed - ((getTime() + best_at_hand) % 1000) - (repeated % 2) * 100;
    }
    return delay;
  }

  // Determine if the collected sample size is sufficient to accurately estimate the server clock
  function isSampleSufficient() {
    if (repeated < min_repeat) {
      return false;
    }
    if (repeated >= max_repeat) {
      console.log('Maximum repeat reached.');
      return true;
    }
    let min = Infinity;
    let min2 = Infinity;
    let max = -Infinity;
    let max2 = -Infinity;

    // Find smallest, second smallest, largest, and second largest value
    for (let i = 0; i < adjustments.length; i++) {
      if (adjustments[i] < min) {
        min2 = min;
        min = adjustments[i];
      } else if (adjustments[i] < min2) {
        min2 = adjustments[i];
      }

      if (adjustments[i] > max) {
        max2 = max;
        max = adjustments[i];
      } else if (adjustments[i] > max2) {
        max2 = adjustments[i];
      }
    }

    // Current best guess of the time difference
    best_at_hand = max;

    // Return whether the maximum value and the minimum value is around 1 sec (max truncation difference)
    return 1000 - tolerance_err <= max - min && min2 - min < tolerance_outlier && max - max2 < tolerance_outlier;
  }

  // Choose one adjustment to apply
  // See the previous project for the justification of this method
  function chooseAdjustment() {
    let i = 0;
    let candidates = [];
    let candidate_done = false;

    adjustments.sort(function (a, b) {
      return b - a;
    });

    while (i < adjustments.length && !candidate_done) {
      for (let j = adjustments.length - 1; j >= 0; j--) {
        if (adjustments[i] - adjustments[j] < 1000) {
          if (j === adjustments.length - 1) {
            candidate_done = true;
          }
          let cc = j - i;
          candidates.push([cc, i]);
          break;
        }
      }
      i++;
    }
    candidates.sort(function (a, b) {
      return b - a;
    });
    adjustment = adjustments[candidates[0][1]];

    console.log('[Adjustments]');
    adjustments.forEach((element) => {
      console.log(element / 1000);
    });
    console.log('The chosen adjustment is', adjustment / 1000, 'sec.');
  }

  // Collect adjustments repeatedly using a recursive function
  function run() {
    let servertime = 0;
    let elapsed = 0;
    let timeout;

    // Create a PerformanceObserver
    const observer = new PerformanceObserver((list) => {
      list
        .getEntries()
        .filter(({ name }) => name === url)
        .forEach((e) => {
          // Time elapsed since the request was made
          elapsed = e.requestStart - e.startTime + (e.responseStart - e.requestStart) / 2;
        });

      if (servertime && elapsed) {
        // Clear the timeout
        clearTimeout(timeout);

        // Calculate client/server time difference based on HTTP `date` header
        // Accomodate estimated elapsed time (time taken before server recorded `date`)
        adjustments.push(servertime - (clienttime + elapsed));
        console.log('Collected an adjustment');
        repeated++;

        // Repeat the process using recursive function
        // When done, decide which adjustment to use
        if (!isSampleSufficient()) {
          setTimeout(run, getDelay(elapsed, repeated));
        } else {
          chooseAdjustment();
        }
      }
      observer.disconnect();
    });

    // Make it a resource observer
    observer.observe({ type: 'resource' });

    // Define client time. Will be used to calculate time difference.
    let clienttime = getTime();

    // Make a HTTP request
    fetch(request)
      .then((response) => {
        // Extract server date time from the response headers
        servertime = Date.parse(response.headers.get('date'));

        // This fixes incomplete response issue
        const r = response.text();
      })
      .catch((error) => {
        console.error('Fetch Error:', error);
      });

    // Setup a timeout timer
    // After some time, it will retry
    timeout = setTimeout(() => {
      console.log('Request timed out. Timeout:', timeout_time / 1000, 'sec.');
      observer.disconnect();
      run();
    }, timeout_time);
  }

  function displayClock() {
    // Generate names for styles
    let style_clock = Math.floor(Math.random() * (2 << 25)).toString(16);
    let style_menu = Math.floor(Math.random() * (2 << 25)).toString(16);
    let style_menuitem = Math.floor(Math.random() * (2 << 25)).toString(16);

    let styles = `
    #e${style_clock} { 
        user-select: none;
        z-index: 9998;
        position: fixed;
        top: 10px;
        left: 10px;
        background-color: #f2f2f2;
        border: 1px solid #ddd;
        border-radius: 6px;
        padding: 12px;
        cursor: pointer;
        transition: box-shadow 0.3s ease;
        font-family: Arial, sans-serif;
        font-size: 1.125rem;
        line-height: 1.75rem;
    }
    #e${style_clock}:hover {
        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
    }
    #e${style_menu} {
        user-select: none;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        position: fixed;
        background: #fff;
        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
        border-radius: 4px;
        padding: 6px 0;
        font-family: Arial, sans-serif;
        font-size: 1.125rem;
        line-height: 1.75rem;
    } 
    .e${style_menuitem} {
        display: block;
        padding: 6px 12px;
        cursor: pointer;
        transition: background-color 0.3s ease;
    }
    .e${style_menuitem}:hover {
        background-color: #3CB371;
        color: white;
    }`;

    const menuItems = [
      {
        label: 'Rerun',
        action: () => {
          console.log('Resynchronizing...');
          adjustments.length = 0;
          repeated = 0;
          best_at_hand = 0;
          run();
        },
      },
      {
        label: 'Visit project page',
        action: () => {
          console.log('Opening the project page...');
          window.open('https://github.com/r8btx/Server-Clock-Bookmarklet/', '_blank');
        },
      },
      {
        label: 'Exit',
        action: () => {
          clearTimeout(clock);
          document.body.removeChild(clockElement);
          console.log('UI removed.');
        },
      },
    ];

    // Create the clock element
    const clockElement = document.createElement('div');

    // Set properties
    clockElement.textContent = 'Synchronizing the clock...';
    clockElement.id = `e${style_clock}`;

    // Function to handle dragging
    function handleDrag(event) {
      let initialX = event.clientX - clockElement.offsetLeft;
      let initialY = event.clientY - clockElement.offsetTop;

      function handleMove(event) {
        const newX = event.clientX - initialX;
        const newY = event.clientY - initialY;

        const borderX = window.innerWidth - clockElement.offsetWidth;
        const borderY = window.innerHeight - clockElement.offsetHeight;

        const applyX = Math.max(0, Math.min(newX, borderX));
        const applyY = Math.max(0, Math.min(newY, borderY));

        clockElement.style.left = `${applyX}px`;
        clockElement.style.top = `${applyY}px`;
      }

      function handleRelease() {
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('mouseup', handleRelease);
      }

      document.addEventListener('mousemove', handleMove);
      document.addEventListener('mouseup', handleRelease);
    }

    // Attach event listener for dragging
    clockElement.addEventListener('mousedown', handleDrag);

    function attachContextMenu(element, menuItems) {
      // Prevent the default context menu from showing
      element.addEventListener('contextmenu', (event) => {
        event.preventDefault();

        // Remove previous contextmenu
        if (document.getElementById(`e${style_menu}`)) {
          const menu = document.getElementById(`e${style_menu}`);
          menu.style.top = `${event.clientY}px`;
          menu.style.left = `${event.clientX}px`;
          return;
        }

        // Create the context menu element
        const menu = document.createElement('div');
        menu.id = `e${style_menu}`;
        menu.style.top = `${event.clientY}px`;
        menu.style.left = `${event.clientX}px`;

        // Create and append menu items
        for (const item of menuItems) {
          const menuItem = document.createElement('div');
          menuItem.textContent = item.label;
          menuItem.addEventListener('click', item.action);
          menuItem.classList.add(`e${style_menuitem}`);
          menu.appendChild(menuItem);
        }

        // Close the menu on clicking outside
        const closeMenu = () => {
          document.body.removeChild(menu);
          document.removeEventListener('click', closeMenu);
        };

        // Attach the menu to the body
        document.body.appendChild(menu);

        // Close the menu when clicking outside
        document.addEventListener('click', closeMenu);
      });
    }

    // Attach contextmenu
    attachContextMenu(clockElement, menuItems);

    // Append styles
    let styleSheet = document.createElement('style');
    styleSheet.innerText = styles.replace(/\n/g, '').replace(/\s+/g, ' ');
    document.head.appendChild(styleSheet);

    // Append the clockElement to the body
    document.body.appendChild(clockElement);

    function formatTime() {
      const time = new Date(clockTime);
      let hours = time.getHours();
      let minutes = time.getMinutes();
      let seconds = time.getSeconds();
      const amPm = hours >= 12 ? 'PM' : 'AM';

      // Convert hours to 12-hour format
      hours = hours % 12;
      hours = hours ? hours : 12;

      // Pad numbers with leading zeros
      hours = String(hours).padStart(2, '0');
      minutes = String(minutes).padStart(2, '0');
      seconds = String(seconds).padStart(2, '0');

      return `${hours}:${minutes}:${seconds} ${amPm}`;
    }

    function updateClock() {
      // Update clock every beginning of a second
      clockTime = getTime() + adjustment;
      clockElement.textContent = formatTime();
      clock = setTimeout(updateClock, 1000 - (clockTime % 1000));
    }

    function delayedRun() {
      let delayedRun = setInterval(() => {
        if (isSampleSufficient()) {
          clearInterval(delayedRun);
          updateClock();
        }
      }, 1000);
    }

    delayedRun();
  }

  // Start
  console.log('Server Clock started.');
  run();
  displayClock();
})();
