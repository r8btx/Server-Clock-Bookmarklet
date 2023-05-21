(() => {
  if (!window.location.href.includes('timeapi.io')) {
    alert('Go to https://www.timeapi.io/ and try again!');
    return;
  }

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let adjustment;
  let adjustments = []; // A pool of clock adjustments (client/server time difference)
  let best_at_hand;
  let repeated = 0;
  const min_repeat = 5;
  const max_repeat = 25;
  const timeout_time = 5000; // In msec. Will retry request after this time
  const tolerance_err = 125;
  const tolerance_outlier = 200;

  // Request https://www.timeapi.io/
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
      if (adjustments[i][0] < min) {
        min2 = min;
        min = adjustments[i][0];
      } else if (adjustments[i][0] < min2) {
        min2 = adjustments[i][0];
      }

      if (adjustments[i][0] > max) {
        max2 = max;
        max = adjustments[i][0];
      } else if (adjustments[i][0] > max2) {
        max2 = adjustments[i][0];
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
      return b[0] - a[0];
    });

    while (i < adjustments.length && !candidate_done) {
      for (let j = adjustments.length - 1; j >= 0; j--) {
        if (adjustments[i][0] - adjustments[j][0] < 1000) {
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
      return b[0] - a[0];
    });
    adjustment = adjustments[candidates[0][1]][0];
    const estimated_err = adjustments[candidates[0][1]][1];

    console.log('[Adj]\t[Err]');
    adjustments.forEach((element) => {
      console.log(`${element[0]}\t${element[1]}`);
    });
    console.log(
      'The chosen adjustment is',
      adjustment / 1000,
      'sec with an estimated error of',
      estimated_err,
      'msec.',
    );
  }

  // Collect adjustments repeatedly using a recursive function
  function run() {
    let servertime = 0;
    let servertime_json;
    let elapsed = 0;
    let elapsed_json;
    let timeout;

    // Create a PerformanceObserver
    const observer = new PerformanceObserver((list) => {
      list
        .getEntries()
        .filter(({ name }) => name === url)
        .forEach((e) => {
          // Time elapsed since the request was made
          elapsed = e.requestStart - e.startTime + (e.responseStart - e.requestStart) / 2;
          elapsed_json = (e.responseStart - e.requestStart) / 2 + e.responseEnd - e.responseStart;
        });

      if (servertime && elapsed) {
        // Clear the timeout
        clearTimeout(timeout);

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
    let clienttime = getTime();

    // Make a HTTP request
    fetch(request)
      .then((response) => {
        // Extract server date time from the response headers
        servertime = Date.parse(response.headers.get('date'));

        // Get server time through the API
        response.json().then((j) => {
          servertime_json = Date.parse(j.dateTime);
        });
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

  // Start
  console.log('Server Clock started.');
  run();
})();
