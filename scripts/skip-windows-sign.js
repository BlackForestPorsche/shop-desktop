"use strict";

/** No-op Windows code sign hook for unsigned shop builds. */
exports.default = async function skipWindowsSign() {
  return;
};
