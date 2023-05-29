'use strict';

let ServerClock = {};

// Version
ServerClock.version = '1.1';

// Configs
ServerClock.config = {
  sampleMinimum: 6,
  sampleMaximum: 25,
  timeoutAfter: 5000, // In msec. Will retry request after this time
  errorTolerance: 125,
  outlierTolerance: 200,
};

// Request https://www.timeapi.io/
ServerClock.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
ServerClock.targetURL = 'https://www.timeapi.io/api/Time/current/zone?timeZone='.concat(ServerClock.timezone);

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
      let API_Time;
      let elapsedSinceRequest = 0;
      let elapsedSinceResponse;
      let requestTimeout;
      let receivedResponse;

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
      fetch(request)
        .then((response) => {
          // Extract server date time from the response headers
          HTTPTime = Date.parse(response.headers.get('date'));
          receivedResponse = true;

          // Get server time through the API
          response.json().then((j) => {
            API_Time = Date.parse(j.dateTime);
          });
        })
        .catch((error) => {
          console.error(error);
          clearTimeout(requestTimeout);
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
      return true;
    }

    // Find smallest, second smallest, largest, and second largest value
    differenceSamples = differenceSamples.sort((a, b) => b[0] - a[0]);
    const min = differenceSamples[differenceSamples.length - 1][0];
    const min2 = differenceSamples[differenceSamples.length - 2][0];
    const max = differenceSamples[0][0];
    const max2 = differenceSamples[1][0];

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
    alert('Go to https://www.timeapi.io/ and try again!');
    return;
  }
  console.log(`Server Clock started. [Version ${ServerClock.version}]`);
  ServerClock.Time.synchronize();
  window.ServerClock = ServerClock;
})();
