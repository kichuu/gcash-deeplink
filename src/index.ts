/**
 * gcash-deeplink — build GCash deeplinks from EMV QR Ph payloads.
 *
 * Unofficial and unsupported. Read docs/protocol.md before depending on any of
 * this, and docs/findings.md for what has actually been observed on a handset.
 */

export {
  CLIENT_ID_ENV,
  GCASH_ANDROID_PACKAGE,
  GCASH_BASE_URL,
  GCASH_SUB,
  MERCHANT_ID_ENV,
  MissingConfigError,
  PaymentType,
  QRPH_P2M_UID,
  getClientId,
  getMerchantId,
} from './constants.ts';
export type { PaymentTypeValue } from './constants.ts';

export { crc16, parseQrph, parseTlv } from './emv.ts';

export { buildDeeplink, buildProbes, buildVariants, toAndroidIntent } from './deeplink.ts';

export { renderPage } from './page.ts';
export type { PageSection } from './page.ts';

export { localAddresses, startServer } from './server.ts';
export type { ServeOptions } from './server.ts';

export type { DeeplinkOptions, ParsedQrph, TlvEntry, Variant } from './types.ts';
