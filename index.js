// index.js
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter, OTLPMetricExporter } = require('@opentelemetry/exporter-otlp-http');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');

const fs = require('fs');
const dns = require('dns');
const { promisify } = require('util');
const lookup = promisify(dns.lookup);

// — تشخیص اجرای داخل Kubernetes —
async function isRunningInK8s() {
  const tokenPath = '/var/run/secrets/kubernetes.io/serviceaccount/token';
  if (fs.existsSync(tokenPath)) return true;
  try {
    const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');
    if (cgroup.includes('kubepods')) return true;
  } catch {}
  try {
    await lookup('kubernetes.default.svc.cluster.local');
    return true;
  } catch {}
  return false;
}

// — کِش و برگشت URL مناسب —
let cachedServerURL = null;
async function getServerURL() {
  if (cachedServerURL) return cachedServerURL;
  if (await isRunningInK8s()) {
    cachedServerURL = 'http://watchlog-node-agent.monitoring.svc.cluster.local:3774/apm';
  } else {
    cachedServerURL = 'http://127.0.0.1:3774/apm';
  }
  return cachedServerURL;
}

async function instrument(options = {}) {
  const {
    // اگر کاربر صراحتاً url بده، استفاده می‌کنیم
    url: userUrl,
    app = 'node-app',
    headers = {},
    batchOptions = {},
    metricIntervalMillis = 5000
  } = options;

  // تعیین URL اتوماتیک بر اساس محیط
  const baseUrl = userUrl || await getServerURL();

  process.env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL  = 'http/protobuf';
  process.env.OTEL_EXPORTER_OTLP_METRICS_PROTOCOL = 'http/protobuf';

  const traceExporter = new OTLPTraceExporter({
    url: `${baseUrl}/${app}/v1/traces`,
    headers
  });
  const metricExporter = new OTLPMetricExporter({
    url: `${baseUrl}/${app}/v1/metrics`,
    headers
  });

  const sdk = new NodeSDK({
    instrumentations: [ getNodeAutoInstrumentations() ],
    spanProcessor: new BatchSpanProcessor(traceExporter, {
      maxExportBatchSize: batchOptions.maxBatchSize  || 200,
      scheduledDelayMillis: batchOptions.scheduledDelayMillis || 5000
    }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: metricIntervalMillis
    })
  });

  await sdk.start();
  console.log('🔺 Watchlog APM instrumentation started on', baseUrl);
  return sdk;
}

module.exports = { instrument };
