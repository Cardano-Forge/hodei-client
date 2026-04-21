export type DeferredPromise<T, R> = {
  status: "pending";
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: R) => void;
};

export function deferredPromise<T = void, R = unknown>(): DeferredPromise<
  T,
  R
> {
  let status: "pending" | "resolved" | "rejected" = "pending";
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  let reject: (reason?: R) => void = () => undefined;

  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = (value) => {
      status = "resolved";
      promiseResolve(value);
    };
    reject = (reason) => {
      status = "rejected";
      promiseReject(reason);
    };
  });

  return { status, promise, resolve, reject };
}

export function getFailureReason(error?: unknown): string | undefined {
  if (!error) {
    return undefined;
  }
  if (
    (error instanceof Error || hasProperty(error, "message")) &&
    typeof error.message === "string" &&
    error.message.length > 0
  ) {
    return error.message;
  }
  if (
    hasProperty(error, "data") &&
    hasProperty(error.data, "message") &&
    typeof error.data.message === "string" &&
    error.data.message.length > 0
  ) {
    return error.data.message;
  }
  if (typeof error === "string" && error.length > 0) {
    return error;
  }
  return undefined;
}

export function hasProperty<P extends string>(
  obj: unknown,
  property: P,
): obj is { [K in P]: unknown } {
  return typeof obj === "object" && obj !== null && property in obj;
}

export function debounce(fn: () => void, delay: number) {
  let timer: NodeJS.Timeout | undefined;
  return () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      fn();
      timer = undefined;
    }, delay);
  };
}

export function assert(
  condition: unknown,
  explanation?: string,
): asserts condition {
  if (condition) {
    return;
  }
  let msg = "Assertion failed";
  if (explanation) msg += `: ${explanation}`;
  throw new Error(msg);
}
