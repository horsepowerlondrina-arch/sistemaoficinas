export declare function documentationOnly(files: string[]): boolean;
export declare function shouldIgnore(
  env?: Record<string, string | undefined>,
  run?: (...args: any[]) => string,
): boolean;
