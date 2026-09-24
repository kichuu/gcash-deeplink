import type { PaymentTypeValue } from './constants.ts';

/** One element of an EMV TLV string: a two-digit tag and its value. */
export interface TlvEntry {
  tag: string;
  value: string;
}

/** The fields of an EMV QR Ph payload that the deeplink needs. */
export interface ParsedQrph {
  /** The payload exactly as scanned — embedded verbatim in the deeplink. */
  raw: string;
  /** Tag 00, payload format indicator. */
  version: string;
  /** Tag 01. `11` = static (payer enters amount), `12` = dynamic (expires). */
  initMethod: string;
  /** Tag 52, merchant category code. */
  mcc: string;
  /** Tag 53, ISO 4217 numeric. `608` = PHP. */
  currency: string;
  /** Tag 54. Absent on a static QR, where the payer chooses. */
  amount: string;
  /** Tag 58. */
  countryCode: string;
  /** Tag 59. */
  merchantName: string;
  /** Tag 60. */
  merchantCity: string;
  /** Sub-tag 01 of the QR Ph merchant account template — the acquirer BIC. */
  bankCode: string;
  /** Sub-tag 03 — the merchant's account with that acquirer. */
  shopId: string;
  /** Sub-tag 04. When present it pins the payee unambiguously. */
  destinationAccount: string;
  /** Tag 62 sub-tag 03. EMVCo calls this the Store Label. */
  billNumber: string;
  /** Tag 62 sub-tag 05, the Reference Label. GCash reads it as `acqInfo`. */
  referenceLabel: string;
  /** Tag 62 sub-tag 07, the Terminal Label. */
  terminalLabel: string;
  /** Tag 63, CRC-16/CCITT-FALSE over everything up to and including `6304`. */
  crc: string;
  /** Whether {@link crc} matches a recomputed checksum. */
  crcValid: boolean;
}

/** Knobs for {@link buildDeeplink}. */
export interface DeeplinkOptions {
  /** Merchant's own order reference. Its presence implies a dynamic payment. */
  orderId?: string;
  /** Where GCash returns the payer afterwards. Sent as both `redirectUrl` and `returnUrl`. */
  redirectUrl?: string;
  /** Server-side callback. Must be public HTTPS. Sent as both `notifyUrl` and `callbackUrl`. */
  notifyUrl?: string;
  /** Defaults to Dynamic when `orderId` is set, Standard otherwise. */
  paymentType?: PaymentTypeValue;
  /** Defaults to {@link DEFAULT_CLIENT_ID}. Pass `''` to omit the parameter. */
  clientId?: string;
  /** Defaults to {@link DEFAULT_MERCHANT_ID}. Pass `''` to omit the parameter. */
  merchantId?: string;
  /**
   * Exchange the shop id (28-03) and reference label (62-05).
   *
   * Acquirers disagree about which of the two carries the stable merchant id.
   * Ignored when the QR has a destination account (28-04), which settles it.
   */
  swapShopAndReference?: boolean;
}

/** A named deeplink, as produced by {@link buildVariants}. */
export interface Variant {
  label: string;
  /** The `gcash://` URL. */
  deeplink: string;
  /** The same link rewritten as an Android `intent://` URL. */
  intent: string;
}
