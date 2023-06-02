const config = {
  sampleMinimum: 3,
  sampleMaximum: 10,
  timeoutAfter: 5000, // In msec. Will retry request after this time
  validFor: 1200, // In sec. Will assume to be inaccurate after x seconds
  errorTolerance: 100,
  targetURL: `https://www.timeapi.io/api/Time/current/zone?timeZone=${
    Intl.DateTimeFormat().resolvedOptions().timeZone
  }`,
};
const defined = typeof window.ServerClock !== 'undefined';
let Time = defined
  ? window.ServerClock.class.Time
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
        this.lastSynchronized = performance.now();
        let differenceSamples = []; // A pool of potential clock adjustments (client/server time difference)
        let requestCount = 0;
        let expectedElapseAfterRequest = 0;

        return new Promise((resolve) => {
          const recursiveSynchronization = async (resolver) => {
            try {
              requestCount++;
              const sample = await new Sample(this.SC).collect();
              differenceSamples.push([sample.HTTPAdjustment, sample.estimatedError]);
              differenceSamples.sort((a, b) => b[0] - a[0]);
              this.currentAdjustment = differenceSamples[0][0];
              expectedElapseAfterRequest = sample.elapsedSinceRequest;

              const nextStep = this.determineNextStep(
                requestCount,
                this.currentAdjustment,
                differenceSamples[differenceSamples.length - 1][0],
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
            if (differenceSamples[i][0] - differenceSamples[j][0] < 1000) {
              candidates.push([j - i, i]);
              break;
            }
          }
        }
        candidates.sort((a, b) => b[0] - a[0]);
        this.adjustment = differenceSamples[candidates[0][1]][0];
        const EstimatedError = differenceSamples[candidates[0][1]][1];

        console.log('[Adj]'.padEnd(12, ' ') + '[Err]');
        differenceSamples.forEach((element) => {
          console.log(`${String(element[0]).padEnd(12, ' ')}${element[1]}`);
        });
        console.log(
          'The chosen adjustment is',
          this.adjustment / 1000,
          'sec with an estimated error of',
          EstimatedError,
          'msec.',
        );
        this.lastSynchronized = performance.now();
      }
    };

let Sample = defined
  ? window.ServerClock.class.Sample
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
          let API_Time = 0;
          let timeId = 0;
          this.observer = new PerformanceObserver((list) => {
            const entry = list.getEntries().find(({ name }) => name === this.request.url);
            if (entry && Math.abs(timeId - entry.startTime) < this.timeIdErrorTolerance) {
              clearTimeout(this.requestTimeout);
              this.observer.disconnect();
              this.processSample(resolve, entry, requestStartTime, HTTPTime, API_Time);
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
              response.json().then((j) => {
                API_Time = Date.parse(j.dateTime);
              });
            })
            .catch(() => {});

          this.setTimeout(reject);
        });
      }

      processSample(returnSuccess, entry, requestStartTime, HTTPTime, API_Time) {
        const estimatedLatency = (entry.responseStart - entry.requestStart) / 2;
        const elapsedSinceRequest = entry.requestStart - entry.startTime + estimatedLatency;
        const elapsedSinceResponse = entry.responseEnd - entry.responseStart + estimatedLatency;

        // Calculate client/server time difference based on HTTP `date` header
        // Accomodate estimated elapsed time (time taken before server recorded `date`)
        // Accomodate estimated elapsed time for the json response (time passed since the response was made)
        const HTTPAdjustment = HTTPTime - (requestStartTime + elapsedSinceRequest);
        const HTTPEstimation = Time.getClientTime() + HTTPAdjustment;
        const API_Estimation = API_Time + elapsedSinceResponse;
        const estimatedError = HTTPEstimation - API_Estimation;

        const result = {
          elapsedSinceRequest,
          HTTPAdjustment,
          estimatedError,
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

let ServerClock = defined
  ? undefined
  : class ServerClock {
      constructor() {
        this.version = '1.3';
        this.config = config;
        this.class = { Time, Sample };
        this.timeObject = new Time(this);
      }

      exit() {
        this.timeObject = undefined;
        delete window.ServerClock;
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
    };

(() => {
  let serverclock = defined ? window.ServerClock : new ServerClock();
  if (!window.location.href.includes('timeapi.io')) {
    serverclock.exit();
    alert('Go to https://www.timeapi.io/ and try again!');
    return;
  }
  if (!defined) {
    console.log(`Server Clock Test started. [Version ${serverclock.version}]`);
    window.ServerClock = serverclock;
  }
  serverclock.synchronize();
})();
