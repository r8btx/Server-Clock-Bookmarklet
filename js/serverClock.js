'use strict';

let ServerClock = {};

// Version
ServerClock.version = '1.1';

// Configs
ServerClock.config = {
  sampleMinimum: 6,
  sampleMaximum: 25,
  timeoutAfter: 5000, // In msec. Will retry request after this time
  validFor: 1200, // In sec. Will assume to be inaccurate after x seconds
  errorTolerance: 125,
  outlierTolerance: 200,
};
ServerClock.stop = false;

// Request current page by default
ServerClock.targetURL = window.location.href;

// Time related
((Time, $, undefined) => {
  let differenceSamples = []; // A pool of potential clock adjustments (client/server time difference)
  let currentAdjustment;
  let adjustment = 0; // The chosen adjustment
  let lastSynchronized;

  // Create a request object with no-cache headers
  // This prevents looking up 'date' header from cached responses
  const request = new Request(ServerClock.targetURL, {
    method: 'GET',
    cache: 'no-store',
    headers: new Headers({
      Connection: 'keep-alive',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      Expires: '0',
    }),
  });

  Time.getClientTime = () => performance.timeOrigin + performance.now(); // Can be more accurate than using `Date`
  Time.getServerTime = () => Time.getClientTime() + adjustment;
  Time.getAdjustment = () => adjustment;
  Time.getLastSynchronized = () => lastSynchronized;
  Time.synchronize = () => {
    lastSynchronized = performance.now();
    ServerClock.UI.updateMessage('3cb371', 'SYNCHRONIZING...');
    differenceSamples.length = 0;
    currentAdjustment = undefined;
    return new Promise((resolve) => {
      synchronize().then(resolve);
    });
  };

  // Synchronize
  const synchronize = () =>
    new Promise((resolve, reject) => {
      let HTTPTime = 0;
      let elapsedSinceRequest = 0;
      let requestTimeout;
      let receivedResponse;

      // Create a PerformanceObserver
      const observer = new PerformanceObserver((list) => {
        const entry = list.getEntries().find(({ name }) => name === ServerClock.targetURL);

        // Time elapsed since the request was made
        if (entry)
          elapsedSinceRequest = entry.requestStart - entry.startTime + (entry.responseStart - entry.requestStart) / 2;

        if (HTTPTime && elapsedSinceRequest) {
          clearTimeout(requestTimeout);
          if (!receivedResponse) return;

          // Calculate client/server time difference based on HTTP `date` header
          // Accomodate estimated elapsed time (time taken before server recorded `date`)
          differenceSamples.push(HTTPTime - (clientTime + elapsedSinceRequest));
          console.log('Collected a difference sample.');

          // Repeat the process using recursive function
          // When done, decide which adjustment to use
          if (!isSampleSufficient()) {
            setTimeout(() => resolve(synchronize()), getDelay(elapsedSinceRequest));
          } else {
            chooseAdjustment();
            resolve();
          }
        }
        observer.disconnect();
      });

      // Make it a resource observer
      observer.observe({ type: 'resource' });

      // Define client time. Will be used to calculate time difference.
      const clientTime = Time.getClientTime();

      // Make a HTTP request
      fetch(request)
        .then((response) => {
          // Extract server date time from the response headers
          HTTPTime = Date.parse(response.headers.get('date'));
          receivedResponse = true;

          // Fix incomplete response issue
          return response.text();
        })
        .catch((error) => {
          console.error(error);
          clearTimeout(requestTimeout);
          ServerClock.UI.updateMessage('ff5252', 'HTTP REQUEST ERROR');
          receivedResponse = false;
          reject();
        });

      // Setup a timeout timer
      // After some time, it will retry
      requestTimeout = setTimeout(() => {
        console.log('Request timed out. Timeout:', ServerClock.config.timeoutAfter / 1000, 'sec.');
        observer.disconnect();
        resolve(synchronize());
      }, ServerClock.config.timeoutAfter);
    });

  const getDelay = (expectedElapseAfterRequest) => {
    // Try to target end points (least & max truncation)
    if (typeof currentAdjustment === 'undefined') return 250;

    const AdjustedTime = Time.getClientTime() + currentAdjustment;
    const sampleOffset = (differenceSamples.length % 2) * 100;
    const delay = 1000 - ((AdjustedTime + expectedElapseAfterRequest + sampleOffset) % 1000);
    return delay;
  };

  // Determine if the collected sample size is sufficient to accurately estimate the server clock
  const isSampleSufficient = () => {
    if (differenceSamples.length < ServerClock.config.sampleMinimum) return false;
    if (differenceSamples.length >= ServerClock.config.sampleMaximum) {
      console.warn('Inaccuracy Warning: Maximum repeat reached.');
      ServerClock.UI.updateMessage('ffca28', 'INACCURACY WARNING');
      return true;
    }

    // Find smallest, second smallest, largest, and second largest value
    differenceSamples = differenceSamples.sort((a, b) => b - a);
    const min = differenceSamples[differenceSamples.length - 1];
    const min2 = differenceSamples[differenceSamples.length - 2];
    const max = differenceSamples[0];
    const max2 = differenceSamples[1];

    // Likely outlier
    if (max - min > 1000) {
      differenceSamples = differenceSamples.slice(1, differenceSamples - 1);
    }

    // Current best guess of the time difference
    currentAdjustment = max;

    // Return whether the maximum value and the minimum value is around 1 sec (max truncation difference)
    return (
      1000 - ServerClock.config.errorTolerance <= max - min &&
      min2 - min < ServerClock.config.outlierTolerance &&
      max - max2 < ServerClock.config.outlierTolerance
    );
  };

  // Choose one adjustment to apply
  const chooseAdjustment = () => {
    differenceSamples = differenceSamples.sort((a, b) => b - a);
    const candidates = [];
    for (let i = 0; i < differenceSamples.length; i++) {
      for (let j = differenceSamples.length - 1; j >= 0; j--) {
        if (differenceSamples[i] - differenceSamples[j] < 1000) {
          candidates.push([j - i, i]);
          break;
        }
      }
    }
    candidates.sort((a, b) => b - a);
    adjustment = differenceSamples[candidates[0][1]];

    console.log('[Adjustments]');
    differenceSamples.forEach((element) => {
      console.log(element / 1000);
    });
    console.log('The chosen adjustment is', adjustment / 1000, 'sec.');
    if (differenceSamples.length < ServerClock.config.sampleMaximum) ServerClock.UI.updateMessage('000', '');
    lastSynchronized = performance.now();
  };
})((ServerClock.Time = ServerClock.Time || {}));

// UI related
((UI, $, undefined) => {
  let updateTimer;
  let nameSeed = 0;
  let clockElements;
  const elementID = {
    clock: '',
    time: '',
    message: '',
    contextmenu: '',
    menuitem: '',
  };
  const getSeed = () => Math.floor(Math.random() * (2 << 25));
  const getName = (seed, offset) => `e${(seed + offset).toString(16)}`;
  const makeElementId = () => {
    nameSeed = getSeed();
    elementID.clock = getName(nameSeed, 0);
    elementID.time = getName(nameSeed, 1);
    elementID.message = getName(nameSeed, 2);
    elementID.contextmenu = getName(nameSeed, 3);
    elementID.menuitem = getName(nameSeed, 4);
  };
  const formatTime = (clockTime) => {
    // Format time to string
    const formatDigit = (d) => String(d).padStart(2, '0');
    const time = new Date(clockTime);
    const hours = formatDigit(time.getHours() % 12 || 12);
    const minutes = formatDigit(time.getMinutes());
    const seconds = formatDigit(time.getSeconds());
    const amPm = time.getHours() >= 12 ? 'PM' : 'AM';
    return `${hours}:${minutes}:${seconds} ${amPm}`;
  };

  const constructUI = () => {
    const createClockElements = () => {
      // Create clock elements
      const frameElement = document.createElement('div');
      frameElement.id = elementID.clock;

      const timeElement = document.createElement('span');
      timeElement.textContent = '00:00:00 NA';
      timeElement.id = elementID.time;
      frameElement.appendChild(timeElement);

      const messageElement = document.createElement('span');
      messageElement.id = elementID.message;
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
        if (document.getElementById(elementID.contextmenu)) {
          const menu = document.getElementById(elementID.contextmenu);
          menu.style.top = `${event.clientY}px`;
          menu.style.left = `${event.clientX}px`;
          return;
        }

        // Create the context menu element
        const menu = document.createElement('div');
        menu.id = elementID.contextmenu;
        menu.style.top = `${event.clientY}px`;
        menu.style.left = `${event.clientX}px`;

        // Create and append menu items
        for (const item of menuItems) {
          const menuItem = document.createElement('div');
          menuItem.textContent = item.label;
          menuItem.addEventListener('click', item.action);
          menuItem.classList.add(elementID.menuitem);
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
      ServerClock.Time.synchronize().then(ServerClock.UI.startUpdateTimer);
    };

    // Contextmenu action visitproject
    const action_visitproject = () => {
      console.log('Opening the project page...');
      window.open('https://github.com/r8btx/Server-Clock-Bookmarklet/', '_blank');
    };

    // Contextmenu action exit
    const action_exit = () => {
      ServerClock.stop = true;
      document.body.removeChild(clockElements[0]);
      document.head.removeChild(styleSheet);
      if (document.currentScript) {
        document.body.removeChild(document.currentScript);
      }
      delete window.ServerClock;
      console.log('Server Clock finished.');
    };

    // Add contextmenu
    clockElements = createClockElements();
    const menuItems = [
      { label: 'Rerun', action: action_rerun },
      { label: 'Visit project page', action: action_visitproject },
      { label: 'Exit', action: action_exit },
    ];

    attachContextMenu(clockElements[0], menuItems);
    appendStyles(`
      #${elementID.clock}:hover,
      #${elementID.contextmenu} {
        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
      }
      #${elementID.clock},
      #${elementID.contextmenu} {
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
      #${elementID.clock} {
        top: 10px;
        padding: 12px;
        border: 1px solid #ddd;
        border-radius: 6px;
        align-items: center;
        transition: box-shadow 0.3s;
      }
      #${elementID.message} {
        line-height: 0;
        font-size: 0.6rem;
        font-weight: 700;
      }
      #${elementID.time} {
        font-size: 1.25rem;
        line-height: 1.75;
      }
      #${elementID.contextmenu} {
        padding: 6px 0;
      }
      .${elementID.menuitem} {
        font-family: Arial, sans-serif;
        font-size: 1.125rem;
        line-height: 1.75rem;
        padding: 6px 12px;
        cursor: pointer;
        transition: background-color 0.3s;
      }
      .${elementID.menuitem}:hover {
        background-color: #3cb371;
        color: #fff;
      }`);
    appendClockFrame(clockElements[0]);
  };

  const updateClock = () => {
    // Update clock every beginning of a second
    if ((performance.now() - ServerClock.Time.getLastSynchronized()) / 1000 > ServerClock.config.validFor)
      UI.updateMessage('ffca28', 'INACCURACY WARNING');
    const clockTime = ServerClock.Time.getServerTime();
    clockElements[1].textContent = formatTime(clockTime);
    updateTimer = ServerClock.stop
      ? UI.updateMessage('ff5252', 'STOPPED')
      : setTimeout(updateClock, 1000 - (clockTime % 1000));
  };

  UI.startUpdateTimer = () => {
    if (ServerClock.stop || typeof currentAdjustment === 'undefined') {
      ServerClock.stop = false;
      updateClock();
    }
  };

  UI.updateMessage = (hexColor, message) => {
    const messageDOM = document.getElementById(elementID.message);
    if (!messageDOM) return;
    messageDOM.textContent = message;
    messageDOM.style.color = `#${hexColor}`;
  };
  makeElementId();
  constructUI();
})((ServerClock.UI = ServerClock.UI || {}));

(() => {
  console.log(`Server Clock started. [Version ${ServerClock.version}]`);
  ServerClock.Time.synchronize().then(ServerClock.UI.startUpdateTimer);
  window.ServerClock = ServerClock;
})();
