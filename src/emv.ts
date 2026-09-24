/**
 * EMV Merchant-Presented Mode (MPM) parsing, as used by QR Ph.
 *
 * Written from the EMVCo MPM spec rather than ported from a library, so there
 * is no dependency and the leniency rules below are ours to choose.
 */

import { QRPH_P2M_UID } from './constants.ts';
import type { ParsedQrph, TlvEntry } from './types.ts';

/**
 * Split an EMV TLV string into its elements.
 *
 * Each element is a two-character tag, a two-digit decimal length, then that
 * many characters of value. Returns whatever it managed to read instead of
 * throwing on a malformed tail — a QR with junk appended still yields its
 * leading fields, which is more useful than nothing when debugging.
 */
export function parseTlv(payload: string): TlvEntry[] {
  const out: TlvEntry[] = [];
  let i = 0;
  while (i + 4 <= payload.length) {
    const tag = payload.slice(i, i + 2);
    const length = Number.parseInt(payload.slice(i + 2, i + 4), 10);
    if (!Number.isInteger(length) || length < 0 || i + 4 + length > payload.length) break;
    out.push({ tag, value: payload.slice(i + 4, i + 4 + length) });
    i += 4 + length;
  }
  return out;
}

/** Index a TLV string by tag. Later duplicates overwrite earlier ones. */
function tlvMap(payload: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const { tag, value } of parseTlv(payload)) map.set(tag, value);
  return map;
}

/**
 * CRC-16/CCITT-FALSE — the checksum EMV tag 63 carries.
 *
 * Polynomial 0x1021, initial value 0xFFFF, no input/output reflection, no final
 * XOR. Returned as the four uppercase hex characters the QR itself stores.
 */
export function crc16(data: string): string {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x8000) === 0 ? (crc << 1) & 0xffff : ((crc << 1) ^ 0x1021) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Parse an EMV QR Ph payload.
 *
 * A bad CRC is reported through {@link ParsedQrph.crcValid} rather than thrown:
 * GCash validates the QR server-side anyway, and seeing the decoded fields of a
 * broken QR beats an exception when working out *why* it is broken.
 */
export function parseQrph(qr: string): ParsedQrph {
  const parsed: ParsedQrph = {
    raw: qr,
    version: '',
    initMethod: '',
    mcc: '',
    currency: '',
    amount: '',
    countryCode: '',
    merchantName: '',
    merchantCity: '',
    bankCode: '',
    shopId: '',
    destinationAccount: '',
    billNumber: '',
    referenceLabel: '',
    terminalLabel: '',
    crc: '',
    crcValid: false,
  };

  for (const { tag, value } of parseTlv(qr)) {
    switch (tag) {
      case '00': parsed.version = value; break;
      case '01': parsed.initMethod = value; break;
      case '52': parsed.mcc = value.trim(); break;
      case '53': parsed.currency = value.trim(); break;
      case '54': parsed.amount = value.trim(); break;
      case '58': parsed.countryCode = value.trim(); break;
      case '59': parsed.merchantName = value.trim(); break;
      case '60': parsed.merchantCity = value.trim(); break;
      case '62': readAdditionalData(value, parsed); break;
      case '63': parsed.crc = value.trim(); break;
      default: readMerchantAccount(tag, value, parsed); break;
    }
  }

  if (parsed.crc) {
    // Tag 63 covers the payload up to and including its own "6304" header.
    const marker = qr.lastIndexOf('6304');
    if (marker !== -1) {
      parsed.crcValid = crc16(qr.slice(0, marker + 4)) === parsed.crc.toUpperCase();
    }
  }

  return parsed;
}

/**
 * Tags 02-51 are Merchant Account Information templates.
 *
 * A QR may carry several, one per network. Only the QR Ph P2M one holds the
 * payee, and the first such wins so a second network's template cannot
 * overwrite it.
 */
function readMerchantAccount(tag: string, template: string, parsed: ParsedQrph): void {
  const n = Number.parseInt(tag, 10);
  if (!Number.isInteger(n) || n < 2 || n > 51) return;
  if (parsed.bankCode || parsed.destinationAccount) return;

  const sub = tlvMap(template);
  if (!(sub.get('00') ?? '').includes(QRPH_P2M_UID)) return;

  parsed.bankCode = (sub.get('01') ?? '').trim();
  parsed.shopId = (sub.get('03') ?? '').trim();
  parsed.destinationAccount = (sub.get('04') ?? '').trim();
}

/**
 * Tag 62, the Additional Data Field Template.
 *
 * EMVCo names sub-tag 03 the Store Label and 05 the Reference Label. GCash
 * reads 05 as the acquirer reference (`acqInfo`), which is the mapping the
 * deeplink builder relies on. The template's own namespace sub-tag (00) varies
 * by acquirer — some write `ph.starpay` where others write `ph.ppmi.p2m` —
 * so it is deliberately not checked here.
 */
function readAdditionalData(template: string, parsed: ParsedQrph): void {
  const sub = tlvMap(template);
  parsed.billNumber = (sub.get('03') ?? '').trim();
  parsed.referenceLabel = (sub.get('05') ?? '').trim();
  parsed.terminalLabel = (sub.get('07') ?? '').trim();
}
