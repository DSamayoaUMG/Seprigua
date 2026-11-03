/* Small runtime fallbacks and a low-resource mode. Keep this ES5 so it can run first. */
(function () {
  "use strict";
  if (!String.prototype.replaceAll) {
    String.prototype.replaceAll = function (search, replacement) {
      if (search instanceof RegExp) return this.replace(search, replacement);
      return this.split(String(search)).join(String(replacement));
    };
  }
  if (!Array.prototype.flat) {
    Array.prototype.flat = function (depth) {
      var result = [];
      var remaining = depth === undefined ? 1 : Number(depth);
      function append(items, level) {
        for (var i = 0; i < items.length; i++) {
          if (!(i in items)) continue;
          if (Array.isArray(items[i]) && level > 0) append(items[i], level - 1);
          else result.push(items[i]);
        }
      }
      append(this, remaining);
      return result;
    };
  }
  if (!window.queueMicrotask) {
    window.queueMicrotask = function (callback) { Promise.resolve().then(callback); };
  }
  var connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  var reducedMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var lightMode = reducedMotion || !!(connection && connection.saveData) ||
    (typeof navigator.deviceMemory === "number" && navigator.deviceMemory <= 2) ||
    (typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency <= 2);
  window.SEPRIGUA_LIGHT_MODE = lightMode;
  if (lightMode) document.documentElement.className += " se-light-mode";

  document.addEventListener("DOMContentLoaded", function () {
    var video = document.querySelector(".login-bg");
    if (!video) return;
    if (lightMode) {
      video.pause();
      video.removeAttribute("autoplay");
      while (video.firstChild) video.removeChild(video.firstChild);
      video.load(); // Keep the poster, avoiding video decoding on low-resource devices.
      return;
    }
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) video.pause();
      else if (video.paused) {
        var resumed = video.play();
        if (resumed && resumed.catch) resumed.catch(function () {});
      }
    });
  });
}());
