(() => {
  if (!window.location.href.includes('timeapi.io')) {
    alert('Go to https://www.timeapi.io/ and try again!');
    return;
  }

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

  // Request https://www.timeapi.io/
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const url = 'https://www.timeapi.io/api/Time/current/zone?timeZone='.concat(timezone);

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
      return true;
    }

    // Find smallest, second smallest, largest, and second largest value
    adjustments = adjustments.sort((a, b) => b[0] - a[0]);
    const min = adjustments[adjustments.length - 1][0];
    const min2 = adjustments[adjustments.length - 2][0];
    const max = adjustments[0][0];
    const max2 = adjustments[1][0];

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
        if (adjustments[i][0] - adjustments[j][0] < 1000) {
          candidates.push([j - i, i]);
          break;
        }
      }
    }
    candidates.sort((a, b) => b[0] - a[0]);
    adjustment = adjustments[candidates[0][1]][0];
    const estimated_err = adjustments[candidates[0][1]][1];

    console.log('[Adj]'.padEnd(12, ' ') + '[Err]');
    adjustments.forEach((element) => {
      console.log(`${String(element[0]).padEnd(12, ' ')}${element[1]}`);
    });
    console.log(
      'The chosen adjustment is',
      adjustment / 1000,
      'sec with an estimated error of',
      estimated_err,
      'msec.',
    );
  };

  // Collect adjustments repeatedly using a recursive function
  function run() {
    let servertime = 0;
    let servertime_json;
    let elapsed = 0;
    let elapsed_json;
    let timeout;
    let replied;

    // Create a PerformanceObserver
    const observer = new PerformanceObserver((list) => {
      const entry = list.getEntries().find(({ name }) => name === url);
      if (entry) {
        // Time elapsed since the request was made
        elapsed = entry.requestStart - entry.startTime + (entry.responseStart - entry.requestStart) / 2;
        elapsed_json = (entry.responseStart - entry.requestStart) / 2 + entry.responseEnd - entry.responseStart;
      }

      if (servertime && elapsed) {
        clearTimeout(timeout);
        if (!replied) return;

        // Calculate client/server time difference based on HTTP `date` header
        // Accomodate estimated elapsed time (time taken before server recorded `date`)
        // Accomodate estimated elapsed time for the json response (time passed since the response was made)
        const adj = servertime - (clienttime + elapsed);
        const est = getTime() + adj;
        const est_json = servertime_json + elapsed_json;
        adjustments.push([adj, est - est_json]); // push difference also
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

        // Get server time through the API
        response.json().then((j) => {
          servertime_json = Date.parse(j.dateTime);
        });
      })
      .catch((error) => {
        console.error(error);
        clearTimeout(timeout);
        replied = false;
      });

    // Setup a timeout timer
    // After some time, it will retry
    timeout = setTimeout(() => {
      console.log('Request timed out. Timeout:', timeout_time / 1000, 'sec.');
      observer.disconnect();
      run();
    }, timeout_time);
  }

  // Start
  console.log(`Server Clock Test started. [Version ${scb_version}]`);
  run();
})();
