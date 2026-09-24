import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { crc16, parseQrph, parseTlv } from '../src/emv.ts';

/**
 * Synthetic fixtures. Real QR Ph payloads carry a live merchant account, so
 * none are committed here — these are generated with valid CRCs and preserve
 * the structural properties that actually differ between acquirers.
 *
 * PPMI_QR: `ph.ppmi.p2m` namespace in tag 62, a numeric shop id, and a
 * merchant name containing both a space and a `!`.
 */
const PPMI_QR =
  '00020101021228530011ph.ppmi.p2m0111TESTPHM1XXX03191000000000000000001520473725303' +
  '60854031605802PH5911Demo Store!6009Test City62380011ph.ppmi.p2m051920000000000000' +
  '0000263043868';

/**
 * ALT_QR: a different acquirer's conventions — `ph.starpay` namespace in tag
 * 62, an alphanumeric shop id, a `#` in the reference label, a space-padded
 * terminal label, a decimal amount, and a trailing unreserved template (88).
 */
const ALT_QR =
  '00020101021228540011ph.ppmi.p2m0111TESTPHM2XXX0313MERCHANT-TEST05030005204601053036' +
  '08540530.005802PH5913TEST MERCHANT6008TestCity62630010ph.starpay0313TEST MERCHANT05' +
  '09OR#TEST010708term    0803***88290012ph.ppmi.qrph0109OR#TEST0163043C04';

describe('parseTlv', () => {
  it('splits tag/length/value triples', () => {
    assert.deepEqual(parseTlv('0002010102121'.slice(0, 12)), [
      { tag: '00', value: '01' },
      { tag: '01', value: '12' },
    ]);
  });

  it('stops at a truncated element rather than throwing', () => {
    // Declares 60 characters but supplies 4.
    assert.deepEqual(parseTlv('000201' + '2860abcd'), [{ tag: '00', value: '01' }]);
  });

  it('stops on a non-numeric length', () => {
    assert.deepEqual(parseTlv('000201' + '28XXfoo'), [{ tag: '00', value: '01' }]);
  });

  it('returns nothing for input too short to hold a header', () => {
    assert.deepEqual(parseTlv('000'), []);
  });
});

describe('crc16', () => {
  it('matches the CRC embedded in a PPMI-style fixture', () => {
    const at = PPMI_QR.lastIndexOf('6304');
    assert.equal(crc16(PPMI_QR.slice(0, at + 4)), '3868');
  });

  it('matches the CRC embedded in a alternate-acquirer fixture', () => {
    const at = ALT_QR.lastIndexOf('6304');
    assert.equal(crc16(ALT_QR.slice(0, at + 4)), '3C04');
  });

  it('produces the CCITT-FALSE check value for "123456789"', () => {
    assert.equal(crc16('123456789'), '29B1');
  });

  it('always returns four hex characters', () => {
    assert.match(crc16(''), /^[0-9A-F]{4}$/);
  });
});

describe('parseQrph — PPMI-namespaced payload', () => {
  const parsed = parseQrph(PPMI_QR);

  it('validates the CRC', () => assert.equal(parsed.crcValid, true));
  it('reads the merchant', () => assert.equal(parsed.merchantName, 'Demo Store!'));
  it('reads the city', () => assert.equal(parsed.merchantCity, 'Test City'));
  it('reads the amount', () => assert.equal(parsed.amount, '160'));
  it('reads the acquirer BIC', () => assert.equal(parsed.bankCode, 'TESTPHM1XXX'));
  it('reads the shop id from 28-03', () =>
    assert.equal(parsed.shopId, '1000000000000000001'));
  it('leaves the destination account empty when 28-04 is absent', () =>
    assert.equal(parsed.destinationAccount, ''));
  it('reads the reference label from 62-05', () =>
    assert.equal(parsed.referenceLabel, '2000000000000000002'));
  it('flags a dynamic QR', () => assert.equal(parsed.initMethod, '12'));
});

describe('parseQrph — alternate-acquirer payload', () => {
  const parsed = parseQrph(ALT_QR);

  it('validates the CRC', () => assert.equal(parsed.crcValid, true));
  it('reads the merchant', () => assert.equal(parsed.merchantName, 'TEST MERCHANT'));
  it('reads a decimal amount', () => assert.equal(parsed.amount, '30.00'));
  it('reads the acquirer BIC', () => assert.equal(parsed.bankCode, 'TESTPHM2XXX'));
  it('reads a non-numeric shop id', () => assert.equal(parsed.shopId, 'MERCHANT-TEST'));

  it('reads tag 62 even though its namespace is ph.starpay, not ph.ppmi.p2m', () => {
    assert.equal(parsed.referenceLabel, 'OR#TEST01');
    assert.equal(parsed.billNumber, 'TEST MERCHANT');
  });

  it('trims the padding an acquirer puts in the terminal label', () =>
    assert.equal(parsed.terminalLabel, 'term'));
});

describe('parseQrph — degenerate input', () => {
  it('reports crcValid false when the CRC is wrong', () => {
    const broken = PPMI_QR.slice(0, -4) + '0000';
    assert.equal(parseQrph(broken).crcValid, false);
  });

  it('does not throw on an empty payload', () => {
    const parsed = parseQrph('');
    assert.equal(parsed.crcValid, false);
    assert.equal(parsed.shopId, '');
  });

  it('keeps the first QR Ph merchant account when another template follows', () => {
    // Tag 29 carries a second, non-QR-Ph template that must not overwrite 28.
    const at = PPMI_QR.lastIndexOf('6304');
    const withExtra = PPMI_QR.slice(0, at) + '29200011ph.other.xx0105OTHER';
    const parsed = parseQrph(withExtra);
    assert.equal(parsed.bankCode, 'TESTPHM1XXX');
    assert.equal(parsed.shopId, '1000000000000000001');
  });

  it('preserves the payload verbatim in raw', () =>
    assert.equal(parseQrph(PPMI_QR).raw, PPMI_QR));

  // Regression: the CLI once stripped all whitespace to tidy up pasted input,
  // which silently corrupted any QR with a space inside a value. "TEST MERCHANT"
  // became "TESTMERCHANT", one character short of its declared length, shifting
  // every following TLV and breaking the CRC.
  it('breaks if inner spaces are stripped — they are payload data', () => {
    const mangled = ALT_QR.replace(/ /g, '');
    const parsed = parseQrph(mangled);
    assert.equal(parsed.crcValid, false);
    assert.notEqual(parsed.merchantName, 'TEST MERCHANT');
  });

  it('reads a merchant name containing a space', () =>
    assert.equal(parseQrph(ALT_QR).merchantName, 'TEST MERCHANT'));
});

export { PPMI_QR, ALT_QR };
