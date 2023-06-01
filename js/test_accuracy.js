'use strict';

if (typeof window.ServerClock === 'undefined') {
  let ServerClock = {
    version: '1.3 alpha',
    config: {
      sampleMinimum: 3,
      sampleMaximum: 10,
      timeoutAfter: 5000, // In msec. Will retry request after this time
      validFor: 1200, // In sec. Will assume to be inaccurate after x seconds
      errorTolerance: 100,
    },
    stop: false,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    targetURL: undefined,
    exit() {
      ServerClock.UI.removeUI();
      delete window.ServerClock;
      ServerClock = undefined;
      console.log('Server Clock finished.');
    },
  };

  // Request https://www.timeapi.io/
  ServerClock.targetURL = 'https://www.timeapi.io/api/Time/current/zone?timeZone='.concat(ServerClock.timezone);

  // Exit Server Clock
  ServerClock.exit = () => {
    delete window.ServerClock;
    ServerClock = undefined;
    console.log('Server Clock finished.');
  };

  // Time related
  ((Time, $, undefined) => {
    let differenceSamples = []; // A pool of potential clock adjustments (client/server time difference)
    let sampleRequestCount;
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
      differenceSamples.length = 0;
      sampleRequestCount = 0;
      currentAdjustment = undefined;
      return new Promise((resolve) => {
        synchronize().then(resolve).catch();
      });
    };

    // Synchronize
    const synchronize = () =>
      new Promise((resolve) => {
        let HTTPTime = 0;
        let API_Time;
        let elapsedSinceRequest = 0;
        let elapsedSinceResponse;
        let requestTimeout;
        let receivedResponse;
        sampleRequestCount++;

        // For sending stop signal when timeout
        const controller = new AbortController();
        const signal = controller.signal;

        // Create a PerformanceObserver
        const observer = new PerformanceObserver((list) => {
          const entry = list.getEntries().find(({ name }) => name === ServerClock.targetURL);

          if (entry) {
            // Time elapsed since the request was made
            elapsedSinceRequest = entry.requestStart - entry.startTime + (entry.responseStart - entry.requestStart) / 2;
            elapsedSinceResponse =
              (entry.responseStart - entry.requestStart) / 2 + entry.responseEnd - entry.responseStart;
          }

          if (HTTPTime && elapsedSinceRequest) {
            clearTimeout(requestTimeout);
            if (!receivedResponse) return;

            // Calculate client/server time difference based on HTTP `date` header
            // Accomodate estimated elapsed time (time taken before server recorded `date`)
            // Accomodate estimated elapsed time for the json response (time passed since the response was made)
            const HTTPAdjustment = HTTPTime - (clientTime + elapsedSinceRequest);
            const HTTPEstimation = Time.getClientTime() + HTTPAdjustment;
            const API_Estimation = API_Time + elapsedSinceResponse;
            differenceSamples.push([HTTPAdjustment, HTTPEstimation - API_Estimation]); // push difference also
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
        fetch(request, { signal: signal })
          .then((response) => {
            // Extract server date time from the response headers
            HTTPTime = Date.parse(response.headers.get('date'));
            receivedResponse = true;

            // Get server time through the API
            response.json().then((j) => {
              API_Time = Date.parse(j.dateTime);
            });
          })
          .catch(() => {
            clearTimeout(requestTimeout);
            receivedResponse = false;
          });

        // Setup a timeout timer
        // After some time, it will retry
        requestTimeout = setTimeout(() => {
          console.log('Request timed out. Timeout:', ServerClock.config.timeoutAfter / 1000, 'sec.');
          observer.disconnect();
          controller.abort();
          if (sampleRequestCount < ServerClock.config.sampleMaximum || differenceSamples.length == 0) {
            setTimeout(() => resolve(synchronize()), getDelay(elapsedSinceRequest));
          } else {
            console.warn('Inaccuracy Warning: Network not stable.');
            chooseAdjustment();
          }
        }, ServerClock.config.timeoutAfter);
      });

    const getDelay = (expectedElapseAfterRequest) => {
      let precision = 1000 / Math.pow(2, differenceSamples.length);
      const sampleOffset = Math.max(precision, ServerClock.config.errorTolerance);
      const adjustedTime = Time.getClientTime() + currentAdjustment;
      const delay = 1000 - ((adjustedTime + expectedElapseAfterRequest + sampleOffset) % 1000);

      return delay;
    };

    // Determine if the collected sample size is sufficient to accurately estimate the server clock
    const isSampleSufficient = () => {
      if (sampleRequestCount < ServerClock.config.sampleMinimum) return false;
      if (sampleRequestCount >= ServerClock.config.sampleMaximum) {
        console.warn('Inaccuracy Warning: Request limit reached.');
        return true;
      }

      // Find smallest, second smallest, largest, and second largest value
      differenceSamples = differenceSamples.sort((a, b) => b[0] - a[0]);
      const min = differenceSamples[differenceSamples.length - 1][0];
      const max = differenceSamples[0][0];

      currentAdjustment = max;

      // Likely outlier
      if (max - min > 1000) {
        differenceSamples = differenceSamples.slice(1, differenceSamples.length - 1);
        return false;
      }

      // Return whether the maximum value and the minimum value is around 1 sec (max truncation difference)
      return 1000 - ServerClock.config.errorTolerance <= max - min;
    };

    // Choose one adjustment to apply
    const chooseAdjustment = () => {
      differenceSamples = differenceSamples.sort((a, b) => b[0] - a[0]);
      const candidates = [];
      for (let i = 0; i < differenceSamples.length; i++) {
        for (let j = differenceSamples.length - 1; j >= 0; j--) {
          if (differenceSamples[i][0] - differenceSamples[j][0] < 1000) {
            candidates.push([j - i, i]);
            break;
          }
        }
      }
      candidates.sort((a, b) => b[0] - a[0]);
      adjustment = differenceSamples[candidates[0][1]][0];
      const EstimatedError = differenceSamples[candidates[0][1]][1];

      console.log('[Adj]'.padEnd(12, ' ') + '[Err]');
      differenceSamples.forEach((element) => {
        console.log(`${String(element[0]).padEnd(12, ' ')}${element[1]}`);
      });
      console.log(
        'The chosen adjustment is',
        adjustment / 1000,
        'sec with an estimated error of',
        EstimatedError,
        'msec.',
      );
      lastSynchronized = performance.now();
    };
  })((ServerClock.Time = ServerClock.Time || {}));

  (() => {
    if (!window.location.href.includes('timeapi.io')) {
      ServerClock.exit();
      alert('Go to https://www.timeapi.io/ and try again!');
      return;
    }
    console.log(`Server Clock Test started. [Version ${ServerClock.version}]`);
    ServerClock.Time.synchronize();
    window.ServerClock = ServerClock;
  })();
} else {
  window.ServerClock.Time.synchronize();
}
