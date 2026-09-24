#!/usr/bin/env node
/**
 * gcash-deeplink CLI.
 *
 *   decode <qr>            print the decoded EMV fields
 *   build  <qr>            print deeplinks
 *   page   <qr> [<qr>...]  write the tap-through HTML page
 *   serve  <qr> [<qr>...]  render and serve that page
 */

import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { MissingConfigError } from './constants.ts';
import { buildDeeplink, buildProbes, buildVariants, toAndroidIntent } from './deeplink.ts';
import { parseQrph } from './emv.ts';
import { renderPage, type PageSection } from './page.ts';
import { localAddresses, startServer } from './server.ts';
import type { DeeplinkOptions, ParsedQrph, Variant } from './types.ts';

const USAGE = `gcash-deeplink — build GCash deeplinks from EMV QR Ph payloads

USAGE
  gcash-deeplink <command> [options] <qr>...

COMMANDS
  decode <qr>              Print the decoded EMV fields and CRC status.
  build  <qr>              Print deeplinks. Default: every variant.
  page   <qr>...           Write the tap-through HTML page. One section per QR.
  serve  <qr>...           Render that page and serve it over HTTP.

OPTIONS
  --variant <name>         build/page/serve: only this variant.
                           (minimal, dynamic, static, swappedIds, noMerchantId)
  --probe <FIELD:LABEL=V>  Add a one-field probe variant; repeatable.
                           FIELD is merchantId or clientId. Empty V omits it.
                           e.g. --probe merchantId:garbage=1
                                --probe clientId:empty=
                           Probes attach to the LAST qr only.
  --order-id <id>          Order reference for the dynamic variants.
  --redirect-url <url>     Where GCash returns the payer afterwards.
  --notify-url <url>       Server-side callback. Must be public HTTPS.
  --json                   build: emit JSON instead of text.
  --intent                 build: print the intent:// form too.
  --adb                    build: print an adb command per link.
  -o, --out <path>         page: output file. Default gcash-deeplink.html
  -p, --port <n>           serve: port. Default 3000.
  --host <addr>            serve: bind address. Default 0.0.0.0.
  -h, --help               Show this.

EXAMPLES
  gcash-deeplink decode "00020101021228..."
  gcash-deeplink build "00020101..." --variant minimal
  gcash-deeplink build "00020101..." --json
  gcash-deeplink page "00020101..." "00020102..." -o out.html
  gcash-deeplink serve "00020101..." --port 3003
  gcash-deeplink serve "00020101..." --probe merchantId:garbage=1

Every successful tap is a real payment. See docs/findings.md.`;

function fail(message: string): never {
  console.error(`error: ${message}\n`);
  console.error('Run `gcash-deeplink --help` for usage.');
  process.exit(2);
}

function printParsed(parsed: ParsedQrph): void {
  const rows: Array<[string, string]> = [
    ['merchant', parsed.merchantName],
    ['city', parsed.merchantCity],
    ['amount', parsed.amount || '(payer enters)'],
    ['currency', parsed.currency],
    ['mcc', parsed.mcc],
    ['country', parsed.countryCode],
    ['bank code', parsed.bankCode],
    ['shop id (28-03)', parsed.shopId],
    ['dest acct (28-04)', parsed.destinationAccount || '-'],
    ['bill number (62-03)', parsed.billNumber || '-'],
    ['reference (62-05)', parsed.referenceLabel || '-'],
    ['terminal (62-07)', parsed.terminalLabel || '-'],
    ['init method', parsed.initMethod === '12' ? '12 (dynamic — expires)'
      : parsed.initMethod === '11' ? '11 (static)' : parsed.initMethod],
    ['crc', `${parsed.crc} ${parsed.crcValid ? 'valid' : 'MISMATCH'}`],
  ];
  for (const [key, value] of rows) console.log(`  ${key.padEnd(21)} ${value}`);
  if (!parsed.crcValid) {
    console.log('\n  ! CRC does not match. The payload may be truncated or mistyped;');
    console.log('    GCash validates server-side and will reject it.');
  }
}

/** `FIELD:LABEL=VALUE` → the pieces, or an error. */
function parseProbe(spec: string): { field: 'merchantId' | 'clientId'; label: string; value: string } {
  const colon = spec.indexOf(':');
  if (colon === -1) fail(`--probe wants FIELD:LABEL=VALUE, got ${JSON.stringify(spec)}`);
  const field = spec.slice(0, colon);
  if (field !== 'merchantId' && field !== 'clientId') {
    fail(`--probe field must be merchantId or clientId, got ${JSON.stringify(field)}`);
  }
  const rest = spec.slice(colon + 1);
  const eq = rest.indexOf('=');
  if (eq === -1) fail(`--probe wants FIELD:LABEL=VALUE, got ${JSON.stringify(spec)}`);
  return { field, label: rest.slice(0, eq).trim(), value: rest.slice(eq + 1).trim() };
}

/** Variants for one QR, plus any probes if this is the QR they attach to. */
function sectionFor(
  qr: string,
  options: DeeplinkOptions,
  probeSpecs: string[],
  attachProbes: boolean,
): PageSection {
  const parsed = parseQrph(qr);
  const variants: Variant[] = buildVariants(parsed, options);
  let note: string | undefined;

  if (attachProbes && probeSpecs.length > 0) {
    const probes = probeSpecs.map(parseProbe);
    for (const field of ['merchantId', 'clientId'] as const) {
      const forField = probes.filter((p) => p.field === field);
      if (forField.length > 0) variants.push(...buildProbes(parsed, field, forField));
    }
    note =
      'Probe run: each mid:/cid: link is `minimal` with only that one field changed. ' +
      'Tap a probe BEFORE any link that succeeds — once a dynamic QR is spent, every ' +
      'later tap fails regardless of the field, which reads as a rejection.';
  }

  return note === undefined ? { parsed, variants } : { parsed, variants, note };
}

function selectVariant(variants: Variant[], name: string | undefined): Variant[] {
  if (!name) return variants;
  const hit = variants.filter((v) => v.label === name);
  if (hit.length === 0) {
    fail(`unknown variant ${JSON.stringify(name)}; have: ${variants.map((v) => v.label).join(', ')}`);
  }
  return hit;
}

async function main(): Promise<void> {
  let parsedArgs;
  try {
    parsedArgs = parseArgs({
      allowPositionals: true,
      options: {
        variant: { type: 'string' },
        probe: { type: 'string', multiple: true, default: [] },
        'order-id': { type: 'string' },
        'redirect-url': { type: 'string' },
        'notify-url': { type: 'string' },
        json: { type: 'boolean', default: false },
        intent: { type: 'boolean', default: false },
        adb: { type: 'boolean', default: false },
        out: { type: 'string', short: 'o' },
        port: { type: 'string', short: 'p' },
        host: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }

  const { values, positionals } = parsedArgs;
  const [command, ...qrs] = positionals;

  if (values.help || !command) {
    console.log(USAGE);
    process.exit(values.help ? 0 : 2);
  }

  if (qrs.length === 0) fail(`${command} needs at least one QR payload`);
  // Trim the ends and drop line breaks a wrapped copy-paste may have
  // introduced, but NEVER touch inner spaces: they are payload data. Merchant
  // names contain them ("TEST MERCHANT") and acquirers pad fields with them
  // ("test    "). Stripping those shifts every following TLV length and turns a
  // valid QR into one that fails CRC for no visible reason.
  const payloads = qrs.map((q) => q.trim().replace(/[\r\n\t]/g, ''));

  const options: DeeplinkOptions = {
    ...(values['order-id'] !== undefined ? { orderId: values['order-id'] } : {}),
    ...(values['redirect-url'] !== undefined ? { redirectUrl: values['redirect-url'] } : {}),
    ...(values['notify-url'] !== undefined ? { notifyUrl: values['notify-url'] } : {}),
  };

  switch (command) {
    case 'decode': {
      for (const qr of payloads) {
        console.log('=== decoded QR Ph ===');
        printParsed(parseQrph(qr));
        console.log('');
      }
      return;
    }

    case 'build': {
      const qr = payloads[0]!;
      if (payloads.length > 1) {
        console.error('note: build uses the first QR only; use `page` or `serve` for several.\n');
      }
      const section = sectionFor(qr, options, values.probe, true);
      const chosen = selectVariant(section.variants, values.variant);

      if (values.json) {
        console.log(JSON.stringify({ parsed: section.parsed, variants: chosen }, null, 2));
        return;
      }

      for (const v of chosen) {
        if (chosen.length > 1) console.log(`\n--- ${v.label} ---`);
        console.log(v.deeplink);
        if (values.intent) console.log(v.intent);
        if (values.adb) {
          console.log(`\nadb shell am start -a android.intent.action.VIEW -d "${v.deeplink}"`);
        }
      }
      return;
    }

    case 'page': {
      const out = values.out ?? 'gcash-deeplink.html';
      const sections = payloads.map((qr, i) => {
        const section = sectionFor(qr, options, values.probe, i === payloads.length - 1);
        return values.variant
          ? { ...section, variants: selectVariant(section.variants, values.variant) }
          : section;
      });
      writeFileSync(out, renderPage(sections), 'utf8');
      const count = sections.reduce((n, s) => n + s.variants.length, 0);
      console.log(`wrote ${out} — ${sections.length} section(s), ${count} variant(s)`);
      for (const s of sections) {
        const flag = s.parsed.crcValid ? '' : '  ** CRC MISMATCH **';
        console.log(`  ${s.parsed.merchantName || '(unknown)'} — ₱${s.parsed.amount || '?'}${flag}`);
      }
      return;
    }

    case 'serve': {
      const port = Number.parseInt(values.port ?? '3000', 10);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        fail(`--port must be 1-65535, got ${JSON.stringify(values.port)}`);
      }
      const host = values.host ?? '0.0.0.0';

      const sections = payloads.map((qr, i) => {
        const section = sectionFor(qr, options, values.probe, i === payloads.length - 1);
        return values.variant
          ? { ...section, variants: selectVariant(section.variants, values.variant) }
          : section;
      });

      for (const s of sections) {
        if (!s.parsed.crcValid) {
          console.error(`warning: ${s.parsed.merchantName || 'QR'} has a CRC mismatch`);
        }
        if (s.parsed.initMethod === '12') {
          console.error(`note: ${s.parsed.merchantName || 'QR'} is dynamic — it will expire`);
        }
      }

      try {
        await startServer({
          html: renderPage(sections),
          port,
          host,
          onRequest: (path) => console.log(`  ${new Date().toISOString()}  ${path}`),
        });
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EADDRINUSE') fail(`port ${port} is already in use — try --port ${port + 1}`);
        if (code === 'EACCES') fail(`not allowed to bind port ${port} — try a port above 1024`);
        throw err;
      }

      const count = sections.reduce((n, s) => n + s.variants.length, 0);
      console.log(`serving ${sections.length} section(s), ${count} variant(s) on port ${port}`);
      console.log(`  local   http://127.0.0.1:${port}/`);
      for (const addr of localAddresses()) console.log(`  lan     http://${addr}:${port}/`);
      console.log('\nEvery path returns the page. Ctrl-C to stop.');
      return;
    }

    default:
      fail(`unknown command ${JSON.stringify(command)}`);
  }
}

// A missing identifier is a configuration mistake, not a crash. Print the
// explanation the error already carries and exit non-zero, without a stack
// trace the user cannot act on.
try {
  await main();
} catch (err) {
  if (err instanceof MissingConfigError) {
    console.error(`error: ${err.message}`);
    process.exit(3);
  }
  throw err;
}
