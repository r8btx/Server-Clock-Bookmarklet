# Changelog

## Server Clock

[v1.1] Warns inaccuracy if pre-defined `validFor` time passes (default: 20mins)  
[v1.1] Users can now interact with the bookmarklet using a browser console (accessed via ServerClock)  
[v1.1] Code refactoring  
[v1.0] Updated UI, including new status message display  
[v1.0] Code rewrite  
[v0.9] Clean up upon exit  
[v0.8] Combined 'Add 5 more samples' and 'Empty collected samples' into 'Rerun' in UI  
[v0.8] Attempt to increase the estimation accuracy with less number of requests.  
[v0.6] Now uses [Performance.now()](https://developer.mozilla.org/en-US/docs/Web/API/Performance/now) to avoid local clock issues  
[v0.5] Added automatic sampling size calculation  
[v0.5] Removed broken timespacing calculation (Now random)  
[v0.4] Added sampling timeout  
[v0.4] Minor adjustments (timespacing, num_repeat, etc.)  
[v0.3] Added context menu UI  
[v0.2] Added UI  
[v0.2] Created [test_accuracy.js](./js/test_accuracy.js) for accuracy testing  
[v0.1] Initial version

## Launcher

[v0.2] Notify policy errors & link to the distribution page  
[v0.1] Created [launcher.js](./js/launcher.js)

## Distribution Page

[v0.5] Clicking the bookmarklet link will copy the code to the clipboard.  
[v0.4] Now supports Dark theme  
[v0.4] Code rewrite  
[v0.3] Fixed the distribution page not functioning.  
[v0.2] Recreated the bookmarklet distribution page with an experimental feature of automatic bookmarklet generation.  
[v0.1] Created [the bookmarklet page](https://r8btx.github.io/Server-Clock-Bookmarklet/page) to simplify the setup process.
