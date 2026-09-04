/**
 * The admin board.
 *
 * `/admin/monitoring` (MonitoringSelection) is the admin landing page — the
 * SURFACE / UNDERGROUND / SENSI MAP / CLIENT VIEW card deck. `/admin/home` is a
 * separate radar+safety board whose cards point at routes that do not exist, so
 * it is NOT where "back to admin" should take anyone. See LogoSection, which
 * makes the same distinction for the logo click.
 *
 * Named here so the client view can offer a way back without hard-coding the
 * admin section's URL in a client component.
 */
export const ADMIN_HOME = '/admin/monitoring';
