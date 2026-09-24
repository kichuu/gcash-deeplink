/**
 * Build `gcash://` deeplinks from a parsed EMV QR Ph payload.
 *
 * See docs/protocol.md for what each query parameter means.
 */

import {
  GCASH_ANDROID_PACKAGE,
  GCASH_BASE_URL,
  GCASH_SUB,
  PaymentType,
  QRPH_P2M_UID,
  getClientId,
  getMerchantId,
} from './constants.ts';
import { parseQrph } from './emv.ts';
import type { DeeplinkOptions, ParsedQrph, Variant } from './types.ts';

/**
 * Percent-encode one query component.
 *
 * `encodeURIComponent` leaves `!'()*` alone. Those are legal in a query string,
 * but GCash's own links escape them, so we match — a merchant name containing `!`
 * should produce the same bytes here as it does coming out of the app. `~` is
 * deliberately left bare: `param3` and `param5` use it as a field separator.
 */
function encodeComponent(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** `shopId~merchantName~terminalLabel~acqInfo`, GCash's packed tuple. */
function buildParam5(shopId: string, merchantName: string, terminal: string, acq: string): string {
  return shopId ? `${shopId}~${merchantName}~${terminal}~${acq}` : '';
}

/**
 * Build the deeplink for a QR payload.
 *
 * Accepts either the raw string or an already-parsed payload — pass the latter
 * when generating several variants so the QR is only parsed once.
 */
export function buildDeeplink(
  qr: string | ParsedQrph,
  options: DeeplinkOptions = {},
): string {
  const data = typeof qr === 'string' ? parseQrph(qr) : qr;

  let shopId = data.shopId;
  let acqInfo = data.referenceLabel;
  // Only meaningful when 28-04 is absent; when present it pins the payee and
  // there is nothing ambiguous left to swap.
  if (!data.destinationAccount && options.swapShopAndReference) {
    [shopId, acqInfo] = [acqInfo, shopId];
  }

  const paymentType =
    options.paymentType ?? (options.orderId ? PaymentType.Dynamic : PaymentType.Standard);

  // Resolved lazily so an explicit override works without the env var set —
  // a probe passing its own value should not require configuring the default.
  const clientId = options.clientId ?? getClientId();
  const merchantId = options.merchantId ?? getMerchantId();

  // 28-04 when present is the true payee account. Acquirers that omit it put
  // the same value in the shop id, so fall back to that.
  const tfrAcctNo = data.destinationAccount || shopId;

  const params: Array<[string, string]> = [
    ['qrCode', data.raw],
    ['bizNo', 'null'],
    ['orderAmount', data.amount],
    ['qrCodeFormat', 'EMVCO'],
    ['sub', GCASH_SUB],
  ];
  // clientId keeps its position in the query string but is dropped entirely
  // when empty, so `clientId: ''` can test whether GCash requires it at all —
  // sending `clientId=` would be a different experiment (empty vs absent).
  if (clientId) params.push(['clientId', clientId]);
  params.push(['merchantName', data.merchantName]);

  const optional: Array<[string, string | undefined]> = [
    ['merchantId', merchantId],
    ['orderId', options.orderId],
    ['tfrbnkcode', data.bankCode],
    ['shopId', shopId],
    ['tfrAcctNo', tfrAcctNo],
    ['acqInfo', acqInfo],
    ['redirectUrl', options.redirectUrl],
    ['returnUrl', options.redirectUrl],
    ['notifyUrl', options.notifyUrl],
    ['callbackUrl', options.notifyUrl],
    ['param3', `99960005~${QRPH_P2M_UID}~~~${paymentType}`],
    ['param5', buildParam5(shopId, data.merchantName, data.terminalLabel, acqInfo)],
    ['merchantCity', data.merchantCity],
    ['merchantCategoryCode', data.mcc],
  ];

  // The literal string "null" is GCash's own placeholder for bizNo above; as a
  // value for anything else it means "unset", so drop it rather than send it.
  for (const [key, value] of optional) {
    if (value && value !== 'null') params.push([key, value]);
  }
  params.push(['lucky', 'false']);

  const query = params
    .map(([k, v]) => `${encodeComponent(k)}=${encodeComponent(v)}`)
    .join('&');

  return `${GCASH_BASE_URL}?${query}`;
}

/**
 * Rewrite a `gcash://` link as an Android `intent://` URL.
 *
 * Chrome on Android will not follow an unrecognised custom scheme from a plain
 * link in most contexts. The intent form names the scheme and target package
 * explicitly and does get handed off. Use this from a web page; use the plain
 * `gcash://` form from native code or `adb`.
 */
export function toAndroidIntent(deeplink: string): string {
  const withoutScheme = deeplink.slice(deeplink.indexOf('://') + 3);
  return `intent://${withoutScheme}#Intent;scheme=gcash;package=${GCASH_ANDROID_PACKAGE};end`;
}

/** Wrap a deeplink with its `intent://` form under a label. */
function asVariant(label: string, deeplink: string): Variant {
  return { label, deeplink, intent: toAndroidIntent(deeplink) };
}

/**
 * Every candidate link shape worth trying on a handset.
 *
 * Which shape GCash accepts is not documented, and the failure mode is quiet —
 * the app opens and then refuses the transaction. Generating the whole matrix
 * and tapping through it beats betting on one and concluding the scheme is dead
 * when it fails.
 *
 * `noMerchantId` is the control: it is known to fail, so if it ever succeeds,
 * something about the protocol has changed.
 */
export function buildVariants(
  qr: string | ParsedQrph,
  options: DeeplinkOptions = {},
): Variant[] {
  const data = typeof qr === 'string' ? parseQrph(qr) : qr;
  const base: DeeplinkOptions = {
    ...(options.redirectUrl !== undefined ? { redirectUrl: options.redirectUrl } : {}),
    ...(options.notifyUrl !== undefined ? { notifyUrl: options.notifyUrl } : {}),
  };

  const variants: Variant[] = [
    asVariant('minimal', buildDeeplink(data, { ...base, paymentType: PaymentType.Standard })),
    asVariant('dynamic', buildDeeplink(data, {
      ...base,
      paymentType: PaymentType.Dynamic,
      orderId: options.orderId ?? `T${Date.now()}`,
    })),
    asVariant('static', buildDeeplink(data, { ...base, paymentType: PaymentType.Static })),
    asVariant('swappedIds', buildDeeplink(data, {
      ...base,
      paymentType: PaymentType.Standard,
      swapShopAndReference: true,
    })),
    asVariant('noMerchantId', buildDeeplink(data, {
      ...base,
      paymentType: PaymentType.Standard,
      merchantId: '',
    })),
  ];

  if (options.redirectUrl || options.notifyUrl) {
    variants.push(asVariant('withCallback', buildDeeplink(data, {
      ...base,
      paymentType: PaymentType.Dynamic,
      orderId: options.orderId ?? `T${Date.now()}`,
    })));
  }

  return variants;
}

/**
 * Variants that change exactly one identifier, for isolating whether GCash
 * validates it.
 *
 * Each entry is the `minimal` link with only `clientId` or `merchantId`
 * swapped, so a difference in outcome can only come from that field. Order the
 * probes before a known-good control when tapping: see docs/findings.md for why
 * a control placed first can make an exhausted QR look like a rejected value.
 */
export function buildProbes(
  qr: string | ParsedQrph,
  field: 'merchantId' | 'clientId',
  values: Array<{ label: string; value: string }>,
): Variant[] {
  const data = typeof qr === 'string' ? parseQrph(qr) : qr;
  return values.map(({ label, value }) =>
    asVariant(
      `${field === 'merchantId' ? 'mid' : 'cid'}:${label}`,
      buildDeeplink(data, { paymentType: PaymentType.Standard, [field]: value }),
    ),
  );
}
