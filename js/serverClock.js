const scb_version = '1.0';
let adjustment; // The chosen estimation
let adjustments = []; // A pool of clock adjustments (client/server time difference)
let repeated = 0;
let best_at_hand;

const min_repeat = 6;
const max_repeat = 25;
const timeout_time = 5000; // In msec. Will retry request after this time
const tolerance_err = 125;
const tolerance_outlier = 200;

const getName = (seed, offset) => `e${(seed + offset).toString(16)}`;

const name_seed = Math.floor(Math.random() * (2 << 25));
const d_clock = getName(name_seed, 0);
const d_time = getName(name_seed, 1);
const d_msg = getName(name_seed, 2);
const d_menu = getName(name_seed, 3);
const d_menuitem = getName(name_seed, 4);

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

const updateMessage = (msg) => {
  const e_msg = document.getElementById(d_msg);
  if (!e_msg) return;
  switch (msg) {
    case 0:
      e_msg.textContent = '';
      break;
    case 1:
      e_msg.textContent = 'SYNCHRONIZING...';
      e_msg.style.color = '#3cb371';
      break;
    case 2:
      e_msg.textContent = 'INACCURACY WARNING';
      e_msg.style.color = '#ffca28';
      break;
    case 3:
      e_msg.textContent = 'HTTP REQUEST ERROR';
      e_msg.style.color = '#ff5252';
      break;
  }
};

// Can be more accurate than using `Date`
const getTime = () => performance.timeOrigin + performance.now();

// Try to target end points (least & max truncation)
const getDelay = (elapsed, repeated) => {
  if (!best_at_hand) return 250;
  let delay = 0;
  let upper = 0;
  while (delay <= 0) {
    upper += 1000;
    delay = upper - elapsed - ((getTime() + best_at_hand) % 1000) - (repeated % 2) * 100;
  }
  return delay;
};

// Determine if the collected sample size is sufficient to accurately estimate the server clock
const isSampleSufficient = () => {
  if (repeated < min_repeat) return false;
  if (repeated >= max_repeat) {
    console.warn('Inaccuracy Warning: Maximum repeat reached.');
    updateMessage(2);
    return true;
  }

  // Find smallest, second smallest, largest, and second largest value
  adjustments = adjustments.sort((a, b) => b - a);
  const min = adjustments[adjustments.length - 1];
  const min2 = adjustments[adjustments.length - 2];
  const max = adjustments[0];
  const max2 = adjustments[1];

  // Current best guess of the time difference
  best_at_hand = max;

  // Return whether the maximum value and the minimum value is around 1 sec (max truncation difference)
  return 1000 - tolerance_err <= max - min && min2 - min < tolerance_outlier && max - max2 < tolerance_outlier;
};

// Choose one adjustment to apply
const chooseAdjustment = () => {
  const candidates = [];
  for (let i = 0; i < adjustments.length; i++) {
    for (let j = adjustments.length - 1; j >= 0; j--) {
      if (adjustments[i] - adjustments[j] < 1000) {
        candidates.push([j - i, i]);
        break;
      }
    }
  }
  candidates.sort((a, b) => b - a);
  adjustment = adjustments[candidates[0][1]];

  console.log('[Adjustments]');
  adjustments.forEach((element) => {
    console.log(element / 1000);
  });
  console.log('The chosen adjustment is', adjustment / 1000, 'sec.');
  updateMessage(0);
};

// Collect adjustments repeatedly using a recursive function
function run() {
  let servertime = 0;
  let elapsed = 0;
  let timeout;
  let replied;

  // Create a PerformanceObserver
  const observer = new PerformanceObserver((list) => {
    const entry = list.getEntries().find(({ name }) => name === url);
    if (entry) {
      // Time elapsed since the request was made
      elapsed = entry.requestStart - entry.startTime + (entry.responseStart - entry.requestStart) / 2;
    }

    if (servertime && elapsed) {
      clearTimeout(timeout);
      if (!replied) return;

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
  const clienttime = getTime();

  // Make a HTTP request
  fetch(request)
    .then((response) => {
      // Extract server date time from the response headers
      servertime = Date.parse(response.headers.get('date'));
      replied = true;

      // Fix incomplete response issue
      return response.text();
    })
    .catch((error) => {
      console.error(error);
      clearTimeout(timeout);
      updateMessage(3);
      replied = false;
    });

  // Setup a timeout timer
  // After some time, it will retry
  timeout = setTimeout(() => {
    console.log('Request timed out. Timeout:', timeout_time / 1000, 'sec.');
    observer.disconnect();
    run();
  }, timeout_time);
  updateMessage(1);
}

function displayClock() {
  let clockTime = getTime();
  let stop = false;
  let clock;

  const createClockElements = () => {
    // Create clock elements
    const frameElement = document.createElement('div');
    frameElement.id = d_clock;

    const timeElement = document.createElement('span');
    timeElement.textContent = '00:00:00 NA';
    timeElement.id = d_time;
    frameElement.appendChild(timeElement);

    const messageElement = document.createElement('span');
    messageElement.id = d_msg;
    frameElement.appendChild(messageElement);

    // Function to handle dragging
    const handleDrag = (event) => {
      let initialX = event.clientX - frameElement.offsetLeft;
      let initialY = event.clientY - frameElement.offsetTop;

      const handleMove = (event) => {
        const newX = event.clientX - initialX;
        const newY = event.clientY - initialY;

        const borderX = window.innerWidth - frameElement.offsetWidth;
        const borderY = window.innerHeight - frameElement.offsetHeight;

        const applyX = Math.max(0, Math.min(newX, borderX));
        const applyY = Math.max(0, Math.min(newY, borderY));

        frameElement.style.left = `${applyX}px`;
        frameElement.style.top = `${applyY}px`;
      };

      const handleRelease = () => {
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('mouseup', handleRelease);
      };

      document.addEventListener('mousemove', handleMove);
      document.addEventListener('mouseup', handleRelease);
    };

    // Attach event listener for dragging
    frameElement.addEventListener('mousedown', handleDrag);
    return [frameElement, timeElement, messageElement];
  };

  const attachContextMenu = (element, menuItems) => {
    // Prevent the default context menu from showing
    element.addEventListener('contextmenu', (event) => {
      event.preventDefault();

      // Reuse previous contextmenu if exists
      if (document.getElementById(d_menu)) {
        const menu = document.getElementById(d_menu);
        menu.style.top = `${event.clientY}px`;
        menu.style.left = `${event.clientX}px`;
        return;
      }

      // Create the context menu element
      const menu = document.createElement('div');
      menu.id = d_menu;
      menu.style.top = `${event.clientY}px`;
      menu.style.left = `${event.clientX}px`;

      // Create and append menu items
      for (const item of menuItems) {
        const menuItem = document.createElement('div');
        menuItem.textContent = item.label;
        menuItem.addEventListener('click', item.action);
        menuItem.classList.add(d_menuitem);
        menu.appendChild(menuItem);
      }

      // Close the menu
      const closeMenu = () => {
        document.body.removeChild(menu);
        document.removeEventListener('click', closeMenu);
      };

      // Attach the menu to the body
      document.body.appendChild(menu);

      // Close the menu on clicking outside
      document.addEventListener('click', closeMenu);
    });
  };

  // Append styles
  const styleSheet = document.createElement('style');
  const appendStyles = (styles) => {
    styleSheet.innerText = styles.replace(/\n/g, '').replace(/\s+/g, ' ');
    document.head.appendChild(styleSheet);
  };

  // Append the clock frame to the body
  const appendClockFrame = (clockFrame) => {
    document.body.appendChild(clockFrame);
  };

  // Contextmenu action rerun
  const action_rerun = () => {
    console.log('Resynchronizing...');
    adjustments.length = 0;
    repeated = 0;
    best_at_hand = 0;
    run();
  };

  // Contextmenu action visitproject
  const action_visitproject = () => {
    console.log('Opening the project page...');
    window.open('https://github.com/r8btx/Server-Clock-Bookmarklet/', '_blank');
  };

  // Contextmenu action exit
  const action_exit = () => {
    stop = true;
    document.body.removeChild(clockElements[0]);
    document.head.removeChild(styleSheet);
    if (document.currentScript) {
      document.body.removeChild(document.currentScript);
    }
    clearTimeout(clock);
    console.log('Server Clock finished.');
  };

  // Format time to string
  const formatTime = () => {
    const formatDigit = (d) => String(d).padStart(2, '0');
    const time = new Date(clockTime);
    const hours = formatDigit(time.getHours() % 12 || 12);
    const minutes = formatDigit(time.getMinutes());
    const seconds = formatDigit(time.getSeconds());
    const amPm = time.getHours() >= 12 ? 'PM' : 'AM';
    return `${hours}:${minutes}:${seconds} ${amPm}`;
  };

  // Update clock every beginning of a second
  const updateClock = () => {
    clockTime = getTime() + adjustment;
    clockElements[1].textContent = formatTime();
    clock = stop ? null : setTimeout(updateClock, 1000 - (clockTime % 1000));
  };

  const delayedRun = () => {
    const interval = setInterval(() => {
      if (isSampleSufficient()) {
        clearInterval(interval);
        updateClock();
      }
    }, 1000);
  };

  const clockElements = createClockElements();
  const menuItems = [
    { label: 'Rerun', action: action_rerun },
    { label: 'Visit project page', action: action_visitproject },
    { label: 'Exit', action: action_exit },
  ];

  attachContextMenu(clockElements[0], menuItems);
  appendStyles(`
  #${d_clock}:hover,
  #${d_menu} {
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
  }
  #${d_clock},
  #${d_menu} {
    cursor: pointer;
    user-select: none;
    display: flex;
    flex-direction: column;
    border-radius: 4px;
    font-family: Arial, sans-serif;
    position: fixed;
    left: 10px;
    background: #fff;
    color: #000;
    z-index: 9999;
  }
  #${d_clock} {
    top: 10px;
    padding: 12px;
    border: 1px solid #ddd;
    border-radius: 6px;
    align-items: center;
    transition: box-shadow 0.3s;
  }
  #${d_msg} {
    line-height: 0;
    font-size: 0.6rem;
    font-weight: 700;
  }
  #${d_time} {
    font-size: 1.25rem;
    line-height: 1.75;
  }
  #${d_menu} {
    padding: 6px 0;
  }
  .${d_menuitem} {
    font-family: Arial, sans-serif;
    font-size: 1.125rem;
    line-height: 1.75rem;
    padding: 6px 12px;
    cursor: pointer;
    transition: background-color 0.3s;
  }
  .${d_menuitem}:hover {
    background-color: #3cb371;
    color: #fff;
  }`);
  appendClockFrame(clockElements[0]);
  delayedRun();
}

// Start
console.log(`Server Clock started. [Version ${scb_version}]`);
run();
displayClock();
