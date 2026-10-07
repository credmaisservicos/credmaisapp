export interface WebReleaseFile { path: string; bytes: number; sha256: string; }
export function writeWebReleaseCatalog(directory: string): Promise<{ release: string; files: WebReleaseFile[] }>;
