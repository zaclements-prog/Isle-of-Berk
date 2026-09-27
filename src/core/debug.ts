export type DebugApi = Record<string, unknown>;

/** Collects debug/tooling functions into one live object, exposed as `window.berk`. */
export class DebugRegistry {
  private readonly root: DebugApi = {};

  register(namespace: string | null, api: DebugApi): void {
    if (namespace === null) {
      Object.assign(this.root, api);
      return;
    }
    const existing = this.root[namespace];
    const ns = (typeof existing === 'object' && existing !== null ? existing : {}) as DebugApi;
    Object.assign(ns, api);
    this.root[namespace] = ns;
  }

  expose(target: Record<string, unknown>, name = 'berk'): void {
    target[name] = this.root;
  }

  get api(): DebugApi {
    return this.root;
  }
}

export const debug = new DebugRegistry();
