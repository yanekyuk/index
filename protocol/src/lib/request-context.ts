import { AsyncLocalStorage } from "async_hooks";

interface RequestContext {
  originUrl?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();
