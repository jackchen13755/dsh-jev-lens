/**
 * Structural shapes for the host services this plugin consumes.
 *
 * Deliberately NOT imported from `@deepseek-ai/dsh-*`: the npm-published
 * packages lag the running harness, so a plugin that type-depends on them
 * compiles against signatures the host does not have. The real contract is the
 * **service key string** plus the shapes below, and structural typing keeps this
 * plugin working across harness releases instead of breaking on a type rename.
 *
 * @module dsh-jev-lens/host
 */
/**
 * Read one optional service off a context without assuming the shape of `ctx`.
 *
 * The `get` call is guarded on purpose: cordis *throws* when a plugin reads a
 * service it did not declare, and a plugin that dies while looking for an
 * optional seam is worse than one that runs without it. A caller that needs the
 * service for real must still obtain it through `ctx.inject`, which is what
 * makes the dependency visible to the loader.
 */
export function serviceOf(ctx, key) {
    const anyCtx = ctx;
    let viaGet;
    try {
        viaGet = typeof anyCtx.get === 'function' ? anyCtx.get(key) : undefined;
    }
    catch {
        viaGet = undefined;
    }
    let direct;
    try {
        direct = anyCtx[key];
    }
    catch {
        direct = undefined;
    }
    const service = (viaGet ?? direct);
    return service === null ? undefined : service;
}
//# sourceMappingURL=host.js.map