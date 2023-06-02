const config = {
  sampleMinimum: 3,
  sampleMaximum: 10,
  timeoutAfter: 5000, // In msec. Will retry request after this time
  validFor: 1200, // In sec. Will assume to be inaccurate after x seconds
  errorTolerance: 100,
  targetURL: window.location.href,
};
const defined = typeof window.ServerClocks !== 'undefined';
let Time = defined
  ? window.ServerClocks[0].class.Time
  : class Time {
      constructor(SC) {
        this.SC = SC;
        this.config = SC.config;
        this.currentAdjustment = 0; // The chosen adjustment
        this.lastSynchronized = 0;
      }

      static getClientTime() {
        return performance.timeOrigin + performance.now();
      }

      getServerTime() {
        return Time.getClientTime() + this.currentAdjustment;
      }

      synchronize() {
        this.SC.stop = false;
        this.lastSynchronized = performance.now();
        let differenceSamples = []; // A pool of potential clock adjustments (client/server time difference)
        let requestCount = 0;
        let expectedElapseAfterRequest = 0;
        this.SC.uiObject.updateMessage('3cb371', 'SYNCHRONIZING...');

        return new Promise((resolve) => {
          const recursiveSynchronization = async (resolver) => {
            if (this.SC.stop) return;
            try {
              requestCount++;
              const sample = await new Sample(this.SC).collect();
              differenceSamples.push(sample.HTTPAdjustment);
              differenceSamples.sort((a, b) => b - a);
              this.currentAdjustment = differenceSamples[0];
              expectedElapseAfterRequest = sample.elapsedSinceRequest;

              const nextStep = this.determineNextStep(
                requestCount,
                this.currentAdjustment,
                differenceSamples[differenceSamples.length - 1],
              );

              switch (nextStep) {
                case 2:
                  differenceSamples = differenceSamples.slice(1, -1);
                case 1:
                  setTimeout(
                    () => recursiveSynchronization(resolver),
                    this.getDelay(expectedElapseAfterRequest, differenceSamples.length),
                  );
                  break;
                case 0:
                  this.chooseAdjustment(differenceSamples);
                  resolver();
              }
            } catch (error) {
              if (requestCount < this.config.sampleMaximum || differenceSamples.length === 0) {
                setTimeout(
                  () => recursiveSynchronization(resolver),
                  this.getDelay(expectedElapseAfterRequest, differenceSamples.length),
                );
              } else {
                console.warn('Inaccuracy Warning: Request limit reached.');
                this.SC.uiObject.updateMessage('ffca28', 'INACCURACY WARNING');
                this.chooseAdjustment(differenceSamples);
              }
            }
          };
          recursiveSynchronization(resolve);
        });
      }

      determineNextStep(requestCount, max, min) {
        if (requestCount < this.config.sampleMinimum) return 1;
        if (requestCount >= this.config.sampleMaximum) {
          console.warn('Inaccuracy Warning: Request limit reached.');
          this.SC.uiObject.updateMessage('ffca28', 'INACCURACY WARNING');
          return 0;
        }
        if (max - min > 1000) return 2; // Likely outlier

        // Return whether the maximum value and the minimum value is around 1 sec (max truncation difference)
        return 1000 - this.config.errorTolerance > max - min ? 1 : 0;
      }

      getDelay(expectedElapseAfterRequest, precisionLevel) {
        const precision = 1000 / Math.pow(2, precisionLevel);
        const sampleOffset = Math.max(precision, this.config.errorTolerance);
        const adjustedTime = Time.getClientTime() + this.currentAdjustment;
        const delay = 1000 - ((adjustedTime + expectedElapseAfterRequest + sampleOffset) % 1000);

        return delay;
      }

      chooseAdjustment(differenceSamples) {
        const candidates = [];
        for (let i = 0; i < differenceSamples.length; i++) {
          for (let j = differenceSamples.length - 1; j >= 0; j--) {
            if (differenceSamples[i] - differenceSamples[j] < 1000) {
              candidates.push([j - i, i]);
              break;
            }
          }
        }
        candidates.sort((a, b) => b[0] - a[0]);
        this.currentAdjustment = differenceSamples[candidates[0][1]];

        console.log('[Adjustments]');
        differenceSamples.forEach((element) => {
          console.log(element / 1000);
        });
        console.log('The chosen adjustment is', this.currentAdjustment / 1000, 'sec.');
        if (differenceSamples.length < this.config.sampleMaximum) this.SC.uiObject.updateMessage('000', '');
        this.lastSynchronized = performance.now();
      }
    };

let Sample = defined
  ? window.ServerClocks[0].class.Sample
  : class Sample {
      constructor(SC) {
        this.SC = SC;
        this.config = SC.config;
        this.timeIdErrorTolerance = 500;
        this.controller = new AbortController();
        this.observer;
        this.requestTimeout;
        this.request = new Request(this.config.targetURL, {
          // Create a request object with no-cache headers
          // This prevents looking up 'date' header from cached responses
          method: 'GET',
          cache: 'no-store',
          headers: new Headers({
            Connection: 'keep-alive',
            'Cache-Control': 'no-cache',
            Pragma: 'no-cache',
            Expires: '0',
          }),
        });
      }

      collect() {
        return new Promise((resolve, reject) => {
          let HTTPTime = 0;
          let timeId = 0;
          this.observer = new PerformanceObserver((list) => {
            const entry = list.getEntries().find(({ name }) => name === this.request.url);
            if (entry && Math.abs(timeId - entry.startTime) < this.timeIdErrorTolerance) {
              clearTimeout(this.requestTimeout);
              this.observer.disconnect();
              this.processSample(resolve, entry, requestStartTime, HTTPTime);
            } else {
              this.setTimeout(reject);
            }
          });
          this.observer.observe({ type: 'resource' });

          timeId = performance.now();
          const requestStartTime = Time.getClientTime();
          fetch(this.request, { signal: this.controller.signal })
            .then(async (response) => {
              HTTPTime = Date.parse(response.headers.get('date'));
              await response.text(); // Fixes incomplete response issue
            })
            .catch(() => {});

          this.setTimeout(reject);
        });
      }

      processSample(returnSuccess, entry, requestStartTime, HTTPTime) {
        const estimatedLatency = (entry.responseStart - entry.requestStart) / 2;
        const elapsedSinceRequest = entry.requestStart - entry.startTime + estimatedLatency;

        // Calculate client/server time difference based on HTTP `date` header
        // Accomodate estimated elapsed time (time taken before server recorded `date`)
        const HTTPAdjustment = HTTPTime - (requestStartTime + elapsedSinceRequest);

        const result = {
          elapsedSinceRequest,
          HTTPAdjustment,
        };

        console.log('Collected a difference sample.');
        returnSuccess(result);
      }

      setTimeout(returnFail) {
        if (this.requestTimeout) clearTimeout(this.requestTimeout);
        this.requestTimeout = setTimeout(() => {
          console.log('Request timed out. Timeout:', config.timeoutAfter / 1000, 'sec.');
          this.observer.disconnect();
          this.controller.abort();
          returnFail();
        }, this.config.timeoutAfter);
      }
    };

let UI = defined
  ? window.ServerClocks[0].class.UI
  : class UI {
      static getSeed = () => Math.floor(Math.random() * (2 << 25));
      static getName = (seed, offset) => `e${(seed + offset).toString(16)}`;
      static formatTime = (clockTime) => {
        const formatDigit = (d) => String(d).padStart(2, '0');
        const time = new Date(clockTime);
        const hours = formatDigit(time.getHours() % 12 || 12);
        const minutes = formatDigit(time.getMinutes());
        const seconds = formatDigit(time.getSeconds());
        const amPm = time.getHours() >= 12 ? 'PM' : 'AM';
        return `${hours}:${minutes}:${seconds} ${amPm}`;
      };

      constructor(SC) {
        this.SC = SC;
        this.config = SC.config;
        this.updateTimer;
        this.clockElements;
        this.elementID = this.makeElementId();
        this.clockElements = this.createClockElements();
        this.styleSheet = document.createElement('style');
        this.constructUI();
      }

      makeElementId() {
        const elementID = {};
        const nameSeed = UI.getSeed();
        elementID.clock = UI.getName(nameSeed, 0);
        elementID.time = UI.getName(nameSeed, 1);
        elementID.message = UI.getName(nameSeed, 2);
        elementID.contextmenu = UI.getName(nameSeed, 3);
        elementID.menuitem = UI.getName(nameSeed, 4);
        return elementID;
      }

      createClockElements() {
        const frameElement = document.createElement('div');
        frameElement.id = this.elementID.clock;

        const timeElement = document.createElement('span');
        timeElement.textContent = '00:00:00 NA';
        timeElement.id = this.elementID.time;
        frameElement.appendChild(timeElement);

        const messageElement = document.createElement('span');
        messageElement.id = this.elementID.message;
        frameElement.appendChild(messageElement);

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

        frameElement.addEventListener('mousedown', handleDrag);
        return [frameElement, timeElement, messageElement];
      }

      attachContextMenu(element, menuItems) {
        element.addEventListener('contextmenu', (event) => {
          event.preventDefault();

          if (document.getElementById(this.elementID.contextmenu)) {
            const menu = document.getElementById(this.elementID.contextmenu);
            menu.style.top = `${event.clientY}px`;
            menu.style.left = `${event.clientX}px`;
            return;
          }

          const menu = document.createElement('div');
          menu.id = this.elementID.contextmenu;
          menu.style.top = `${event.clientY}px`;
          menu.style.left = `${event.clientX}px`;

          for (const item of menuItems) {
            const menuItem = document.createElement('div');
            menuItem.textContent = item.label;
            menuItem.addEventListener('click', item.action);
            menuItem.classList.add(this.elementID.menuitem);
            menu.appendChild(menuItem);
          }

          const closeMenu = () => {
            document.body.removeChild(menu);
            document.removeEventListener('click', closeMenu);
          };

          document.body.appendChild(menu);
          document.addEventListener('click', closeMenu);
        });
      }

      action_rerun() {
        console.log('Resynchronizing...');
        this.SC.timeObject.synchronize().then(this.startUpdateTimer());
      }

      action_visitproject() {
        console.log('Opening the project page...');
        window.open('https://github.com/r8btx/Server-Clock-Bookmarklet/', '_blank');
      }

      action_exit() {
        this.SC.exit();
      }

      removeUI() {
        if (typeof this.updateTimer !== 'undefined') clearTimeout(this.updateTimer);
        document.body.removeChild(this.clockElements[0]);
        document.head.removeChild(this.styleSheet);
      }

      constructUI() {
        const elementID = this.elementID;
        const clockElements = this.clockElements;
        const styleSheet = this.styleSheet;
        const menuItems = [
          { label: 'Rerun', action: () => this.action_rerun() },
          { label: 'Visit project page', action: () => this.action_visitproject() },
          { label: 'Exit', action: () => this.action_exit() },
        ];

        this.attachContextMenu(clockElements[0], menuItems);

        const styles = `
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
          }`;

        styleSheet.innerText = styles.replace(/\n/g, '').replace(/\s+/g, ' ');
        document.head.appendChild(styleSheet);

        document.body.appendChild(clockElements[0]);
      }

      updateClock() {
        if ((performance.now() - this.SC.timeObject.lastSynchronized) / 1000 > this.config.validFor)
          this.updateMessage('ffca28', 'INACCURACY WARNING');

        const timeElement = this.clockElements[1];
        const clockTime = this.SC.timeObject.getServerTime();
        timeElement.textContent = UI.formatTime(clockTime);

        this.updateTimer = this.SC.stop
          ? this.updateMessage('ff5252', 'STOPPED')
          : setTimeout(this.updateClock.bind(this), 1000 - (clockTime % 1000));
      }

      startUpdateTimer() {
        if (typeof this.updateTimer === 'undefined' && typeof this.SC.timeObject !== 'undefined') {
          this.SC.stop = false;
          this.updateClock();
        }
      }

      updateMessage = (hexColor, message) => {
        const messageDOM = document.getElementById(this.elementID.message);
        if (!messageDOM) return;
        messageDOM.textContent = message;
        messageDOM.style.color = `#${hexColor}`;
      };
    };

class ServerClock {
  constructor() {
    this.version = '1.3';
    this.config = config;
    this.stop = false;
    this.class = { Time, Sample, UI };
    this.timeObject = new Time(this);
    this.uiObject = new UI(this);
  }

  exit() {
    this.stop = true;
    this.uiObject.removeUI();
    const index = window.ServerClocks.indexOf(this);
    window.ServerClocks.splice(index, 1);
    if (window.ServerClocks.length === 0) delete window.ServerClocks;

    this.timeObject = undefined;
    this.uiObject = undefined;
    console.log('Server Clock finished.');
  }

  synchronize() {
    return this.timeObject.synchronize();
  }

  getClientTime() {
    return this.class.Time.getClientTime();
  }

  getServerTime() {
    return this.timeObject.getServerTime();
  }

  startUpdateTimer() {
    this.uiObject.startUpdateTimer();
  }
}

(() => {
  let serverclock = new ServerClock();
  console.log(`Server Clock started. [Version ${serverclock.version}]`);
  serverclock.synchronize().then(() => serverclock.startUpdateTimer());
  if (!defined) {
    window.ServerClocks = [];
  }
  window.ServerClocks.push(serverclock);
})();
