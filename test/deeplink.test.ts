import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CLIENT_ID_ENV,
  GCASH_ANDROID_PACKAGE,
  GCASH_BASE_URL,
  MERCHANT_ID_ENV,
  MissingConfigError,
  PaymentType,
} from '../src/constants.ts';
import { buildDeeplink, buildProbes, buildVariants, toAndroidIntent } from '../src/deeplink.ts';
import { parseQrph } from '../src/emv.ts';
import { ALT_QR, PPMI_QR } from './emv.test.ts';

// The identifiers come from the environment, so the suite supplies its own
// rather than depending on whatever the developer has configured. These are
// arbitrary test values and carry no meaning.
const TEST_CLIENT_ID = 'test-client-0000000001';
const TEST_MERCHANT_ID = 'test-merchant-000000001';
process.env[CLIENT_ID_ENV] = TEST_CLIENT_ID;
process.env[MERCHANT_ID_ENV] = TEST_MERCHANT_ID;

/** Read one query parameter out of a built link without decoding the value. */
function rawParam(link: string, key: string): string | undefined {
  const query = link.slice(link.indexOf('?') + 1);
  for (const pair of query.split('&')) {
    const eq = pair.indexOf('=');
    if (pair.slice(0, eq) === key) return pair.slice(eq + 1);
  }
  return undefined;
}

describe('buildDeeplink — shape', () => {
  const link = buildDeeplink(PPMI_QR);

  it('targets the scan-to-pay mini-program', () =>
    assert.ok(link.startsWith(`${GCASH_BASE_URL}?`)));

  it('routes to the p2m handler', () => assert.equal(rawParam(link, 'sub'), 'p2mpay'));

  it('declares the QR format', () => assert.equal(rawParam(link, 'qrCodeFormat'), 'EMVCO'));

  it('embeds the QR payload verbatim once decoded', () =>
    assert.equal(decodeURIComponent(rawParam(link, 'qrCode')!), PPMI_QR));

  it('carries the amount from the QR', () => assert.equal(rawParam(link, 'orderAmount'), '160'));

  it('defaults to the standard payment type when no orderId is given', () =>
    assert.ok(rawParam(link, 'param3')!.endsWith(PaymentType.Standard)));

  it('switches to dynamic when an orderId is given', () => {
    const dyn = buildDeeplink(PPMI_QR, { orderId: 'ORDER-1' });
    assert.ok(rawParam(dyn, 'param3')!.endsWith(PaymentType.Dynamic));
    assert.equal(rawParam(dyn, 'orderId'), 'ORDER-1');
  });
});

describe('buildDeeplink — identifiers', () => {
  it('sends the configured clientId and merchantId', () => {
    const link = buildDeeplink(PPMI_QR);
    assert.equal(rawParam(link, 'clientId'), TEST_CLIENT_ID);
    assert.equal(rawParam(link, 'merchantId'), TEST_MERCHANT_ID);
  });

  it('omits merchantId entirely when given an empty string', () => {
    const link = buildDeeplink(PPMI_QR, { merchantId: '' });
    assert.equal(rawParam(link, 'merchantId'), undefined);
  });

  it('omits clientId entirely when given an empty string', () => {
    const link = buildDeeplink(PPMI_QR, { clientId: '' });
    assert.equal(rawParam(link, 'clientId'), undefined);
  });

  it('routes by the QR account, not by merchantId', () => {
    const link = buildDeeplink(PPMI_QR, { merchantId: 'SOMETHING-ELSE' });
    assert.equal(rawParam(link, 'tfrAcctNo'), '1000000000000000001');
    assert.equal(rawParam(link, 'shopId'), '1000000000000000001');
  });
});

describe('buildDeeplink — shop/reference swap', () => {
  it('maps shopId from 28-03 and acqInfo from 62-05 by default', () => {
    const link = buildDeeplink(PPMI_QR);
    assert.equal(rawParam(link, 'shopId'), '1000000000000000001');
    assert.equal(rawParam(link, 'acqInfo'), '2000000000000000002');
  });

  it('exchanges them when asked', () => {
    const link = buildDeeplink(PPMI_QR, { swapShopAndReference: true });
    assert.equal(rawParam(link, 'shopId'), '2000000000000000002');
    assert.equal(rawParam(link, 'acqInfo'), '1000000000000000001');
  });

  it('ignores the swap when 28-04 pins the payee', () => {
    // Rebuild the merchant template with a destination account present.
    const parsed = parseQrph(PPMI_QR);
    const withDest = { ...parsed, destinationAccount: 'DEST-123' };
    const link = buildDeeplink(withDest, { swapShopAndReference: true });
    assert.equal(rawParam(link, 'shopId'), '1000000000000000001');
    assert.equal(rawParam(link, 'tfrAcctNo'), 'DEST-123');
  });
});

describe('buildDeeplink — encoding', () => {
  it('escapes a space as %20, never +', () => {
    const link = buildDeeplink(PPMI_QR);
    assert.equal(rawParam(link, 'merchantName'), 'Demo%20Store%21');
    assert.ok(!link.includes('+'));
  });

  it('escapes ! as %21 so it matches GCash’s own encoding', () => {
    assert.ok(rawParam(buildDeeplink(PPMI_QR), 'merchantName')!.includes('%21'));
  });

  it('escapes # as %23 — an unescaped one would truncate the intent fragment', () => {
    const link = buildDeeplink(ALT_QR);
    assert.equal(rawParam(link, 'acqInfo'), 'OR%23TEST01');
    assert.ok(!toAndroidIntent(link).slice(0, -'#Intent;scheme=gcash;package=x;end'.length)
      .includes('#OR'));
  });

  it('leaves ~ bare, since param3 and param5 use it as a separator', () => {
    const link = buildDeeplink(PPMI_QR);
    assert.ok(rawParam(link, 'param3')!.includes('~'));
    assert.ok(rawParam(link, 'param5')!.includes('~'));
  });

  it('packs param5 as shopId~merchantName~terminalLabel~acqInfo', () => {
    const link = buildDeeplink(ALT_QR);
    assert.equal(
      decodeURIComponent(rawParam(link, 'param5')!),
      'MERCHANT-TEST~TEST MERCHANT~term~OR#TEST01',
    );
  });
});

describe('toAndroidIntent', () => {
  const intent = toAndroidIntent(buildDeeplink(PPMI_QR));

  it('rewrites the scheme', () => assert.ok(intent.startsWith('intent://')));
  it('names the scheme and package in the fragment', () =>
    assert.ok(intent.endsWith(`#Intent;scheme=gcash;package=${GCASH_ANDROID_PACKAGE};end`)));
  it('keeps the authority and path', () =>
    assert.ok(intent.includes('com.mynt.gcash/app/006300000800')));
  it('has exactly one # — the fragment delimiter', () =>
    assert.equal(intent.split('#').length, 2));
});

describe('buildVariants', () => {
  const variants = buildVariants(PPMI_QR);
  const labels = variants.map((v) => v.label);

  it('produces the five standard shapes', () =>
    assert.deepEqual(labels, ['minimal', 'dynamic', 'static', 'swappedIds', 'noMerchantId']));

  it('gives every variant an intent form', () =>
    assert.ok(variants.every((v) => v.intent.startsWith('intent://'))));

  it('drops merchantId only in the noMerchantId control', () => {
    for (const v of variants) {
      const mid = rawParam(v.deeplink, 'merchantId');
      if (v.label === 'noMerchantId') assert.equal(mid, undefined);
      else assert.equal(mid, TEST_MERCHANT_ID);
    }
  });

  it('adds withCallback only when a url is supplied', () => {
    assert.ok(!labels.includes('withCallback'));
    const withUrls = buildVariants(PPMI_QR, { notifyUrl: 'https://example.com/hook' });
    assert.ok(withUrls.map((v) => v.label).includes('withCallback'));
  });

  it('sends a redirect url as both redirectUrl and returnUrl', () => {
    const [first] = buildVariants(PPMI_QR, { redirectUrl: 'https://example.com/done' });
    assert.equal(rawParam(first!.deeplink, 'redirectUrl'), rawParam(first!.deeplink, 'returnUrl'));
  });
});

describe('buildProbes', () => {
  it('changes only the probed field', () => {
    const [probe] = buildProbes(PPMI_QR, 'merchantId', [{ label: 'garbage', value: '1' }]);
    const control = buildDeeplink(PPMI_QR, { paymentType: PaymentType.Standard });

    assert.equal(probe!.label, 'mid:garbage');
    assert.equal(rawParam(probe!.deeplink, 'merchantId'), '1');

    // Everything except merchantId must be byte-identical to the control.
    const strip = (l: string) => l.replace(/&merchantId=[^&]*/, '');
    assert.equal(strip(probe!.deeplink), strip(control));
  });

  it('labels clientId probes distinctly', () => {
    const [probe] = buildProbes(PPMI_QR, 'clientId', [{ label: 'empty', value: '' }]);
    assert.equal(probe!.label, 'cid:empty');
    assert.equal(rawParam(probe!.deeplink, 'clientId'), undefined);
  });

  it('builds one variant per value', () => {
    const probes = buildProbes(PPMI_QR, 'merchantId', [
      { label: 'a', value: '1' },
      { label: 'b', value: '2' },
    ]);
    assert.equal(probes.length, 2);
  });
});

describe('configuration', () => {
  it('refuses to build with a placeholder when merchantId is unset', () => {
    const saved = process.env[MERCHANT_ID_ENV];
    delete process.env[MERCHANT_ID_ENV];
    try {
      assert.throws(() => buildDeeplink(PPMI_QR), MissingConfigError);
    } finally {
      process.env[MERCHANT_ID_ENV] = saved;
    }
  });

  it('names the missing variable in the error', () => {
    const saved = process.env[CLIENT_ID_ENV];
    delete process.env[CLIENT_ID_ENV];
    try {
      assert.throws(() => buildDeeplink(PPMI_QR), (err: unknown) => {
        assert.ok(err instanceof MissingConfigError);
        assert.equal(err.variable, CLIENT_ID_ENV);
        assert.match(err.message, /GCASH_CLIENT_ID is not set/);
        return true;
      });
    } finally {
      process.env[CLIENT_ID_ENV] = saved;
    }
  });

  it('still builds from an explicit override with nothing configured', () => {
    const savedC = process.env[CLIENT_ID_ENV];
    const savedM = process.env[MERCHANT_ID_ENV];
    delete process.env[CLIENT_ID_ENV];
    delete process.env[MERCHANT_ID_ENV];
    try {
      const link = buildDeeplink(PPMI_QR, { clientId: 'c1', merchantId: 'm1' });
      assert.equal(rawParam(link, 'clientId'), 'c1');
      assert.equal(rawParam(link, 'merchantId'), 'm1');
    } finally {
      process.env[CLIENT_ID_ENV] = savedC;
      process.env[MERCHANT_ID_ENV] = savedM;
    }
  });
});
