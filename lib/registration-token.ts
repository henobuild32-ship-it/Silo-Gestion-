// New links use 128-bit tokens (22 base64url characters). Keep accepting the
// previous 256-bit token format so links already shared continue to work.
export const registrationTokenPattern = /^(?:[A-Za-z0-9_-]{22}|[A-Za-z0-9_-]{35,60})$/;
