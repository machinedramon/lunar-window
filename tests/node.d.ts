// The two Node functions the tests use to read the elevation files (the project does not depend on @types/node).
declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array;
  export function readFileSync(path: string, encoding: 'utf8'): string;
}
declare module 'node:zlib' {
  export function gunzipSync(data: Uint8Array): Uint8Array;
}
