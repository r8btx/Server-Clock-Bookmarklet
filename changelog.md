# Changelog

### v0.9

- Clean up upon exit

### v0.8

- Combined 'Add 5 more samples' and 'Empty collected samples' into 'Rerun' in UI
- Attempt to increase the estimation accuracy with less number of requests.

### v0.7

- Created [launcher.js](./js/launcher.js) and [the bookmarklet page](https://r8btx.github.io/Server-Clock-Bookmarklet/page) to simplify the setup process.

### v0.6

- Now uses [Performance.now()](https://developer.mozilla.org/en-US/docs/Web/API/Performance/now) to avoid local clock issues

### v0.5

- Added automatic sampling size calculation
- Removed broken timespacing calculation (Now random)

### v0.4

- Added sampling timeout
- Minor adjustments (timespacing, num_repeat, etc.)

### v0.3

- Added context menu UI

### v0.2

- Added UI
- Created [test_accuracy.js](./js/test_accuracy.js) for accuracy testing

### v0.1

- Initial version
