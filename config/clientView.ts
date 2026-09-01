/**
 * The all-sites client view.
 *
 * Every client route is keyed on a site: `/tools/[client]/…`, where `[client]`
 * is a `clients.stock_code`. That is what a real client user gets, and what
 * middleware.ts matches their entitlements against.
 *
 * An ADMIN opening the client view has no single site, and does not want one —
 * the pages they land on (Radar Status Hub, the alarm / availability / data
 * quality summaries, Rainfall, VWP) already read across every site and carry
 * their own site filters. Making the admin pick a site first just to reach a
 * dashboard that ignores the choice was a step with nothing behind it.
 *
 * So the admin's client view is addressed by this sentinel instead of a stock
 * code. It is deliberately NOT a possible stock_code — those are short upper-case
 * tickers (GEMS, HMY, KKGI) — so it can never collide with a real site, and a
 * client user can never reach it: middleware only lets them through for a code
 * listed in their own `sites`, and this is in nobody's.
 *
 * InSAR and Prism are the pages that resolve a real site rather than reading
 * across all of them, so they have no all-sites reading of their own. Both now
 * carry the same site picker Rainfall does: the segment still supplies the
 * opening site when it names one, and an admin on this sentinel picks from the
 * list instead of being shown nothing.
 */
export const ALL_SITES_CLIENT = 'all-sites';

/** The address of the all-sites client dashboard. */
export const ALL_SITES_HOME = `/tools/${ALL_SITES_CLIENT}/home`;

/** Is this `[client]` segment the all-sites view rather than a real site? */
export const isAllSites = (client?: string | string[] | null) =>
  client === ALL_SITES_CLIENT;
